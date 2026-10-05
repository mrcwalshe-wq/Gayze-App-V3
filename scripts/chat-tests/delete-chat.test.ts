import test from 'node:test';
import assert from 'node:assert/strict';
import { ChatMessageProcessor } from '../../src/services/chatMessageProcessing.ts';

const room = (id: string) => ({ id, type: 'direct', peerKey: '', memberIds: ['u', id] }) as any;

test('forgetConversation drops only the deleted room; other rooms keep warm key state', async () => {
  let resolves = 0;
  const p = new ChatMessageProcessor(async () => { resolves++; return { key: {} as CryptoKey, status: 'ready' as const }; }, async () => 'plain');
  await p.key(room('a'), 'u'); await p.key(room('b'), 'u');
  assert.equal(resolves, 2);
  p.forgetConversation('a');
  await p.key(room('b'), 'u');
  assert.equal(resolves, 2, 'unrelated room is still cached');
  await p.key(room('a'), 'u');
  assert.equal(resolves, 3, 'deleted room is re-resolved');
});

import { DeletedRoomTracker } from '../../src/services/deletedRooms.ts';

test('delete -> refresh stays hidden; stale in-flight loads cannot resurrect; recreated room reappears', () => {
  const t = new DeletedRoomTracker();
  const rooms = [{ id: 'a' }, { id: 'b' }];
  const staleLoadEpoch = t.currentEpoch;           // load started before the delete
  t.begin('a');
  assert.deepEqual(t.filter(rooms, t.currentEpoch).map((r) => r.id), ['b'], 'hidden while the delete is in flight');
  t.confirm('a');
  assert.deepEqual(t.filter(rooms, staleLoadEpoch).map((r) => r.id), ['b'], 'stale load cannot resurrect it');
  // A refresh started after the delete that still lists it is server truth
  // (conversation legitimately recreated) -> visible again.
  assert.deepEqual(t.filter(rooms, t.currentEpoch).map((r) => r.id), ['a', 'b']);
  // And the entry is not a permanent blacklist.
  assert.deepEqual(t.filter(rooms, staleLoadEpoch).map((r) => r.id), ['a', 'b']);
});

test('failed delete leaves the room visible', () => {
  const t = new DeletedRoomTracker();
  t.begin('a'); t.fail('a');
  assert.deepEqual(t.filter([{ id: 'a' }], t.currentEpoch).map((r) => r.id), ['a']);
});
