import assert from 'node:assert/strict';
import { test } from 'node:test';
import { ChatHistoryOwnership } from '../../src/services/chatHistoryOwnership';
import { reconcileMessages } from '../../src/services/chatSubscriptions';
import { mergeBackendRooms } from '../../src/services/conversationRooms';
import { ChatMessageProcessor } from '../../src/services/chatMessageProcessing';
import { beginChatTrace, traceChat, countChatWork, clearChatTrace } from '../../src/services/chatTrace';
import { row, messageBackend } from '../chat-tests/fixtures';

test('warm history is allowed only with a complete readable room and healthy account-wide owner', () => {
  const ownership = new ChatHistoryOwnership();
  ownership.roomComplete('room', true); assert(!ownership.canReuse('room'));
  ownership.inboxState('connected'); ownership.roomComplete('room', false); assert(!ownership.canReuse('room'));
  ownership.roomComplete('room', true); assert(ownership.canReuse('room'));
  assert(!ownership.canReuse('other'));
  ownership.unseenOlderRow('room'); assert(!ownership.canReuse('room'));
  for (const state of ['connecting', 'syncing', 'reconnecting', 'offline', 'suspended', 'sign-in-required'] as const) {
    ownership.inboxState('connected'); ownership.roomComplete('room', true);
    ownership.inboxState(state); assert(!ownership.canReuse('room'), state);
  }
  ownership.inboxState('connected'); ownership.roomComplete('room', true); ownership.clear(); assert(!ownership.canReuse('room'));
});

test('warm recent read is one bounded request instead of a repeated full scan; fallback still recovers old rows', async () => {
  const rows = Array.from({ length: 1000 }, (_, i) => row(i));
  const db = messageBackend(rows); const seen: string[] = [];
  await reconcileMessages(db as any, 'room', new AbortController().signal, async r => { seen.push(r.id); }, undefined, 'user', 50);
  assert.equal(db.requests.length, 1); assert.equal(seen.length, 50); assert.equal(seen.at(-1), row(950).id);
  db.requests.length = 0; seen.length = 0;
  await reconcileMessages(db as any, 'room', new AbortController().signal, async r => { seen.push(r.id); }, undefined, 'user');
  assert.equal(seen.length, 1000); assert.equal(db.requests.length, 7); assert(seen.includes(row(0).id));
});

test('recent budget crosses small server caps without omission or overshoot', async () => {
  const db = messageBackend(Array.from({ length: 100 }, (_, i) => row(i)), 19);
  const seen: string[] = [];
  await reconcileMessages(db as any, 'room', new AbortController().signal, async r => { seen.push(r.id); }, undefined, 'user', 50);
  assert.deepEqual(db.requests.map(r => r.limit), [50, 31, 12]);
  assert.equal(new Set(seen).size, 50); assert.equal(seen.at(-1), row(50).id);
});

test('timing is opt-in, bounded and excludes room IDs, message contents, keys and URLs', () => {
  clearChatTrace(); const host = globalThis as any;
  beginChatTrace('private-room-id'); assert.equal(host.__GAYZE_CHAT_TRACES__, undefined);
  host.__GAYZE_CHAT_TRACE_ENABLED__ = true;
  beginChatTrace('private-room-id'); traceChat('private-room-id', 'shell-commit'); countChatWork('private-room-id', 'pages');
  traceChat('other-room', 'first-page');
  assert.equal(host.__GAYZE_CHAT_TRACES__[0].pages, 1);
  assert.equal(host.__GAYZE_CHAT_TRACES__[0].stagesMs['first-page'], undefined);
  for (let i = 0; i < 20; i++) beginChatTrace(`private-room-${i}`);
  assert.equal(host.__GAYZE_CHAT_TRACES__.length, 16);
  assert(!JSON.stringify(host.__GAYZE_CHAT_TRACES__).includes('private-room'));
  clearChatTrace(); delete host.__GAYZE_CHAT_TRACE_ENABLED__;
});


test('newest-first backfill cannot evict every recent decrypt result before warm reopen', async () => {
  let decrypts = 0;
  const processor = new ChatMessageProcessor(async () => ({ key: {} as CryptoKey, status: 'ready' }), async () => { decrypts++; return 'fixture'; });
  const room: any = { id: 'room', type: 'direct' };
  for (let i = 999; i >= 0; i--) await processor.text(room, row(i), 'user');
  assert.equal(decrypts, 1000);
  for (let i = 999; i >= 950; i--) await processor.text(room, row(i), 'user');
  assert.equal(decrypts, 1000, 'recent 50 must survive a longer backfill');
});


test('unchanged conversation poll is a referential no-op; avatar/presence removal still clears stale presentation', () => {
  const room: any = { id: 'room', name: 'Peer', type: 'direct', peerName: 'Peer', peerUserId: 'peer', peerAvatar: 'photo/old', peerLastSeenAt: 123, memberIds: ['user','peer'], memberNames: { user: 'You', peer: 'Peer' }, lastTimestamp: 1 };
  const existing = [room];
  assert.equal(mergeBackendRooms(existing, [{ ...room, memberIds: [...room.memberIds], memberNames: { ...room.memberNames } }], 'user'), existing);
  const next = mergeBackendRooms(existing, [{ ...room, peerAvatar: undefined, peerLastSeenAt: undefined }], 'user');
  assert.notEqual(next, existing); assert.equal(next[0].peerAvatar, undefined); assert.equal(next[0].peerLastSeenAt, undefined);
});
