/**
 * Privacy hardening (migration 20261110150000), executed in real Postgres (PGlite) with the real migration applied.
 * Requests run under the same role + JWT-claim mechanism PostgREST uses.
 *
 *   node --test scripts/privacy-tests/privacy.test.mjs
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync } from 'node:fs';
import { PGlite } from '@electric-sql/pglite';

const migration = readFileSync(new URL('../../supabase/migrations/20261110150000_privacy_hardening.sql', import.meta.url), 'utf8');

const ME = '00000000-0000-4000-8000-00000000000a';      // viewer
const LIVE = '00000000-0000-4000-8000-00000000000b';    // owner with a live intent
const FRIEND = '00000000-0000-4000-8000-00000000000c';  // shares a conversation with ME
const OTHER = '00000000-0000-4000-8000-00000000000d';

// A small replica of the live tables the two changes touch. Column names and the one policy-relevant function match production.
const SCHEMA = `
create role anon nologin; create role authenticated nologin; create role service_role nologin;
create schema auth;
create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
create table auth.users(id uuid primary key);
create table public.profiles(id uuid primary key, privacy_setting text);
create table public.user_privacy_settings(user_id uuid primary key, who_can_message text default 'everyone', discoverable boolean default true, show_online_status boolean default true);
create table public.blocks(blocker_id uuid, blocked_id uuid);
create table public.conversation_members(conversation_id uuid, user_id uuid);
create table public.intents(id uuid primary key default gen_random_uuid(), user_id uuid, expires_at timestamptz, is_paused boolean default false);
create table public.interests(id uuid primary key default gen_random_uuid(), from_user_id uuid, to_user_id uuid, status text default 'pending');
create table public.gazes(id uuid primary key default gen_random_uuid(), from_user_id uuid, to_user_id uuid);
grant usage on schema public, auth to authenticated, anon, service_role;
grant all on all tables in schema public to authenticated, service_role;
grant execute on function auth.uid() to authenticated, anon, service_role;
`;

async function createDb() {
  const db = new PGlite();
  await db.exec(SCHEMA);
  await db.exec(migration);
  for (const id of [ME, LIVE, FRIEND, OTHER]) await db.query('insert into auth.users values ($1)', [id]);
  for (const id of [ME, LIVE, FRIEND, OTHER]) await db.query('insert into public.profiles(id) values ($1)', [id]);
  await db.query(`insert into public.intents(user_id, expires_at) values ($1, now() + interval '1 hour')`, [LIVE]);
  const conv = '11111111-1111-4111-8111-111111111111';
  await db.query('insert into public.conversation_members values ($1,$2),($1,$3)', [conv, ME, FRIEND]);
  return db;
}
const as = (db, userId, action) => db.transaction(async (tx) => {
  await tx.exec(userId ? 'set local role authenticated' : 'set local role anon');
  await tx.query("select set_config('request.jwt.claim.sub', $1, true)", [userId ?? '']);
  return action(tx);
});
const canView = async (db, viewer, owner) => (await as(db, viewer, (tx) => tx.query('select public.gayze_can_view_profile_media($1) ok', [owner]))).rows[0].ok;

test('photos: a stranger sees a live, discoverable person; nothing else is open', async () => {
  const db = await createDb();
  assert.equal(await canView(db, ME, LIVE), true, 'live + discoverable');
  assert.equal(await canView(db, ME, OTHER), false, 'not live, no relationship');
  assert.equal(await canView(db, ME, ME), true, 'own photos');
  await assert.rejects(canView(db, null, LIVE), /permission denied/, 'signed out cannot call it at all');
});

test('photos: a block hides them in both directions, even while live', async () => {
  const db = await createDb();
  await db.query('insert into public.blocks values ($1,$2)', [LIVE, ME]);        // they blocked me
  assert.equal(await canView(db, ME, LIVE), false);
  const db2 = await createDb();
  await db2.query('insert into public.blocks values ($1,$2)', [ME, LIVE]);       // I blocked them
  assert.equal(await canView(db2, ME, LIVE), false);
  // and a block overrides an existing conversation
  const db3 = await createDb();
  await db3.query('insert into public.blocks values ($1,$2)', [FRIEND, ME]);
  assert.equal(await canView(db3, ME, FRIEND), false);
});

test('photos: "Appear in Discover" off or ghost mode hides them from strangers, not from people they talk to', async () => {
  const db = await createDb();
  await db.query('insert into public.user_privacy_settings(user_id, discoverable) values ($1,false)', [LIVE]);
  assert.equal(await canView(db, ME, LIVE), false, 'not discoverable');
  const db2 = await createDb();
  await db2.query(`update public.profiles set privacy_setting='ghost' where id=$1`, [LIVE]);
  assert.equal(await canView(db2, ME, LIVE), false, 'ghost');
  // a ghost friend is still visible to the person they are in a conversation with
  await db2.query(`update public.profiles set privacy_setting='ghost' where id=$1`, [FRIEND]);
  assert.equal(await canView(db2, ME, FRIEND), true, 'conversation partner');
});

test('photos: someone who sent you a pending Gayze is visible to you; a paused intent is not live', async () => {
  const db = await createDb();
  await db.query(`insert into public.interests(from_user_id,to_user_id,status) values ($1,$2,'pending')`, [OTHER, ME]);
  assert.equal(await canView(db, ME, OTHER), true);
  await db.query('update public.intents set is_paused=true');
  assert.equal(await canView(db, ME, LIVE), false);
});

const insertInterest = (db, from, to) => as(db, from, (tx) => tx.query('insert into public.interests(from_user_id,to_user_id) values ($1,$2)', [from, to]));
const insertGaze = (db, from, to) => as(db, from, (tx) => tx.query('insert into public.gazes(from_user_id,to_user_id) values ($1,$2)', [from, to]));

test('contact: connections-only refuses a direct insert from a stranger, for interests and gazes', async () => {
  const db = await createDb();
  await db.query(`insert into public.user_privacy_settings(user_id, who_can_message) values ($1,'connections')`, [LIVE]);
  await assert.rejects(insertInterest(db, ME, LIVE), /CONTACT_RESTRICTED/);
  await assert.rejects(insertGaze(db, ME, LIVE), /CONTACT_RESTRICTED/);
});

test('contact: connections-only still lets an existing connection through, and "everyone" is unchanged', async () => {
  const db = await createDb();
  await db.query(`insert into public.user_privacy_settings(user_id, who_can_message) values ($1,'connections')`, [FRIEND]);
  await insertInterest(db, ME, FRIEND);
  await insertGaze(db, ME, FRIEND);
  await insertInterest(db, ME, OTHER);      // OTHER has no settings row: defaults to everyone
  await insertGaze(db, ME, LIVE);
  assert.equal((await db.query('select count(*)::int n from public.interests')).rows[0].n, 2);
});

test('contact: re-opening a declined request on a connections-only person is refused; answering a request is not', async () => {
  const db = await createDb();
  await insertInterest(db, ME, OTHER);                                     // allowed: OTHER accepts everyone at this point
  await db.query(`insert into public.user_privacy_settings(user_id, who_can_message) values ($1,'connections')`, [OTHER]);
  await as(db, OTHER, (tx) => tx.query(`update public.interests set status='declined'`));          // answering: not restricted
  await assert.rejects(as(db, ME, (tx) => tx.query(`update public.interests set status='pending'`)), /CONTACT_RESTRICTED/);
  assert.equal((await db.query('select status from public.interests')).rows[0].status, 'declined');
  await as(db, OTHER, (tx) => tx.query(`update public.interests set status='mutual'`));            // answering again: still fine
  assert.equal((await db.query('select status from public.interests')).rows[0].status, 'mutual');
});
