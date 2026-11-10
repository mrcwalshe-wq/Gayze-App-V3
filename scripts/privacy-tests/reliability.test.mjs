/**
 * Reliability scoring (migrations 20261107170000 + 20261111090000) in real Postgres (PGlite), same role + claim mechanism as PostgREST.
 *   node --test scripts/privacy-tests/reliability.test.mjs
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync } from 'node:fs';
import { PGlite } from '@electric-sql/pglite';

const read = (f) => readFileSync(new URL(`../../supabase/migrations/${f}`, import.meta.url), 'utf8');
const ME = '00000000-0000-4000-8000-00000000000a';
const P = ['b', 'c', 'd', 'e', 'f'].map((x) => `00000000-0000-4000-8000-00000000000${x}`);

const SCHEMA = `
create role anon nologin; create role authenticated nologin; create role service_role nologin;
create schema auth; create schema private;
create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
create table auth.users(id uuid primary key, created_at timestamptz default now() - interval '100 days');
create table public.profiles(id uuid primary key, display_name text, avatar_path text, reliability_score numeric default 0, verified_peers_count integer default 0);
create table public.account_restrictions(user_id uuid, status text);
create function public.gayze_is_blocked_between(u uuid) returns boolean language sql stable as $$ select false $$;
create function public.gayze_enqueue_notification(a uuid, b uuid, c text, d text, e text) returns void language sql as $$ select $$;
grant usage on schema public, auth, private to authenticated, anon, service_role;
grant all on all tables in schema public to service_role;
grant select on all tables in schema public to authenticated;
grant execute on function auth.uid() to authenticated, anon, service_role;
grant execute on all functions in schema public to authenticated;
`;
async function createDb() {
  const db = new PGlite();
  await db.exec(SCHEMA);
  await db.exec(read('20261107170000_past_meets_reliability.sql'));
  await db.exec(read('20261111090000_reliability_cancel_en_route.sql'));
  for (const id of [ME, ...P]) { await db.query('insert into auth.users(id) values ($1)', [id]); await db.query('insert into public.profiles(id, display_name) values ($1, $2)', [id, 'x']); }
  return db;
}
const as = (db, userId, action) => db.transaction(async (tx) => {
  await tx.exec(userId ? 'set local role authenticated' : 'set local role anon');
  await tx.query("select set_config('request.jwt.claim.sub', $1, true)", [userId ?? '']);
  return action(tx);
});
const q = async (db, user, sql, params = []) => (await as(db, user, (tx) => tx.query(sql, params))).rows;
const summary = async (db, user = ME) => (await q(db, user, 'select public.reliability_summary($1) s', [user]))[0].s;
/** A confirmed meet with `peer`, written the way redeem_meet_qr writes it. */
const meet = (db, peer, daysAgo = 0) => db.exec(`
  insert into public.reliability_events(user_id, counterparty_user_id, event_type, weight, window_bucket, occurred_at)
  values ('${ME}', '${peer}', 'qr_past_meet', 1, ${Math.floor(Math.random() * 1e9)}, now() - interval '${daysAgo} days')`);

test('no number until three outcomes are counted', async () => {
  const db = await createDb();
  await meet(db, P[0]); await meet(db, P[1]);
  let s = await summary(db);
  assert.equal(s.level, 'new'); assert.equal(s.score, null); assert.equal(s.counted, 2);
  await meet(db, P[2]);
  s = await summary(db);
  assert.equal(s.score, 100); assert.equal(s.level, 'highly_reliable');
});

test('cancelling after setting off for a non-safety reason counts against the score', async () => {
  const db = await createDb();
  await meet(db, P[0]); await meet(db, P[1]); await meet(db, P[2]);
  const r = (await q(db, ME, `select public.report_meet_cancel($1, 'meeting-1', 'changed_plans') r`, [P[3]]))[0].r;
  assert.equal(r.counted, true);
  const s = await summary(db);
  assert.equal(s.counted, 4); assert.equal(s.cancelled_en_route, 1); assert.equal(s.score, 75); assert.equal(s.level, 'reliable');
  assert.equal(Number((await db.query(`select reliability_score from public.profiles where id = $1`, [ME])).rows[0].reliability_score), 75, 'profile score follows');
});

test('a safety reason is never held against anyone and records nothing', async () => {
  const db = await createDb();
  await meet(db, P[0]); await meet(db, P[1]); await meet(db, P[2]);
  const r = (await q(db, ME, `select public.report_meet_cancel($1, 'meeting-2', 'safety') r`, [P[3]]))[0].r;
  assert.equal(r.counted, false);
  assert.equal((await summary(db)).score, 100);
  assert.equal(Number((await db.query(`select count(*) from public.reliability_events where event_type = 'cancel_en_route'`)).rows[0].count), 0);
});

test('the same cancellation reported twice counts once', async () => {
  const db = await createDb();
  await q(db, ME, `select public.report_meet_cancel($1, 'meeting-3', 'changed_plans')`, [P[0]]);
  const again = (await q(db, ME, `select public.report_meet_cancel($1, 'meeting-3', 'changed_plans') r`, [P[0]]))[0].r;
  assert.equal(again.counted, false);
  assert.equal((await summary(db)).counted, 1);
});

test('only the last 10 outcomes count, so an old cancellation ages out', async () => {
  const db = await createDb();
  await q(db, ME, `select public.report_meet_cancel($1, 'old', 'changed_plans')`, [P[0]]);
  await db.exec(`update public.reliability_events set occurred_at = now() - interval '200 days' where event_type = 'cancel_en_route'`);
  for (let i = 0; i < 10; i++) await meet(db, P[i % 5], i);
  const s = await summary(db);
  assert.equal(s.counted, 10); assert.equal(s.cancelled_en_route, 0); assert.equal(s.score, 100);
});

test('guards: signed in only, valid reason, not yourself; a stranger cannot write events', async () => {
  const db = await createDb();
  await assert.rejects(q(db, null, `select public.report_meet_cancel($1, 'm', 'changed_plans')`, [P[0]]), /permission denied|not authenticated/);
  await assert.rejects(q(db, ME, `select public.report_meet_cancel($1, 'm', 'whatever')`, [P[0]]), /invalid_reason/);
  await assert.rejects(q(db, ME, `select public.report_meet_cancel($1, 'm', 'changed_plans')`, [ME]), /invalid_request/);
  await assert.rejects(q(db, ME, `insert into public.reliability_events(user_id, counterparty_user_id, event_type, weight, window_bucket) values ($1, $2, 'qr_past_meet', 1, 1)`, [ME, P[0]]), /permission denied/);
});
