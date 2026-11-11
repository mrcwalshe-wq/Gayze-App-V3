/**
 * Native call keys (migration 20261111150000) in real Postgres (PGlite), on top of the call mailbox migration.
 *   node --test scripts/privacy-tests/native-call.test.mjs
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync } from 'node:fs';
import { PGlite } from '@electric-sql/pglite';

const read = (f) => readFileSync(new URL(`../../supabase/migrations/${f}`, import.meta.url), 'utf8');
const A = '00000000-0000-4000-8000-00000000000a'; // caller
const B = '00000000-0000-4000-8000-00000000000b'; // callee (the locked iPhone)
const C = '00000000-0000-4000-8000-00000000000c'; // outsider
const CALL = '11111111-1111-4111-8111-111111111111';
const OFFER = { sdp: { type: 'offer', sdp: 'v=0 offer' } };
const ANSWER = { sdp: { type: 'answer', sdp: 'v=0 answer' } };

const SCHEMA = `
create role anon nologin; create role authenticated nologin; create role service_role nologin;
create schema auth;
create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
create table auth.users(id uuid primary key);
create table public.call_sessions(id uuid primary key, caller_id uuid, callee_id uuid, call_type text default 'audio',
  status text not null default 'ringing', created_at timestamptz default now(), ended_at timestamptz);
create table public.call_events(id bigint generated always as identity primary key, call_id uuid not null, user_id uuid not null, event text not null, created_at timestamptz default now());
grant usage on schema public, auth to authenticated, anon, service_role;
grant all on all tables in schema public to service_role;
grant execute on function auth.uid() to authenticated, anon, service_role;
`;
async function createDb() {
  const db = new PGlite();
  await db.exec(SCHEMA);
  await db.exec(read('20261111120000_call_signal_mailbox.sql'));
  await db.exec(read('20261111150000_native_call_keys.sql'));
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
const key = async (db, user, device = 'phone-1') => (await q(db, user, 'select public.issue_native_call_key($1) k', [device]))[0].k;
const status = async (db, k) => (await q(db, null, 'select public.native_call_status($1,$2) s', [CALL, k]))[0].s;

test('a locked phone answers, reads the offer and leaves its answer with no session, only its call key', async () => {
  const db = await createDb();
  const kb = await key(db, B);
  assert.match(kb, /^gck1\.[0-9a-f]{64}$/);
  assert.equal((await q(db, null, 'select public.native_call_answer($1,$2) s', [CALL, kb]))[0].s, 'answered');
  assert.equal((await q(db, A, 'select public.get_call_status($1) s', [CALL]))[0].s, 'answered', 'the caller sees it was answered');
  await q(db, A, 'select public.post_call_signal($1,$2,$3,$4::jsonb)', [CALL, B, 'offer', JSON.stringify(OFFER)]);
  const offer = await q(db, null, 'select * from public.native_call_get_signal($1,$2,$3,0)', [CALL, kb, 'offer']);
  assert.deepEqual(offer[0].payload, OFFER);
  await q(db, null, 'select public.native_call_post_signal($1,$2,$3,$4::jsonb)', [CALL, kb, 'answer', JSON.stringify(ANSWER)]);
  const answer = await q(db, A, 'select * from public.get_call_signal($1,$2,0)', [CALL, 'answer']);
  assert.deepEqual(answer[0].payload, ANSWER); assert.equal(answer[0].sender_id, B);
});

test('hanging up an answered call is seen by the other side, from either side', async () => {
  const db = await createDb();
  const kb = await key(db, B);
  await q(db, null, 'select public.native_call_answer($1,$2)', [CALL, kb]);
  await q(db, A, 'select public.end_call_session($1,$2)', [CALL, 'ended']);          // the caller hangs up in the app
  assert.equal(await status(db, kb), 'ended', 'the locked phone learns the caller left');
  assert.equal((await db.query('select status from public.call_sessions')).rows[0].status, 'answered', 'reports still count it as answered');

  const db2 = await createDb();
  const kb2 = await key(db2, B);
  await q(db2, null, 'select public.native_call_answer($1,$2)', [CALL, kb2]);
  await q(db2, null, 'select public.native_call_end($1,$2)', [CALL, kb2]);              // the locked phone hangs up
  assert.equal((await q(db2, A, 'select public.get_call_status($1) s', [CALL]))[0].s, 'ended', 'the caller learns the callee left');
});

test('declining from the lock screen ends a ringing call', async () => {
  const db = await createDb();
  const kb = await key(db, B);
  await q(db, null, 'select public.native_call_end($1,$2)', [CALL, kb]);
  assert.equal((await q(db, A, 'select public.get_call_status($1) s', [CALL]))[0].s, 'ended');
});

test('a key only works for its owner’s own calls', async () => {
  const db = await createDb();
  const kc = await key(db, C);
  assert.equal((await q(db, null, 'select public.native_call_answer($1,$2) s', [CALL, kc]))[0].s, null);
  assert.equal(await status(db, kc), null);
  await q(db, A, 'select public.post_call_signal($1,$2,$3,$4::jsonb)', [CALL, B, 'offer', JSON.stringify(OFFER)]);
  assert.equal((await q(db, null, 'select * from public.native_call_get_signal($1,$2,$3,0)', [CALL, kc, 'offer'])).length, 0);
  await assert.rejects(q(db, null, 'select public.native_call_post_signal($1,$2,$3,$4::jsonb)', [CALL, kc, 'answer', JSON.stringify(ANSWER)]), /not_on_call/);
  await q(db, null, 'select public.native_call_end($1,$2)', [CALL, kc]);
  assert.equal((await q(db, A, 'select public.get_call_status($1) s', [CALL]))[0].s, 'ringing', 'an outsider cannot end it');
  // the caller's key cannot answer on the callee's behalf
  const ka = await key(db, A);
  assert.equal((await q(db, null, 'select public.native_call_answer($1,$2) s', [CALL, ka]))[0].s, null);
});

test('wrong, malformed, replaced and revoked keys do nothing; only a hash is stored', async () => {
  const db = await createDb();
  const old = await key(db, B);
  const fresh = await key(db, B);   // same phone: replaces the old key
  assert.notEqual(old, fresh);
  assert.equal(await status(db, old), null, 'a replaced key is dead');
  assert.equal(await status(db, fresh), 'ringing');
  assert.equal(await status(db, 'gck1.' + '0'.repeat(64)), null);
  assert.equal(await status(db, "x' or '1'='1"), null);
  const stored = (await db.query('select encode(key_hash, $1) h from public.native_call_keys', ['hex'])).rows[0].h;
  assert.ok(!fresh.includes(stored) && stored.length === 64);
  await q(db, B, 'select public.revoke_native_call_key($1)', ['phone-1']);
  assert.equal(await status(db, fresh), null, 'a revoked key is dead');
  await assert.rejects(q(db, null, 'select public.issue_native_call_key($1)', ['p']), /permission denied|not authenticated/);
  await assert.rejects(q(db, B, 'select * from public.native_call_keys'), /permission denied/);
});

test('the native side can write to the call log for its own call only', async () => {
  const db = await createDb();
  const kb = await key(db, B), kc = await key(db, C);
  await q(db, null, 'select public.native_call_log($1,$2,$3)', [CALL, kb, 'native: got offer']);
  await q(db, null, 'select public.native_call_log($1,$2,$3)', [CALL, kc, 'outsider']);
  const rows = (await db.query('select user_id, event from public.call_events')).rows;
  assert.equal(rows.length, 1); assert.equal(rows[0].user_id, B); assert.equal(rows[0].event, 'native: got offer');
});
