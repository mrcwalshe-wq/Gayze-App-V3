import assert from 'node:assert/strict';
import { test } from 'node:test';
import { webcrypto } from 'node:crypto';
import { ChatMessageProcessor, MessageBatcher } from '../../src/services/chatMessageProcessing';
import { MessageAlerts } from '../../src/services/messageAlerts';
import { mergeMessages } from '../../src/services/messageMerge';
import { reconcileMessages } from '../../src/services/chatSubscriptions';
import { encryptWithConversationKey, decryptWithConversationKey } from '../../src/services/cryptoService';
import { row, messageBackend, delay } from './fixtures';
Object.defineProperty(globalThis, 'window', { configurable: true, value: { crypto: webcrypto } });
const room: any = { id: 'room', type: 'direct', memberIds: ['user', 'peer'] };
const key = await webcrypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']) as CryptoKey;
const encrypted = await encryptWithConversationKey('private test text', key);
const encryptedRow = { ...row(1), ciphertext: encrypted.cipherHex, nonce: encrypted.nonceHex };

test('recent page first, bounded eight-way delivery, complete keyset across equal timestamps and server caps', async () => {
  const rows = Array.from({ length: 113 }, (_, i) => row(i));
  const db = messageBackend(rows, 29);
  let active = 0, peak = 0, progress = 0;
  const received: string[] = [];
  await reconcileMessages(db as any, 'room', new AbortController().signal, async (value) => {
    active++; peak = Math.max(peak, active); received.push(value.id);
    await delay(1); active--;
  }, () => progress++);
  assert.equal(received[0], rows.at(-1)!.id);
  assert.equal(peak, 8); assert.equal(new Set(received).size, 113);
  assert.deepEqual(received, [...rows].reverse().map((value) => value.id));
  assert.equal(db.requests[0].limit, 50); assert.equal(db.requests[1].limit, 200);
  assert(db.requests.every((request) => !request.ascending)); assert(progress > 10);
});

test('abort stops backfill without losing already accepted recent rows', async () => {
  const controller = new AbortController(), received: string[] = [];
  const db = messageBackend(Array.from({ length: 120 }, (_, i) => row(i)));
  await reconcileMessages(db as any, 'room', controller.signal, async (value) => {
    received.push(value.id); controller.abort();
  });
  assert.equal(db.requests.length, 1); assert.equal(received.length, 8);
  assert.equal(received[0], row(119).id);
});

test('inbox + room + hydrate share ONE key lookup and ONE authenticated AES-GCM decryption per version', async () => {
  let lookups = 0, decryptions = 0;
  const processor = new ChatMessageProcessor(async () => { lookups++; await delay(5); return { key, status: 'ready' }; },
    async (...args) => { decryptions++; return decryptWithConversationKey(...args); });
  const results = await Promise.all([processor.key(room, 'user'), ...Array.from({ length: 16 }, () => processor.text(room, encryptedRow, 'user'))]);
  assert.equal(lookups, 1); assert.equal(decryptions, 1);
  assert(results.slice(1).every((value) => value === 'private test text'));
  assert.equal(await processor.text(room, encryptedRow, 'user'), 'private test text');
  assert.equal(decryptions, 1);
  await assert.rejects(webcrypto.subtle.exportKey('raw', key));
});

test('failed authentication is not cached; key change, expiry, burn and account/cache reset stay isolated', async () => {
  let lookups = 0, now = Date.now();
  const processor = new ChatMessageProcessor(async () => { lookups++; return { key, status: 'ready' }; }, decryptWithConversationKey, () => now);
  await assert.rejects(processor.text(room, { ...encryptedRow, ciphertext: '00'.repeat(32) }, 'user'));
  assert.equal(await processor.text(room, encryptedRow, 'user'), 'private test text'); assert.equal(lookups, 2);
  await processor.text({ ...room, peerKey: 'changed-public-key' }, encryptedRow, 'user'); assert.equal(lookups, 3);
  await assert.rejects(processor.text(room, { ...encryptedRow, burned_at: new Date(now).toISOString() }, 'user'));
  await assert.rejects(processor.text(room, { ...encryptedRow, expires_at: new Date(now - 1).toISOString() }, 'user'));
  await processor.text(room, encryptedRow, 'other-user'); assert.equal(lookups, 4);
  processor.clear(); await processor.text(room, encryptedRow, 'user'); assert.equal(lookups, 5);
  now += 300_001; await processor.text(room, encryptedRow, 'user'); assert.equal(lookups, 6);
});

