/**
 * "Calls need an accepted GAYZE" (migration 20261112100000) run in real Postgres (PGlite), under the same role + claim
 * mechanism as PostgREST. The earlier test for this migration only pattern-matched the SQL text, so it passed even while the
 * file could not be applied at all.
 *   node --test scripts/privacy-tests/call-gating.test.mjs
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync } from 'node:fs';
import { PGlite } from '@electric-sql/pglite';

const migration = readFileSync(new URL('../../supabase/migrations/20261112100000_calls_require_accepted_gayze.sql', import.meta.url), 'utf8');
const A = '00000000-0000-4000-8000-00000000000a';
const B = '00000000-0000-4000-8000-00000000000b';
const C = '00000000-0000-4000-8000-00000000000c'; // shares a chat with A, no accepted GAYZE
const D = '00000000-0000-4000-8000-00000000000d'; // accepted GAYZE with A, no shared chat
const CONV = '22222222-2222-4222-8222-222222222222';
const CONV_AC = '33333333-3333-4333-8333-333333333333';
const hardening = readFileSync(new URL('../../supabase/migrations/20261112130000_call_security_hardening.sql', import.meta.url), 'utf8');
const answeredAt = readFileSync(new URL('../../supabase/migrations/20261113090000_call_answered_at.sql', import.meta.url), 'utf8');
const call = (n) => `11111111-1111-4111-8111-${String(n).padStart(12, '0')}`;

const SCHEMA = `
create role anon nologin; create role authenticated nologin; create role service_role nologin;
create schema auth;
create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
create table public.profiles(id uuid primary key, display_name text);
create table public.conversation_members(conversation_id uuid, user_id uuid);
create table public.interests(id uuid primary key default gen_random_uuid(), from_user_id uuid, to_user_id uuid, status text default 'pending');
create table public.blocks(a uuid, b uuid);
create function public.gayze_is_blocked_between(p_other uuid) returns boolean language sql stable security definer as
  $$ select exists (select 1 from public.blocks where (a = auth.uid() and b = p_other) or (b = auth.uid() and a = p_other)) $$;
create table public.call_sessions(id uuid primary key, conversation_id uuid, caller_id uuid, callee_id uuid, call_type text,
  status text not null default 'ringing', created_at timestamptz default now(), ended_at timestamptz, hung_up_at timestamptz);
alter table public.call_sessions enable row level security;
grant usage on schema public, auth to authenticated, anon, service_role;
grant execute on function auth.uid() to authenticated, anon, service_role;
`;
async function createDb() {
  const db = new PGlite();
  await db.exec(SCHEMA);
  await db.exec(migration);
  await db.exec(`
    insert into public.profiles values ('${A}','Ay'),('${B}','Bee'),('${C}','Cee'),('${D}','Dee');
    insert into public.conversation_members values ('${CONV}','${A}'),('${CONV}','${B}'),('${CONV_AC}','${A}'),('${CONV_AC}','${C}');
    insert into public.interests(from_user_id, to_user_id, status) values ('${A}','${D}','mutual');
  `);
  return db;
}
const as = (db, userId, action) => db.transaction(async (tx) => {
  await tx.exec(userId ? 'set local role authenticated' : 'set local role anon');
  await tx.query("select set_config('request.jwt.claim.sub', $1, true)", [userId ?? '']);
  return action(tx);
});
const q = async (db, user, sql, params = []) => (await as(db, user, (tx) => tx.query(sql, params))).rows;
const start = (db, user, id, conv, callee, type = 'audio') => q(db, user, 'select public.start_call_session($1,$2,$3,$4)', [id, conv, callee, type]);
const setInterest = (db, from, to, status) => db.query('insert into public.interests(from_user_id, to_user_id, status) values ($1,$2,$3)', [from, to, status]);
const status = async (db, id) => (await db.query('select status from public.call_sessions where id = $1', [id])).rows[0]?.status;

test('the migration file applies cleanly', async () => { await createDb(); });

test('no GAYZE at all: a call cannot be started, even between two people who share a chat', async () => {
  const db = await createDb();
  await assert.rejects(start(db, A, call(1), CONV, B), /accepted Gayze required/);
  assert.equal(await status(db, call(1)), undefined);
});

for (const state of ['pending', 'declined', 'withdrawn']) {
  test(`a ${state} GAYZE does not allow a call in either direction`, async () => {
    const db = await createDb();
    await setInterest(db, A, B, state);
    await assert.rejects(start(db, A, call(1), CONV, B), /accepted Gayze required/);
    await assert.rejects(start(db, B, call(2), CONV, A), /accepted Gayze required/);
  });
}

test('an accepted GAYZE allows a call from either person', async () => {
  const db = await createDb();
  await setInterest(db, A, B, 'mutual');
  await start(db, A, call(1), CONV, B);
  assert.equal(await status(db, call(1)), 'ringing');
  await start(db, B, call(2), CONV, A, 'video');
  assert.equal(await status(db, call(2)), 'ringing');
});

test('an accepted GAYZE is not enough without a shared chat, and a shared chat is not enough without one', async () => {
  const db = await createDb();
  await assert.rejects(start(db, A, call(1), CONV, D), /not a conversation member/);
  await assert.rejects(start(db, A, call(2), CONV_AC, C), /accepted Gayze required/);
  // Naming a chat the caller is in, for a callee who is not in it, is refused too.
  await assert.rejects(start(db, A, call(3), CONV_AC, D), /not a conversation member/);
});

test('signed-out, self-calls, bad call types and blocked pairs are refused', async () => {
  const db = await createDb();
  await setInterest(db, A, B, 'mutual');
  await assert.rejects(start(db, null, call(1), CONV, B));
  await assert.rejects(start(db, A, call(2), CONV, A), /invalid callee/);
  await assert.rejects(start(db, A, call(3), CONV, B, 'screen'), /invalid call type/);
  await db.query('insert into public.blocks values ($1,$2)', [B, A]);
  await assert.rejects(start(db, A, call(4), CONV, B), /blocked/);
});

test('the ringing call is only shown to the person called, and not once the GAYZE is no longer accepted', async () => {
  const db = await createDb();
  await setInterest(db, A, B, 'mutual');
  await start(db, A, call(1), CONV, B);
  assert.equal((await q(db, B, 'select * from public.get_ringing_call()')).length, 1);
  assert.equal((await q(db, A, 'select * from public.get_ringing_call()')).length, 0);
  assert.equal((await q(db, C, 'select * from public.get_ringing_call()')).length, 0);
  await db.query("update public.interests set status = 'withdrawn' where from_user_id = $1 and to_user_id = $2", [A, B]);
  assert.equal((await q(db, B, 'select * from public.get_ringing_call()')).length, 0);
});

test('only the two people on a call can answer or end it; an ended call cannot be answered again', async () => {
  const db = await createDb();
  await setInterest(db, A, B, 'mutual');
  await start(db, A, call(1), CONV, B);
  await q(db, C, 'select public.end_call_session($1,$2)', [call(1), 'ended']);
  assert.equal(await status(db, call(1)), 'ringing');
  await q(db, B, 'select public.end_call_session($1,$2)', [call(1), 'answered']);
  assert.equal(await status(db, call(1)), 'answered');
  await q(db, A, 'select public.end_call_session($1,$2)', [call(1), 'ended']);
  assert.equal(await status(db, call(1)), 'ended');
  await q(db, B, 'select public.end_call_session($1,$2)', [call(1), 'answered']);
  assert.equal(await status(db, call(1)), 'ended');
});

test('starting a new call ends the caller\'s earlier unanswered one', async () => {
  const db = await createDb();
  await setInterest(db, A, B, 'mutual');
  await start(db, A, call(1), CONV, B);
  await start(db, A, call(2), CONV, B);
  assert.equal(await status(db, call(1)), 'ended');
  assert.equal(await status(db, call(2)), 'ringing');
});

test('nobody can record an accepted GAYZE for themselves by writing the table directly', async () => {
  const db = await createDb();
  // Production before the fix: table grants plus an insert policy that only checks the sender.
  await db.exec(`
    alter table public.interests enable row level security;
    grant select, insert, update, delete on public.interests to authenticated, anon;
    create policy interests_participant_select on public.interests for select to authenticated using (auth.uid() in (from_user_id, to_user_id));
    create policy interests_sender_insert on public.interests for insert to authenticated with check (auth.uid() = from_user_id);
  `);
  await q(db, A, "insert into public.interests(from_user_id, to_user_id, status) values ($1,$2,'mutual')", [A, C]);
  await start(db, A, call(1), CONV_AC, C); // the bypass, as it stood
  await db.query('delete from public.interests where from_user_id = $1 and to_user_id = $2', [A, C]);
  await db.query('delete from public.call_sessions');

  await db.exec(hardening);
  await assert.rejects(q(db, A, "insert into public.interests(from_user_id, to_user_id, status) values ($1,$2,'mutual')", [A, C]), /permission denied/);
  await assert.rejects(q(db, A, "update public.interests set status = 'mutual' where from_user_id = $1", [A]), /permission denied/);
  await assert.rejects(start(db, A, call(2), CONV_AC, C), /accepted Gayze required/);
  // Reading your own rows still works.
  assert.equal((await q(db, A, 'select 1 from public.interests')).length, 1);
});

test('an answered call stays counted as answered after it is hung up', async () => {
  const db = await createDb();
  await db.exec(answeredAt);
  await setInterest(db, A, B, 'mutual');
  await start(db, A, call(1), CONV, B);
  await start(db, B, call(2), CONV, A);
  await q(db, B, 'select public.end_call_session($1,$2)', [call(1), 'answered']);
  await q(db, A, 'select public.end_call_session($1,$2)', [call(1), 'ended']);
  await q(db, A, 'select public.end_call_session($1,$2)', [call(2), 'ended']); // declined, never answered
  const rows = (await db.query('select id, status, answered_at is not null answered from public.call_sessions order by id')).rows;
  assert.deepEqual(rows.map((r) => [r.status, r.answered]), [['ended', true], ['ended', false]]);
});
