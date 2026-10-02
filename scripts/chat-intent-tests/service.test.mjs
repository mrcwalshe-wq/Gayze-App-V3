import assert from 'node:assert/strict';
import { test } from 'node:test';
import { loadModule } from '../recovery-tests/load-module.mjs';
import { user, peer, other, roomId, room, intentRow, environment, backend, flush } from './fixtures.mjs';
const { parsePeerIntent, watchPeerIntent } = await loadModule('src/services/peerIntent.ts');
const { findDirectRoom, resolveLiveDirectChat } = await loadModule('src/services/directChatRouting.ts');
const { intentStartsAt, intentWhenLabel } = await loadModule('src/services/intentTiming.ts');

function watcher() {
  const db = backend(), env = environment(), states = [];
  return { db, env, states, start: () => watchPeerIntent(user, peer, s => states.push(s), db, env) };
}

test('stable peer ID only; cached authorized room bypasses interest and list I/O', async () => {
  const wrong = room(roomId, other), right = room();
  assert.equal(findDirectRoom([wrong], peer), undefined);
  assert.equal(findDirectRoom([{ ...right, type: 'gathering' }], peer), undefined);
  const target = await resolveLiveDirectChat({ peerId: peer, rooms: [wrong, right], current: () => true,
    loadRooms: () => assert.fail('unnecessary list read'), submitInterest: () => assert.fail('unnecessary interest') });
  assert.equal(target.room, right);
});

test('not-yet-hydrated existing room loads by stable peer before requesting match', async () => {
  const target = await resolveLiveDirectChat({ peerId: peer, rooms: [], current: () => true,
    loadRooms: async () => [room()], submitInterest: () => assert.fail('existing membership must be reused') });
  assert.equal(target.kind, 'existing'); assert.equal(target.room.id, roomId);
});

test('new live conversations require backend mutual-match ID; pending/error cannot create demo rooms', async () => {
  const options = { peerId: peer, rooms: [], current: () => true, loadRooms: async () => [] };
  assert.deepEqual(await resolveLiveDirectChat({ ...options, submitInterest: async () => ({ sent: true, mutual: false }) }), { kind: 'pending' });
  assert.deepEqual(await resolveLiveDirectChat({ ...options, submitInterest: async () => ({ sent: true, mutual: true, conversation_id: roomId }) }), { kind: 'matched', conversationId: roomId });
  for (const result of [{ sent: false, mutual: false }, { sent: true, mutual: true }, { sent: true, mutual: true, conversation_id: 'room_fake' }]) {
    await assert.rejects(resolveLiveDirectChat({ ...options, submitInterest: async () => result }));
  }
  await assert.rejects(resolveLiveDirectChat({ ...options, loadRooms: async () => null, submitInterest: () => assert.fail('failed list cannot create') }));
  await assert.rejects(resolveLiveDirectChat({ ...options, peerId: 'display-name', submitInterest: () => assert.fail() }));
});

test('account change or newer selection cancels async routing after list/match', async () => {
  let current = true;
  const options = { peerId: peer, rooms: [], current: () => current,
    loadRooms: async () => { current = false; return [room()]; }, submitInterest: () => assert.fail() };
  assert.equal((await resolveLiveDirectChat(options)).kind, 'cancelled');
  current = true;
  assert.equal((await resolveLiveDirectChat({ ...options, loadRooms: async () => [],
    submitInterest: async () => { current = false; return { mutual: true, sent: true, conversation_id: roomId }; } })).kind, 'cancelled');
});

test('peer row validation rejects other identity, paused/expired/malformed/unknown-mode data', () => {
  const now = Date.now(), row = intentRow(now);
  assert.equal(parsePeerIntent(row, peer, now).mode, 'social');
  assert.equal(parsePeerIntent({ ...row, mode: 'private' }, peer, now).mode, 'private');
  for (const override of [{ user_id: other }, { is_paused: true }, { mode: 'unknown' }, { starts_at: null },
    { expires_at: 'bad' }, { expires_at: new Date(now).toISOString() }, { intent: '' }, { starts_at: row.expires_at }]) {
    assert.equal(parsePeerIntent({ ...row, ...override }, peer, now), null);
  }
});

test('watcher reads only authenticated peer data and authoritative update/pause/delete/replacement', async () => {
  const { db, env, states, start } = watcher(); db.rows = [intentRow(env.now()), intentRow(env.now(), { user_id: other })];
  const owner = start();
  try {
    await env.advance(200); assert.equal(states.at(-1).intent.intent, 'Coffee');
    assert.equal(db.channels.length, 1);
    assert.equal(db.channels[0].bindings[0].filter.filter, `user_id=eq.${peer}`);
    assert(db.reads.every(r => r.limit === 1 && r.filters.user_id === peer && r.filters.is_paused === false));
    db.rows[0] = { ...db.rows[0], mode: 'private', intent: 'Meet' };
    db.channels[0].emit({ new: { intent: 'DO NOT TRUST PAYLOAD' } }); await flush();
    assert.equal(states.at(-1).intent.mode, 'private'); assert.equal(states.at(-1).intent.intent, 'Meet');
    db.rows[0].is_paused = true; db.channels[0].emit(); await flush(); assert.equal(states.at(-1).status, 'none');
    db.rows.unshift(intentRow(env.now(), { id: 'replacement' })); db.channels[0].emit(); await flush();
    assert.equal(states.at(-1).intent.id, 'replacement');
    db.rows = []; // No DELETE event: fallback read covers it.
    await env.advance(15_001); assert.equal(states.at(-1).status, 'none');
    assert.equal(db.channels.length, 1, 'data invalidation must not rejoin');
  } finally { owner.stop(); }
  assert.equal(env.timers.size, 0); assert.equal(env.watchers.size, 0); assert.equal(db.authListeners.size, 0);
});