test('late key result after clear cannot repopulate the cache', async () => {
  let finish!: () => void, calls = 0;
  const gate = new Promise<void>((resolve) => { finish = resolve; });
  const processor = new ChatMessageProcessor(async () => { calls++; await gate; return { key, status: 'ready' }; }, decryptWithConversationKey);
  const pending = processor.text(room, encryptedRow, 'user');
  processor.clear(); finish(); await pending;
  await processor.text(room, encryptedRow, 'user'); assert.equal(calls, 2);
});

test('message merge is chronological, duplicate-no-op, batch bounded and burn monotonic', async () => {
  const messages: any[] = Array.from({ length: 1000 }, (_, i) => ({ id: String(i).padStart(4, '0'), roomId: 'room', timestamp: Math.floor(i / 2), plainText: 'text', cipherText: 'cipher', nonceHex: 'nonce' })).reverse();
  const merged = mergeMessages([], messages);
  assert.equal(merged.length, 1000); assert.equal(merged[0].id, '0000'); assert.equal(merged.at(-1)!.id, '0999');
  assert.equal(mergeMessages(merged, messages), merged);
  const burned = mergeMessages(merged, [{ ...merged[0], isBurned: true }, merged[0]]);
  assert.equal(burned[0].plainText, ''); assert.equal(burned[0].isBurned, true);
  const changed = mergeMessages(merged, [{ ...merged[0], cipherText: 'changed', plainText: '[Encrypted message]' }]);
  assert.equal(changed[0].plainText, '[Encrypted message]');
  const batches: any[][] = []; const batcher = new MessageBatcher((batch) => batches.push(batch));
  messages.forEach((message) => batcher.add(message)); await delay(30);
  assert.equal(batches.length, 1); assert.equal(batches[0].length, 1000);
  batcher.add(messages[0]); batcher.clear(); await delay(30); assert.equal(batches.length, 1);
});

test('Realtime/push presentation dedups in either order; active chat, background and other accounts do not toast', () => {
  const alerts = new MessageAlerts(); let toasts = 0;
  const context = { foreground: true, viewingRoom: null, userId: 'user', recipientId: 'user' };
  assert(alerts.present('message', 'room', context, () => toasts++));
  assert(alerts.present('message', 'room', context, () => toasts++)); assert.equal(toasts, 1);
  assert(alerts.present('active', 'room', { ...context, viewingRoom: 'room' }, () => toasts++));
  assert(!alerts.present('background', 'room', { ...context, foreground: false }, () => toasts++));
  assert(!alerts.present('wrong-account', 'room', { ...context, recipientId: 'other' }, () => toasts++));
  assert.equal(toasts, 1);
  alerts.clear(); assert(alerts.present('message', 'room', context, () => toasts++)); assert.equal(toasts, 2);
});


test('native receipt received in background prevents a repeat toast on foreground REST catch-up', () => {
  const alerts = new MessageAlerts(); let toasts = 0;
  alerts.acknowledged('already-native', 'user', 'user');
  assert(alerts.present('already-native', 'room', { foreground: true, viewingRoom: null, userId: 'user', recipientId: 'user' }, () => toasts++));
  assert.equal(toasts, 0);
  alerts.acknowledged('other-native', 'other', 'user');
  alerts.present('other-native', 'room', { foreground: true, viewingRoom: null, userId: 'user', recipientId: 'user' }, () => toasts++);
  assert.equal(toasts, 1);
});


test('identical concurrent REST pages share HTTP; cancelling one observer does not cancel the other', async () => {
  const db = messageBackend([row(1), row(2)]);
  const from = db.from;
  db.from = (table: string) => {
    const query = from(table), then = query.then;
    query.then = (resolve: any, reject: any) => then(async (result: any) => { await delay(8); return resolve(result); }, reject);
    return query;
  };
  const first = new AbortController(), second = new AbortController(), seen: string[] = [];
  const cancelled = reconcileMessages(db as any, 'room', first.signal, async () => {}, () => {}, 'user');
  const rejection = assert.rejects(cancelled, /cancelled/);
  const running = reconcileMessages(db as any, 'room', second.signal, async (value) => { seen.push(value.id); }, () => {}, 'user');
  await delay(1); first.abort(); await rejection; await running;
  assert.deepEqual(seen, [row(2).id, row(1).id]); assert.equal(db.requests.length, 2);
});
