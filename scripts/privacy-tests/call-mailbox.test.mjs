/**
 * Call-setup mailbox (migration 20261111120000) in real Postgres (PGlite), under the same role + claim mechanism as PostgREST.
 *   node --test scripts/privacy-tests/call-mailbox.test.mjs
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync } from 'node:fs';
import { PGlite } from '@electric-sql/pglite';

const migration = readFileSync(new URL('../../supabase/migrations/20261111120000_call_signal_mailbox.sql', import.meta.url), 'utf8');
const A = '00000000-0000-4000-8000-00000000000a'; // caller
const B = '00000000-0000-4000-8000-00000000000b'; // callee
const C = '00000000-0000-4000-8000-00000000000c'; // outsider
const CALL = '11111111-1111-4111-8111-111111111111';
const SDP = { type: 'offer', sdp: { type: 'offer', sdp: 'v=0...' } };

const SCHEMA = `
create role anon nologin; create role authenticated nologin; create role service_role nologin;
create schema auth;
create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
create table auth.users(id uuid primary key);
create table public.call_sessions(id uuid primary key, caller_id uuid, callee_id uuid, created_at timestamptz default now());
grant usage on schema public, auth to authenticated, anon, service_role;
grant all on all tables in schema public to service_role;
grant execute on function auth.uid() to authenticated, anon, service_role;
`;
async function createDb() {
  const db = new PGlite();
  await db.exec(SCHEMA);
  await db.exec(migration);
  for (const id of [A, B, C]) await db.query('insert into auth.users values ($1)', [id]);
  await db.query('insert into public.call_sessions(id, caller_id, callee_id) values ($1,$2,$3)', [CALL, A, B]);
  return db;
}
const as = (db, userId, action) => db.transaction(async (tx) => {
  await tx.exec(userId ? 'set local role authenticated' : 'set local role anon');
  await tx.query("select set_config('request.jwt.claim.sub', $1, true)", [userId ?? '']);
  return action(tx);
});
const q = async (db, user, sql, params = []) => (await as(db, user, (tx) => tx.query(sql, params))).rows;
const post = (db, user, to, kind = 'offer', payload = SDP) => q(db, user, 'select public.post_call_signal($1,$2,$3,$4::jsonb) id', [CALL, to, kind, JSON.stringify(payload)]);
const get = (db, user, kind = 'offer', after = 0) => q(db, user, 'select * from public.get_call_signal($1,$2,$3)', [CALL, kind, after]);

test('the caller leaves an offer and the callee reads it; the answer goes back the other way', async () => {
  const db = await createDb();
  await post(db, A, B, 'offer');
  const offer = await get(db, B, 'offer');
  assert.equal(offer.length, 1); assert.equal(offer[0].sender_id, A); assert.deepEqual(offer[0].payload, SDP);
  await post(db, B, A, 'answer', { type: 'answer', sdp: { type: 'answer', sdp: 'v=0' } });
  assert.equal((await get(db, A, 'answer')).length, 1);
});

test('only the newest message is returned, and nothing older than what the phone already has', async () => {
  const db = await createDb();
  const first = (await post(db, A, B))[0].id;
  const second = (await post(db, A, B, 'offer', { ...SDP, sdp: { type: 'offer', sdp: 'restart' } }))[0].id;
  const got = await get(db, B);
  assert.equal(got.length, 1); assert.equal(String(got[0].id), String(second));
  assert.equal((await get(db, B, 'offer', Number(second))).length, 0, 'nothing newer than the one already seen');
  assert.notEqual(String(first), String(second));
});

test('a person who is not on the call can neither write to it nor read from it', async () => {
  const db = await createDb();
  await post(db, A, B);
  await assert.rejects(post(db, C, B), /not_on_call/);
  await assert.rejects(post(db, C, A), /not_on_call/);
  assert.equal((await get(db, C)).length, 0, 'an outsider reads nothing');
  assert.equal((await get(db, A)).length, 0, 'the sender does not read their own offer back as the recipient');
});

test('you cannot post to someone who is not the other person on the call', async () => {
  const db = await createDb();
  await assert.rejects(post(db, A, C), /not_on_call/);
});

test('guards: signed in, valid kind, sensible size, rate limit, and no direct table access', async () => {
  const db = await createDb();
  await assert.rejects(post(db, null, B), /permission denied|not authenticated/);
  await assert.rejects(post(db, A, B, 'bogus'), /invalid_kind/);
  await assert.rejects(post(db, A, B, 'offer', { sdp: 'x'.repeat(25000) }), /invalid_payload/);
  await assert.rejects(q(db, A, 'select * from public.call_signals'), /permission denied/);
  await assert.rejects(q(db, A, `insert into public.call_signals(call_id, sender_id, recipient_id, kind, payload) values ($1,$2,$3,'offer','{}')`, [CALL, A, B]), /permission denied/);
  for (let i = 0; i < 40; i++) await post(db, A, B);
  await assert.rejects(post(db, A, B), /RATE_LIMIT/);
});

test('a call older than a day cannot be used', async () => {
  const db = await createDb();
  await db.exec(`update public.call_sessions set created_at = now() - interval '2 days'`);
  await assert.rejects(post(db, A, B), /not_on_call/);
});
