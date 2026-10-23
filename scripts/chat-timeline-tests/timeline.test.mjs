import assert from 'node:assert/strict';
import { test } from 'node:test';
import { loadModule } from '../recovery-tests/load-module.mjs';
const { buildChatTimeline, roomActivityAt } = await loadModule('src/services/chatTimeline.ts');
const { buildRoomsFromSupabase, mergeBackendRooms } = await loadModule('src/services/conversationRooms.ts');

const iso = (ms) => new Date(ms).toISOString();
const msg = (id, at) => ({ id, timestamp: at });
const gz = (id, at) => ({ id, createdAt: iso(at) });

test('a Gayze sits where it happened, between messages, not above history', () => {
  const t = buildChatTimeline([msg('a', 1000), msg('b', 3000)], [gz('g1', 2000)]);
  assert.deepEqual(t.map((e) => e.kind === 'message' ? e.message.id : 'GAYZE'), ['a', 'GAYZE', 'b']);
});

test('back-to-back Gayzes collapse into one event with a count', () => {
  const t = buildChatTimeline([msg('a', 1000), msg('b', 9000)], [gz('g1', 2000), gz('g2', 3000), gz('g3', 4000)]);
  assert.equal(t.length, 3);
  assert.equal(t[1].kind, 'gayze');
  assert.equal(t[1].count, 3);
  assert.equal(t[1].latestCreatedAt, iso(4000));
});

test('Gayzes separated by a message stay separate events', () => {
  const t = buildChatTimeline([msg('a', 3000)], [gz('g1', 1000), gz('g2', 5000)]);
  assert.deepEqual(t.map((e) => e.kind), ['gayze', 'message', 'gayze']);
});

test('hidden older history drops Gayzes older than the first shown message', () => {
  const t = buildChatTimeline([msg('b', 5000)], [gz('old', 1000), gz('new', 6000)], true);
  assert.deepEqual(t.map((e) => e.kind), ['message', 'gayze']);
  assert.equal(buildChatTimeline([msg('b', 5000)], [gz('old', 1000)], false).length, 2);
});

test('room activity is the latest of last message, loaded message and peer Gayze', () => {
  assert.equal(roomActivityAt(10, 20, 15), 20);
  assert.equal(roomActivityAt(10, undefined, 30), 30);
  assert.equal(roomActivityAt(10, undefined, undefined), 10);
});

test('first load orders conversations by latest message, not creation time', () => {
  const user = 'u0';
  const rooms = buildRoomsFromSupabase({
    summaries: [
      { id: 'old-active', createdAt: iso(1000), lastMessageAt: iso(9000) },
      { id: 'new-quiet', createdAt: iso(5000), lastMessageAt: null },
    ],
    members: [
      { conversationId: 'old-active', userId: user }, { conversationId: 'old-active', userId: 'p1' },
      { conversationId: 'new-quiet', userId: user }, { conversationId: 'new-quiet', userId: 'p2' },
    ],
    profiles: [{ userId: 'p1', displayName: 'P1' }, { userId: 'p2', displayName: 'P2' }],
  }, user);
  const merged = mergeBackendRooms([], rooms, user);
  assert.deepEqual(merged.map((r) => r.id), ['old-active', 'new-quiet']);
  assert.equal(merged[0].lastMessage, 'Encrypted message');
  assert.equal(merged[1].lastMessage, '');
});

test('a message on another device moves an already-loaded chat up on the next poll', () => {
  const user = 'u0';
  const mk = (id, created, last) => buildRoomsFromSupabase({
    summaries: [{ id, createdAt: iso(created), lastMessageAt: last ? iso(last) : null }],
    members: [{ conversationId: id, userId: user }, { conversationId: id, userId: 'p-' + id }],
    profiles: [{ userId: 'p-' + id, displayName: id }],
  }, user)[0];
  const first = mergeBackendRooms([], [mk('a', 1000, null), mk('b', 2000, null)], user);
  assert.deepEqual(first.map((r) => r.id), ['b', 'a']);
  const next = mergeBackendRooms(first, [mk('a', 1000, 8000), mk('b', 2000, null)], user);
  assert.deepEqual(next.map((r) => r.id), ['a', 'b']);
});
