// Runs the REAL migration supabase/migrations/20261010090000_call_signalling_realtime_authorization.sql
// in in-process Postgres (PGlite) against a stand-in realtime.messages table, and proves the
// signalling authorization rules. Realtime's own RLS engine is not in PGlite: this proves the
// policy expressions and helper functions, not the Realtime service itself.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { PGlite } from '@electric-sql/pglite';
import { bootstrap, baseSchema } from '../push-tests/lib.mjs';

const REPO = fileURLToPath(new URL('../..', import.meta.url)).replace(/\/$/, '');
const MIGRATION = `${REPO}/supabase/migrations/20261010090000_call_signalling_realtime_authorization.sql`;

const ALICE = '11111111-1111-4111-8111-111111111111';
const BOB = '22222222-2222-4222-8222-222222222222';
const MALLORY = '33333333-3333-4333-8333-333333333333';
const CONV = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const OTHER_CONV = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';

async function setup() {
  const db = new PGlite();
  await bootstrap(db);
  await baseSchema(db);
  await db.exec(`
    create schema realtime;
    create table realtime.messages (
      id uuid primary key default gen_random_uuid(), topic text not null, extension text not null,
      event text, payload jsonb, private boolean default true, inserted_at timestamptz default now());
    create function realtime.topic() returns text language sql stable as
      $$ select nullif(current_setting('realtime.topic', true), '') $$;
    grant usage on schema realtime to authenticated;
    grant select, insert on realtime.messages to authenticated;
    insert into public.conversations (id) values ('${CONV}'), ('${OTHER_CONV}');
    insert into public.conversation_members (conversation_id, user_id) values
      ('${CONV}', '${ALICE}'), ('${CONV}', '${BOB}'), ('${OTHER_CONV}', '${MALLORY}');
  `);
  await db.exec(fs.readFileSync(MIGRATION, 'utf8'));
  await db.exec(fs.readFileSync(MIGRATION, 'utf8'));  // idempotent: re-running must not fail
  return db;
}

// Run one statement as a Realtime-authenticated user on a given channel topic.
async function as(db, uid, topic, sql, params = []) {
  await db.exec('begin');
  try {
    await db.query(`select set_config('request.jwt.claim.sub', $1, true), set_config('realtime.topic', $2, true)`, [uid, topic]);
    await db.exec('set local role authenticated');
    const result = await db.query(sql, params);
    await db.exec('commit');
    return result.rows;
  } catch (error) {
    await db.exec('rollback');
    throw error;
  }
}

const insertSignal = (db, uid, topic, payload) => as(db, uid, topic,
  `insert into realtime.messages (topic, extension, event, payload) values ($1, 'broadcast', 'call-signal', $2::jsonb)`,
  [topic, JSON.stringify(payload)]);
const selectTopic = (db, uid, topic) => as(db, uid, topic,
  `select id from realtime.messages where topic = $1`, [topic]);

const callTopic = `gayze-call-${CONV}`;
const aliceRingsBob = { type: 'call-request', callerId: ALICE, targetUserId: BOB, conversationId: CONV, timestamp: Date.now() };

test('member can ring a conversation peer on the peer user channel', async () => {
  const db = await setup();
  try {
    await insertSignal(db, ALICE, `gayze-user-${BOB}`, aliceRingsBob);
  } finally { await db.close(); }
});

test('a caller cannot speak as another participant (callerId spoofing is denied)', async () => {
  const db = await setup();
  try {
    await assert.rejects(insertSignal(db, BOB, `gayze-user-${ALICE}`,
      { ...aliceRingsBob, callerId: ALICE, targetUserId: ALICE }), /row-level security/);
    await assert.rejects(insertSignal(db, MALLORY, callTopic,
      { type: 'offer', callerId: ALICE, conversationId: CONV, timestamp: Date.now() }), /row-level security/);
  } finally { await db.close(); }
});

test('non-members cannot ring a user or inject into a call channel', async () => {
  const db = await setup();
  try {
    // Mallory is not in CONV: ringing Bob in CONV is refused.
    await assert.rejects(insertSignal(db, MALLORY, `gayze-user-${BOB}`,
      { ...aliceRingsBob, callerId: MALLORY }), /row-level security/);
    // Alice cannot ring someone who does not share the conversation.
    await assert.rejects(insertSignal(db, ALICE, `gayze-user-${MALLORY}`,
      { ...aliceRingsBob, targetUserId: MALLORY }), /row-level security/);
    await assert.rejects(insertSignal(db, MALLORY, callTopic,
      { type: 'call-accept', callerId: MALLORY, conversationId: CONV, timestamp: Date.now() }), /row-level security/);
  } finally { await db.close(); }
});

test('a payload may only target the conversation its channel names', async () => {
  const db = await setup();
  try {
    await assert.rejects(insertSignal(db, ALICE, callTopic,
      { type: 'offer', callerId: ALICE, conversationId: OTHER_CONV, timestamp: Date.now() }), /row-level security/);
  } finally { await db.close(); }
});

test('only the owner receives its personal channel; only members receive call channels', async () => {
  const db = await setup();
  try {
    await insertSignal(db, ALICE, `gayze-user-${BOB}`, aliceRingsBob);
    assert.equal((await selectTopic(db, BOB, `gayze-user-${BOB}`)).length, 1);
    assert.equal((await selectTopic(db, ALICE, `gayze-user-${BOB}`)).length, 0);   // caller cannot read the ring feed
    assert.equal((await selectTopic(db, MALLORY, `gayze-user-${BOB}`)).length, 0);
    await insertSignal(db, ALICE, callTopic, { type: 'offer', callerId: ALICE, conversationId: CONV, timestamp: Date.now() });
    assert.equal((await selectTopic(db, BOB, callTopic)).length, 1);
    assert.equal((await selectTopic(db, MALLORY, callTopic)).length, 0);           // outsider cannot listen to SDP/ICE
  } finally { await db.close(); }
});

test('anonymous/unauthenticated clients cannot send or receive call signalling', async () => {
  const db = await setup();
  try {
    await assert.rejects(as(db, '', `gayze-user-${BOB}`,
      `insert into realtime.messages (topic, extension, event, payload) values ($1,'broadcast','call-signal','{}'::jsonb)`,
      [`gayze-user-${BOB}`]), /row-level security|permission denied/);
  } finally { await db.close(); }
});