test('expiry disappears without a realtime event; error clears previous intent and recovery refetches', async () => {
  const { db, env, states, start } = watcher(); db.rows = [intentRow(env.now(), { expires_at: new Date(env.now() + 4000).toISOString() })];
  const owner = start();
  try {
    await env.advance(200); assert.equal(states.at(-1).status, 'ready');
    await env.advance(4000); assert.equal(states.at(-1).status, 'none');
    db.rows = [intentRow(env.now())]; owner.refresh(); await flush(); assert.equal(states.at(-1).status, 'ready');
    db.error = { message: 'RLS/read unavailable' }; owner.refresh(); await flush(); assert.equal(states.at(-1).status, 'unavailable');
    db.error = null; await env.advance(1500); assert.equal(states.at(-1).status, 'ready');
  } finally { owner.stop(); }
});

test('background/offline clears stale banner; foreground reconciles; old channels cannot publish', async () => {
  const { db, env, states, start } = watcher(); db.rows = [intentRow(env.now())]; const owner = start();
  try {
    await env.advance(200); const old = db.channels[0];
    env.isVisible = false; env.event(); await flush(); assert.equal(states.at(-1).status, 'unavailable');
    db.rows = [intentRow(env.now(), { intent: 'New plan' })];
    env.isVisible = true; env.event(); await env.advance(1001); assert.equal(states.at(-1).intent.intent, 'New plan');
    const count = states.length; old.emit(); await flush(); assert.equal(states.length, count);
    env.isOnline = false; env.event(); assert.equal(states.at(-1).status, 'unavailable');
    env.isOnline = true; env.event(); await env.advance(1001); assert.equal(states.at(-1).status, 'ready');
    db.authEvent('SIGNED_IN', other); await flush(); assert.equal(states.at(-1).status, 'unavailable');
    const afterAccount = states.length; db.channels.at(-1).emit(); await flush(); assert.equal(states.length, afterAccount);
  } finally { owner.stop(); }
});

test('late REST response after room unmount cannot publish or leave expiry timers', async () => {
  const { db, env, states, start } = watcher(); let release; db.held = new Promise(r => { release = r; });
  db.rows = [intentRow(env.now())]; const owner = start(); await env.advance(200); owner.stop(); const count = states.length;
  release(); await flush(); assert.equal(states.length, count); assert.equal(env.timers.size, 0);
});

test('RLS-empty/no session/no client/own user fails closed rather than fabricating peer intent', async () => {
  const { db, env, states, start } = watcher(); const owner = start(); await env.advance(200); assert.equal(states.at(-1).status, 'none'); owner.stop();
  for (const [client, target] of [[null, peer], [db, user]]) {
    const result = []; watchPeerIntent(user, target, s => result.push(s), client); assert.equal(result.at(-1).status, 'unavailable');
  }
  db.sessionUser = null; const denied = start(); await env.advance(200); assert.equal(states.at(-1).status, 'unavailable'); denied.stop();
});

test('composer scheduling persists real future starts and expired activation age never means LATER', () => {
  const morning = new Date(2026, 9, 1, 10).getTime();
  assert.equal(intentStartsAt('Now', morning), morning);
  assert.equal(intentStartsAt('Next 1 hour', morning), morning + 3_600_000);
  assert.equal(intentStartsAt('Next 2 hours', morning), morning + 7_200_000);
  assert.equal(new Date(intentStartsAt('Tonight', morning)).getHours(), 19);
  const late = new Date(2026, 9, 1, 22).getTime(); assert.equal(intentStartsAt('Tonight', late), late);
  assert.equal(intentWhenLabel(morning - 7_200_000, morning), 'Now');
  assert.equal(intentWhenLabel(morning + 3_600_000, morning), 'Next 1 hour');
  assert.equal(intentWhenLabel(morning + 7_200_000, morning), 'Next 2 hours');
});

test('in-flight invalidation cannot publish the replaced snapshot; stalled REST cannot stay current', async () => {
  const { db, env, states, start } = watcher(); db.rows = [intentRow(env.now())]; const owner = start();
  try {
    await env.advance(200); assert.equal(states.at(-1).intent.intent, 'Coffee');
    let release; db.held = new Promise(r => { release = r; }); owner.refresh(); await flush();
    db.rows = [intentRow(env.now(), { intent: 'Replacement' })]; db.channels[0].emit();
    const count = states.length; release(); db.held = null; await flush();
    assert.equal(states.length, count, 'invalidated response must not republish Coffee');
    await env.advance(1); assert.equal(states.at(-1).intent.intent, 'Replacement');
    db.held = new Promise(() => {}); owner.refresh(); await flush();
    await env.advance(30_001); assert.equal(states.at(-1).status, 'unavailable');
  } finally { owner.stop(); }
});

test('healthy REST remains useful during a realtime join failure, without faking presence', async () => {
  const { db, env, states, start } = watcher(); db.rows = [intentRow(env.now())];
  const channel = db.channel.bind(db);
  db.channel = topic => {
    const ch = channel(topic);
    ch.subscribe = cb => { ch.status = cb; return ch; }; // No JOIN acknowledgement.
    return ch;
  };
  const owner = start();
  try {
    await env.advance(200); assert.equal(states.at(-1).status, 'ready');
    db.rows = [intentRow(env.now(), { intent: 'REST updated' })];
    await env.advance(15_001); assert.equal(states.at(-1).intent.intent, 'REST updated');
  } finally { owner.stop(); }
});
