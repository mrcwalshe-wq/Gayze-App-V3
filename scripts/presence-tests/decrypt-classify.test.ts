import test from 'node:test';
import assert from 'node:assert/strict';
import { ChatMessageProcessor, MessageDecryptError } from '../../src/services/chatMessageProcessing';

const room = { id: 'r1', type: 'direct', peerKey: 'pk', memberIds: ['a', 'b'] } as never;
const row = (keyVersion: number) => ({ id: 'm1', conversation_id: 'r1', ciphertext: 'aa', nonce: 'bb', created_at: new Date().toISOString(), key_version: keyVersion }) as never;
const K = (name: string) => ({ name }) as unknown as CryptoKey;

const processor = (keys: Map<number, CryptoKey>, legacy: CryptoKey | undefined, works: (k: CryptoKey) => boolean) => new ChatMessageProcessor(
  async () => ({ key: keys.get(2) ?? null, keyVersion: 2, keys, legacyKey: legacy, status: 'ready', code: 'ready' }) as never,
  async (_c, _n, key) => { if (works(key)) return 'hello'; throw new Error('OperationError'); },
);

test('a device without the key for the row’s version reports a missing key, not tampering', async () => {
  // Version 1 key was never opened on this device; only version 2 and a legacy key exist, and neither opens the row.
  const p = processor(new Map([[2, K('v2')]]), K('legacy'), () => false);
  await assert.rejects(p.text(room, row(1), 'a'), (e: unknown) => e instanceof MessageDecryptError && e.code === 'no_key_for_version');
});

test('a failure with the row’s own key is an integrity failure', async () => {
  const p = processor(new Map([[1, K('v1')], [2, K('v2')]]), K('legacy'), () => false);
  await assert.rejects(p.text(room, row(1), 'a'), (e: unknown) => e instanceof MessageDecryptError && e.code === 'authentication_failed');
});

test('the legacy key still opens old rows when the versioned key is missing', async () => {
  const p = processor(new Map([[2, K('v2')]]), K('legacy'), (k) => (k as unknown as { name: string }).name === 'legacy');
  assert.equal(await p.text(room, row(1), 'a'), 'hello');
});
