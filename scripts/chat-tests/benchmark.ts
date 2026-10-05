/** Reproducible local fixture, NOT a production/iPhone/network benchmark.
 * AES-GCM is real; key discovery latency is deliberately fixed at 4 ms.
 * Baseline models the audited serial, per-row key/decrypt/merge path. */
import { webcrypto } from 'node:crypto';
import { performance } from 'node:perf_hooks';
import { ChatMessageProcessor, MessageBatcher } from '../../src/services/chatMessageProcessing';
import { encryptWithConversationKey, decryptWithConversationKey } from '../../src/services/cryptoService';
import { reconcileMessages } from '../../src/services/chatSubscriptions';
import { mergeMessage, mergeMessages } from '../../src/services/messageMerge';
import { row, messageBackend, delay } from './fixtures';
Object.defineProperty(globalThis, 'window', { value: { crypto: webcrypto } });
const room: any = { id: 'room', type: 'direct', memberIds: ['user', 'peer'] };
const key = await webcrypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']) as CryptoKey;
const rows = await Promise.all(Array.from({ length: 300 }, async (_, index) => {
  const encrypted = await encryptWithConversationKey(`fixture message ${index}`, key);
  return { ...row(index), ciphertext: encrypted.cipherHex, nonce: encrypted.nonceHex };
}));
const message = (value: typeof rows[number], text: string): any => ({ id: value.id, roomId: 'room', senderKey: 'peer', senderName: 'Peer', timestamp: Date.parse(value.created_at), cipherText: value.ciphertext, nonceHex: value.nonce!, plainText: text });
let baselineKeys = 0, baselineMerges = 0, baselineRows: any[] = [];
const before = performance.now();
for (const value of rows) {
  baselineKeys++; await delay(4);
  baselineRows = mergeMessage(baselineRows, message(value, await decryptWithConversationKey(value.ciphertext, value.nonce!, key)));
  baselineMerges++;
}
const baselineMs = performance.now() - before;
let optimizedKeys = 0, optimizedDecrypts = 0, merges = 0, optimizedRows: any[] = [], newestVisibleMs = 0;
const start = performance.now();
const processor = new ChatMessageProcessor(async () => { optimizedKeys++; await delay(4); return { key, status: 'ready' }; },
  async (...args) => { optimizedDecrypts++; return decryptWithConversationKey(...args); });
const batcher = new MessageBatcher((batch) => {
  merges++; optimizedRows = mergeMessages(optimizedRows, batch);
  if (!newestVisibleMs && optimizedRows.some((value) => value.id === rows.at(-1)!.id)) newestVisibleMs = performance.now() - start;
});
await reconcileMessages(messageBackend(rows) as any, 'room', new AbortController().signal, async (value) => {
  batcher.add(message(value, await processor.text(room, value, 'user')));
});
await delay(20);
const optimizedMs = performance.now() - start;
const warmStart = performance.now();
await Promise.all(rows.slice(-50).map((value) => processor.text(room, value, 'user')));
const warmMs = performance.now() - warmStart;
if (JSON.stringify(optimizedRows) !== JSON.stringify(baselineRows)) throw new Error('Chronology/plaintext mismatch');
console.log(JSON.stringify({ fixture: '300 real AES-GCM messages; simulated 4ms key discovery; no production calls',
  baseline: { totalMs: Math.round(baselineMs), newestVisibleMs: Math.round(baselineMs), keyLookups: baselineKeys, stateMerges: baselineMerges },
  optimized: { totalMs: Math.round(optimizedMs), newestVisibleMs: Math.round(newestVisibleMs), keyLookups: optimizedKeys, decryptions: optimizedDecrypts, stateMerges: merges },
  reopen: { last50Ms: Number(warmMs.toFixed(2)), additionalKeyLookups: optimizedKeys - 1, additionalDecryptions: optimizedDecrypts - 300 },
  equality: 'All 300 plaintexts and chronological IDs identical',
}, null, 2));
