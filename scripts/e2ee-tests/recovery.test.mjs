/**
 * Historical group-key recovery regression test (real cryptoService + real
 * resolveGroupKey against an in-memory envelope store).
 * Run: npx tsx scripts/e2ee-tests/recovery.test.mjs
 */
import assert from 'node:assert/strict';
import { createDevice, installWindowGlobal } from './shims.mjs';

installWindowGlobal();
globalThis.__GAYZE_VITE_ENV__ = {};
const crypto = await import('../../src/services/cryptoService.ts');
const { resolveGroupKeyForTest: resolveGroupKey } = await import('../../src/services/conversationKeyService.ts');

const ROOM = { id: '00000000-0000-4000-8000-000000000c02', type: 'gathering', memberIds: ['u1', 'u2', 'u3'], peerKey: '' };
const deviceA = createDevice('A');
const deviceB = createDevice('B');
deviceA.use();
const idA = await crypto.getOrCreateDeviceIdentity();
deviceB.use();
const idB = await crypto.getOrCreateDeviceIdentity();

const store = [];
const counters = { createKey: 0, saves: 0, reads: 0 };
let failReads = 0;
const devices = [
  { user_id: 'u1', device_id: idA.deviceId, public_key: idA.publicKeyJwkString },
  { user_id: 'u2', device_id: idB.deviceId, public_key: idB.publicKeyJwkString },
];
const deps = {
  readEnvelopes: async () => {
    counters.reads++;
    if (failReads > 0) { failReads--; return { ok: false, envelopes: [] }; }
    return { ok: true, envelopes: store.map((e) => ({ ...e })) };
  },
  readDevices: async () => ({ ok: true, devices }),
  saveEnvelope: async (e) => { counters.saves++; store.push({ ...e, created_at: 'now' }); return e; },
  createKey: async () => { counters.createKey++; return crypto.createConversationKey(); },
  retryDelayMs: 1,
};

// Session 1: brand new conversation provisions exactly one key.
deviceA.use();
const s1 = await resolveGroupKey(ROOM, 'u1', deps);
assert.equal(s1.status, 'ready');
assert.equal(counters.createKey, 1);
const sealed = await crypto.encryptWithConversationKey('historical message', s1.key);
const envelopeSnapshot = JSON.stringify(store);
const ciphertextSnapshot = JSON.stringify(sealed);
const savesAfterSession1 = counters.saves;

// Session 2 (close -> reopen -> reload): zero generation, zero writes.
for (const device of [deviceA, deviceB]) {
  device.use();
  const s2 = await resolveGroupKey(ROOM, device === deviceA ? 'u1' : 'u2', deps);
  assert.equal(s2.status, 'ready');
  assert.equal(await crypto.decryptWithConversationKey(sealed.cipherHex ?? sealed.ciphertext, sealed.nonceHex ?? sealed.nonce, s2.key), 'historical message');
}
assert.equal(counters.createKey, 1, 'no key generated during recovery');
assert.equal(counters.saves, savesAfterSession1, 'no envelope written during recovery');
assert.equal(JSON.stringify(store), envelopeSnapshot, 'envelopes unchanged');
assert.equal(JSON.stringify(sealed), ciphertextSnapshot, 'ciphertext untouched');

// Transient read failure: retried, never treated as absence.
deviceA.use();
failReads = 2;
const retried = await resolveGroupKey(ROOM, 'u1', deps);
assert.equal(retried.status, 'ready');

failReads = 99;
const failed = await resolveGroupKey(ROOM, 'u1', deps);
assert.equal(failed.status, 'unavailable');
assert.equal(failed.transient, true);
assert.equal(counters.createKey, 1, 'read failure never generates a replacement key');
assert.equal(counters.saves, savesAfterSession1, 'read failure never writes envelopes');

// Empty store but unreadable devices must not provision either.
failReads = 0;
const emptyDeps = { ...deps, readEnvelopes: async () => ({ ok: true, envelopes: [] }), readDevices: async () => ({ ok: false, devices: [] }) };
const noDevices = await resolveGroupKey(ROOM, 'u1', emptyDeps);
assert.equal(noDevices.transient, true);
assert.equal(counters.createKey, 1);

console.log('E2EE RECOVERY TESTS: ALL PASSED');
process.exit(0);
