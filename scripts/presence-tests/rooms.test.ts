import test from 'node:test';
import assert from 'node:assert/strict';
import { buildRoomsFromSupabase } from '../../src/services/conversationRooms.ts';

const base = (gatheringChats?: Record<string, { gatheringId: string; title: string }>) => ({
  summaries: [{ id: 'c1', createdAt: '2026-11-07T04:18:00Z', lastMessageAt: null }],
  members: [{ conversationId: 'c1', userId: 'me' }, { conversationId: 'c1', userId: 'guest' }],
  profiles: [{ userId: 'me', displayName: 'Chris', avatarPath: null, lastSeenAt: null }, { userId: 'guest', displayName: 'Rumble', avatarPath: null, lastSeenAt: null }],
  gatheringChats,
}) as never;

test('a two-member chat is a direct chat', () => {
  const [room] = buildRoomsFromSupabase(base(), 'me');
  assert.equal(room.type, 'direct');
  assert.equal(room.name, 'Rumble');
});

test('a gathering chat with one accepted guest is a group named after the gathering, not a chat with that guest', () => {
  const [room] = buildRoomsFromSupabase(base({ c1: { gatheringId: 'g1', title: 'Dex partty' } }), 'me');
  assert.equal(room.type, 'gathering');
  assert.equal(room.name, 'Dex partty');
  assert.equal(room.gatheringId, 'g1');
  assert.equal(room.peerUserId, undefined);
});
