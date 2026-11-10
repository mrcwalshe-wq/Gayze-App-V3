/**
 * Private albums (migration 20261110170000), executed in real Postgres (PGlite) with the real migration applied, under the
 * same role + JWT-claim mechanism PostgREST uses.
 *
 *   node --test scripts/privacy-tests/albums.test.mjs
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync } from 'node:fs';
import { PGlite } from '@electric-sql/pglite';

const migration = readFileSync(new URL('../../supabase/migrations/20261110170000_private_albums.sql', import.meta.url), 'utf8');
const OWNER = '00000000-0000-4000-8000-00000000000a';
const FRIEND = '00000000-0000-4000-8000-00000000000b';
const STRANGER = '00000000-0000-4000-8000-00000000000c';
const THIRD = '00000000-0000-4000-8000-00000000000d';
const CONV = '11111111-1111-4111-8111-111111111111';
const GROUP = '22222222-2222-4222-8222-222222222222';
const MSG = '33333333-3333-4333-8333-333333333333';

const SCHEMA = `
create role anon nologin; create role authenticated nologin; create role service_role nologin;
create schema auth; create schema storage;
create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
create table auth.users(id uuid primary key);
create table public.profiles(id uuid primary key, display_name text);
create table public.blocks(blocker_id uuid, blocked_id uuid);
create table public.conversation_members(conversation_id uuid, user_id uuid);
create table public.messages(id uuid primary key, conversation_id uuid, sender_id uuid, unsent_at timestamptz, burned_at timestamptz, expires_at timestamptz);
create function storage.foldername(name text) returns text[] language sql immutable as $$ select string_to_array(name, '/') $$;
create table storage.buckets(id text primary key, name text, public boolean, file_size_limit integer, allowed_mime_types text[]);
create table storage.objects(id uuid primary key default gen_random_uuid(), bucket_id text, name text);
alter table storage.objects enable row level security;
grant usage on schema public, auth, storage to authenticated, anon, service_role;
grant all on all tables in schema public to authenticated, service_role;
grant select on storage.objects to authenticated;
grant execute on function auth.uid() to authenticated, anon, service_role;
grant execute on function storage.foldername(text) to authenticated, anon, service_role;
`;

async function createDb() {
  const db = new PGlite();
  await db.exec(SCHEMA);
  await db.exec(migration);
  for (const [id, n] of [[OWNER, 'Owner'], [FRIEND, 'Friend'], [STRANGER, 'Stranger'], [THIRD, 'Third']]) {
    await db.query('insert into auth.users values ($1)', [id]);
    await db.query('insert into public.profiles values ($1,$2)', [id, n]);
  }
  await db.query('insert into public.conversation_members values ($1,$2),($1,$3)', [CONV, OWNER, FRIEND]);
  await db.query('insert into public.conversation_members values ($1,$2),($1,$3),($1,$4)', [GROUP, OWNER, FRIEND, THIRD]);
  await db.query('insert into public.messages(id, conversation_id, sender_id) values ($1,$2,$3)', [MSG, CONV, OWNER]);
  // a grant-less table owner (postgres) set up the schema; give PostgREST roles the same reach they have in production
  return db;
}
const as = (db, userId, action) => db.transaction(async (tx) => {
  await tx.exec(userId ? 'set local role authenticated' : 'set local role anon');
  await tx.query("select set_config('request.jwt.claim.sub', $1, true)", [userId ?? '']);
  return action(tx);
});
const q = async (db, user, sql, params = []) => (await as(db, user, (tx) => tx.query(sql, params))).rows;

async function album(db, owner = OWNER, photos = 2) {
  const id = (await q(db, owner, `insert into public.albums(owner_id, name, wrapped_key, wrap_nonce) values ($1,'Beach','aa','bb') returning id`, [owner]))[0].id;
  for (let i = 0; i < photos; i++) {
    await q(db, owner, `insert into public.album_photos(album_id, owner_id, storage_path, position) values ($1,$2,$3,$4)`, [id, owner, `${owner}/${id}/p${i}.bin`, i]);
  }
  return id;
}
const share = async (db, albumId, conv = CONV, exp = null, user = OWNER) =>
  (await q(db, user, 'select public.share_album($1,$2,$3) id', [albumId, conv, exp]))[0].id;
const view = async (db, user, shareId) => (await q(db, user, 'select public.get_shared_album($1) r', [shareId]))[0].r;
const canObj = async (db, user, name) => (await q(db, user, 'select public.gayze_can_view_album_object($1) ok', [name]))[0].ok;

test('albums are private to their owner; nobody can write into someone else\'s album', async () => {
  const db = await createDb();
  const a = await album(db);
  assert.equal((await q(db, OWNER, 'select count(*)::int n from public.albums'))[0].n, 1);
  assert.equal((await q(db, STRANGER, 'select count(*)::int n from public.albums'))[0].n, 0);
  assert.equal((await q(db, STRANGER, 'select count(*)::int n from public.album_photos'))[0].n, 0);
  await assert.rejects(q(db, STRANGER, `insert into public.album_photos(album_id, owner_id, storage_path) values ($1,$2,'x/y.bin')`, [a, STRANGER]), /row-level security|violates/);
  await assert.rejects(q(db, STRANGER, `insert into public.album_photos(album_id, owner_id, storage_path) values ($1,$2,'x/z.bin')`, [a, OWNER]), /row-level security|violates/);
});

test('limits: 10 albums per person, 30 photos per album', async () => {
  const db = await createDb();
  for (let i = 0; i < 10; i++) await album(db, OWNER, 0);
  await assert.rejects(q(db, OWNER, `insert into public.albums(owner_id,name,wrapped_key,wrap_nonce) values ($1,'x','a','b')`, [OWNER]), /ALBUM_LIMIT_ALBUMS/);
  const db2 = await createDb();
  const a = await album(db2, OWNER, 30);
  await assert.rejects(q(db2, OWNER, `insert into public.album_photos(album_id,owner_id,storage_path) values ($1,$2,'o/extra.bin')`, [a, OWNER]), /ALBUM_LIMIT_PHOTOS/);
});

test('sharing: only the owner, only a non-empty album, only a direct chat, never across a block, sane expiry', async () => {
  const db = await createDb();
  const a = await album(db);
  await assert.rejects(share(db, a, CONV, null, STRANGER), /not your album/);
  const empty = await album(db, OWNER, 0);
  await assert.rejects(share(db, empty), /ALBUM_EMPTY/);
  await assert.rejects(share(db, a, GROUP), /ALBUM_DIRECT_ONLY/);
  await assert.rejects(share(db, a, CONV, new Date(Date.now() - 1000).toISOString()), /invalid expiry/);
  await assert.rejects(share(db, a, CONV, new Date(Date.now() + 40 * 86400e3).toISOString()), /invalid expiry/);
  await db.query('insert into public.blocks values ($1,$2)', [FRIEND, OWNER]);
  await assert.rejects(share(db, a), /GAYZE_BLOCKED_USER/);
});

test('a recipient can open a shared album and read its photos; a stranger cannot', async () => {
  const db = await createDb();
  const a = await album(db);
  const s = await share(db, a);
  const r = await view(db, FRIEND, s);
  assert.equal(r.status, 'ok'); assert.equal(r.name, 'Beach'); assert.equal(r.photos.length, 2);
  assert.equal((await view(db, STRANGER, s)).status, 'unavailable');
  assert.equal(await canObj(db, FRIEND, r.photos[0].path), true);
  assert.equal(await canObj(db, STRANGER, r.photos[0].path), false);
  assert.equal(await canObj(db, OWNER, r.photos[0].path), true);
  // a photo of an album that was never shared is closed to the friend
  const other = await album(db);
  const otherPath = (await db.query('select storage_path p from public.album_photos where album_id=$1 limit 1', [other])).rows[0].p;
  assert.equal(await canObj(db, FRIEND, otherPath), false);
});

test('access ends: revoked, expired, unsent message, disappearing message, block, leaving the chat', async () => {
  // revoked
  let db = await createDb(); let a = await album(db); let s = await share(db, a);
  assert.equal((await q(db, OWNER, 'select public.revoke_album_share($1) ok', [s]))[0].ok, true);
  assert.equal((await view(db, FRIEND, s)).status, 'unavailable');
  // only the owner can revoke
  db = await createDb(); a = await album(db); s = await share(db, a);
  assert.equal((await q(db, FRIEND, 'select public.revoke_album_share($1) ok', [s]))[0].ok, false);
  assert.equal((await view(db, FRIEND, s)).status, 'ok');
  // timer
  db = await createDb(); a = await album(db); s = await share(db, a, CONV, new Date(Date.now() + 3600e3).toISOString());
  assert.equal((await view(db, FRIEND, s)).status, 'ok');
  await db.query(`update public.album_shares set expires_at = now() - interval '1 second'`);
  assert.equal((await view(db, FRIEND, s)).status, 'unavailable');
  // unsend the chat message that carried it
  db = await createDb(); a = await album(db); s = await share(db, a);
  assert.equal((await q(db, OWNER, 'select public.link_album_share_message($1,$2) ok', [s, MSG]))[0].ok, true);
  assert.equal((await view(db, FRIEND, s)).status, 'ok');
  await db.query('update public.messages set unsent_at = now() where id = $1', [MSG]);
  assert.equal((await view(db, FRIEND, s)).status, 'unavailable');
  assert.notEqual((await db.query('select revoked_at from public.album_shares')).rows[0].revoked_at, null, 'the trigger revoked it');
  // disappearing message
  db = await createDb(); a = await album(db); s = await share(db, a);
  await q(db, OWNER, 'select public.link_album_share_message($1,$2)', [s, MSG]);
  await db.query(`update public.messages set expires_at = now() - interval '1 second'`);
  assert.equal((await view(db, FRIEND, s)).status, 'unavailable');
  // block, either direction
  db = await createDb(); a = await album(db); s = await share(db, a);
  await db.query('insert into public.blocks values ($1,$2)', [FRIEND, OWNER]);
  assert.equal((await view(db, FRIEND, s)).status, 'unavailable');
  // leaving the conversation
  db = await createDb(); a = await album(db); s = await share(db, a);
  await db.query('delete from public.conversation_members where conversation_id=$1 and user_id=$2', [CONV, FRIEND]);
  assert.equal((await view(db, FRIEND, s)).status, 'unavailable');
});

test('linking a message: only the owner, only their own message in the same chat, only once', async () => {
  const db = await createDb(); const a = await album(db); const s = await share(db, a);
  const theirs = '44444444-4444-4444-8444-444444444444';
  await db.query('insert into public.messages(id, conversation_id, sender_id) values ($1,$2,$3)', [theirs, CONV, FRIEND]);
  const link = async (user, msg) => (await q(db, user, 'select public.link_album_share_message($1,$2) ok', [s, msg]))[0].ok;
  assert.equal(await link(FRIEND, MSG), false, 'not the owner');
  assert.equal(await link(OWNER, theirs), false, 'not the owner\'s message');
  assert.equal(await link(OWNER, MSG), true);
  assert.equal(await link(OWNER, MSG), false, 'already linked');
});

test('shares can only be changed through the functions; the owner sees who has access, nobody else does', async () => {
  const db = await createDb(); const a = await album(db); const s = await share(db, a);
  await assert.rejects(q(db, OWNER, `insert into public.album_shares(album_id, owner_id, recipient_id, conversation_id) values ($1,$2,$3,$4)`, [a, OWNER, STRANGER, CONV]), /permission denied/);
  await assert.rejects(q(db, OWNER, `update public.album_shares set revoked_at = null`), /permission denied/);
  const list = (await q(db, OWNER, 'select public.list_album_shares($1) l', [a]))[0].l;
  assert.equal(list.length, 1); assert.equal(list[0].recipientName, 'Friend'); assert.equal(list[0].active, true);
  assert.deepEqual((await q(db, STRANGER, 'select public.list_album_shares($1) l', [a]))[0].l, []);
  assert.equal((await q(db, FRIEND, 'select count(*)::int n from public.album_shares'))[0].n, 0, 'a recipient reads shares only through get_shared_album');
  await assert.rejects(q(db, null, 'select public.get_shared_album($1)', [s]), /permission denied/);
});
