/**
 * Client key-flow tests. Real cryptoService + real conversationKeyService +
 * real ChatMessageProcessor, with each simulated device owning a separate
 * key store (see e2ee-tests/shims.mjs). Only the Supabase boundary is faked;
 * the SQL side of the same protocol is tested in rls.test.mjs.
 *
 *   node --test scripts/messaging-tests/keyring.test.mjs
 */
import assert from 'node:assert/strict';
import { after, test } from 'node:test';
import { JSDOM } from 'jsdom';
import { createDevice } from '../e2ee-tests/shims.mjs';
import { loadModule } from '../recovery-tests/load-module.mjs';

const dom = new JSDOM('<!doctype html><html><body></body></html>', { url: 'https://gayze.test/', pretendToBeVisual: true });
Object.defineProperty(dom.window, 'crypto', { configurable: true, value: globalThis.crypto });
after(() => dom.window.close());

const USER_A = '00000000-0000-4000-8000-0000000000aa';
const USER_B = '00000000-0000-4000-8000-0000000000bb';
const CONVERSATION = '10000000-0000-4000-8000-000000000001';
const room = { id: CONVERSATION, type: 'group', memberIds: [USER_A, USER_B] };

const crypto = await loadModule('src/services/cryptoService.ts');
const keysModule = await loadModule('src/services/conversationKeyService.ts');
const { ChatMessageProcessor, MessageDecryptError } = await loadModule('src/services/chatMessageProcessing.ts');
const { mergeMessages } = await loadModule('src/services/messageMerge.ts');

/** A device = isolated key store + the account it is registered under. */
async function enrol(label, userId) {
  const device = createDevice(label);
  const activate = () => { device.use(); globalThis.window = dom.window; globalThis.localStorage = device.localStorage; };
  activate();
  const identity = await crypto.getOrCreateDeviceIdentity();
  return { label, userId, identity, device, activate };
}

/** In-memory stand-in for the guarded RPCs. Production rules are covered by rls.test.mjs. */
function createServer(devices) {
  const envelopes = [];
  const claims = new Map();
  const saveLog = [];
  const registry = () => devices.map((d) => ({
    user_id: d.userId, device_id: d.identity.deviceId, public_key: d.identity.publicKeyJwkString, status: d.revoked ? 'revoked' : 'active',
  })).filter((d) => d.status === 'active');
  const depsFor = (who) => ({
    async readEnvelopes() { return { ok: true, envelopes: envelopes.map((e) => ({ ...e })) }; },
    async readDevices() { return { ok: true, devices: registry() }; },
    async readMemberDevices() { return { ok: true, devices: registry() }; },
    async getIdentity() { return who.identity; },
    async resolveLegacyKey() { return null; },
    async claimBootstrap(_conv, deviceId, version = 1) {
      const max = Math.max(0, ...envelopes.map((e) => e.key_version ?? 1));
      if (version !== max + 1) return false;
      if (claims.has(version) && claims.get(version) !== deviceId) return false;
      claims.set(version, deviceId);
      return true;
    },
    async saveEnvelope(envelope) {
      saveLog.push(envelope);
      const version = envelope.key_version ?? 1;
      const existing = envelopes.find((e) => e.device_id === envelope.device_id && (e.key_version ?? 1) === version);
      if (existing) return existing;
      const creator = devices.find((d) => d.identity.deviceId === envelope.created_by_device_id);
      const row = { ...envelope, key_version: version, creator_public_key: creator?.identity.publicKeyJwkString ?? null, created_at: new Date().toISOString() };
      envelopes.push(row);
      return row;
    },
    createKey: crypto.createConversationKey,
    retryDelayMs: 1,
  });
  return { envelopes, claims, saveLog, depsFor };
}

const seal = async (who, key, text) => { who.activate(); return crypto.encryptWithConversationKey(text, key); };
const open = async (who, key, sealed) => { who.activate(); return crypto.decryptWithConversationKey(sealed.cipherHex, sealed.nonceHex, key); };
const resolve = async (who, server) => { who.activate(); return keysModule.resolveConversationKeyForTest(room, who.userId, server.depsFor(who)); };

test('ROOT CAUSE: after a reload, a non-creator holder can still provision a newly enrolled device', async () => {
  const a1 = await enrol('a1', USER_A); const b1 = await enrol('b1', USER_B);
  const devices = [a1, b1];
  const server = createServer(devices);

  const created = await resolve(a1, server);                  // A1 mints v1 for A1 and B1
  assert.equal(created.status, 'ready');
  const hello = await seal(a1, created.key, 'hello from A');

  // B reloads the page: its key now comes from unwrapping its envelope.
  const b1Reloaded = await resolve(b1, server);
  assert.equal(b1Reloaded.status, 'ready');
  assert.equal(await open(b1, b1Reloaded.key, hello), 'hello from A');

  // B enrols a second device. The only holders are A1 (the creator) and B1 (an UNWRAPPED key).
  const b2 = await enrol('b2', USER_B);
  devices.push(b2);
  assert.equal((await resolve(b2, server)).status, 'unavailable', 'B2 has no envelope yet');

  // B1 (not the creator, key loaded by unwrapping) opens the chat and provisions B2.
  server.saveLog.length = 0;
  await resolve(b1, server);
  assert.ok(server.saveLog.some((e) => e.device_id === b2.identity.deviceId && e.created_by_device_id === b1.identity.deviceId),
    'B1 wrote an envelope for B2 from an unwrapped key (this threw silently before: the key was non-extractable)');

  const b2Ready = await resolve(b2, server);
  assert.equal(b2Ready.status, 'ready');
  assert.equal(await open(b2, b2Ready.key, hello), 'hello from A', 'second device reads the existing thread');
  assert.equal(b2Ready.keyVersion, 1);
});

test('device with no way to open the key gets a recoverable error, never a send key and never plaintext', async () => {
  const a1 = await enrol('a1', USER_A); const b1 = await enrol('b1', USER_B);
  const devices = [a1, b1];
  const server = createServer(devices);
  const v1 = await resolve(a1, server);
  const old = await seal(a1, v1.key, 'sent before B lost its device');

  // B's browser storage is wiped: same account, brand-new device, no private key for B1's envelope.
  b1.revoked = true;
  const b3 = await enrol('b3', USER_B);
  devices.push(b3);

  const stuck = await resolve(b3, server);
  assert.equal(stuck.status, 'unavailable');
  assert.equal(stuck.key, null, 'cannot encrypt with a key this device does not hold');
  assert.equal(stuck.canRekey, true, 'recovery path is offered');
  assert.match(stuck.code, /^(key_not_shared|cannot_unwrap)$/);
  assert.ok(stuck.reason && /secure session|another signed-in device/.test(stuck.reason), 'reason tells the user what to do');

  // The processor turns that into a typed, visible per-message failure.
  const processor = new ChatMessageProcessor(async () => stuck, crypto.decryptWithConversationKey);
  b3.activate();
  await assert.rejects(
    processor.text(room, { id: 'm1', conversation_id: CONVERSATION, sender_id: USER_A, ciphertext: old.cipherHex, nonce: old.nonceHex, created_at: new Date().toISOString(), expires_at: null, burned_at: null, key_version: 1 }, USER_B),
    (error) => error instanceof MessageDecryptError && error.code === 'no_key_for_version' || error.code === 'key_unavailable',
  );
});

test('re-key: new messages work on the recovered device, old ones stay readable only where the old key lives', async () => {
  const a1 = await enrol('a1', USER_A); const b1 = await enrol('b1', USER_B);
  const devices = [a1, b1];
  const server = createServer(devices);
  const v1 = await resolve(a1, server);
  const oldMessage = await seal(a1, v1.key, 'v1 message');

  b1.revoked = true;
  const b3 = await enrol('b3', USER_B);
  devices.push(b3);
  assert.equal((await resolve(b3, server)).status, 'unavailable');

  b3.activate();
  const rekeyed = await keysModule.rekeyConversationKeyForTest(room, server.depsFor(b3));
  assert.equal(rekeyed.status, 'ready');
  assert.equal(rekeyed.keyVersion, 2);
  assert.equal(server.envelopes.filter((e) => e.key_version === 1).length >= 2, true, 'v1 envelopes were not deleted');
  assert.equal(server.envelopes.filter((e) => e.key_version === 2).length, 2, 'v2 wrapped for the two active devices (A1, B3)');

  const fresh = await seal(b3, rekeyed.key, 'v2 message from the recovered device');

  // B3 reads v2 but, while no v1 holder has been online, explicitly cannot read v1 (honest, visible failure).
  const b3Keys = await resolve(b3, server);
  assert.equal(b3Keys.status, 'ready');
  assert.equal(b3Keys.keys.has(1), false);
  const processor = new ChatMessageProcessor(async () => b3Keys, crypto.decryptWithConversationKey);
  b3.activate();
  const row = (sealed, key_version) => ({ id: `m${key_version}`, conversation_id: CONVERSATION, sender_id: USER_A, ciphertext: sealed.cipherHex, nonce: sealed.nonceHex, created_at: new Date().toISOString(), expires_at: null, burned_at: null, key_version });
  assert.equal(await processor.text(room, row(fresh, 2), USER_B), 'v2 message from the recovered device');
  await assert.rejects(processor.text(room, row(oldMessage, 1), USER_B), (e) => e instanceof MessageDecryptError && e.code === 'no_key_for_version');

  // A1 still holds v1 and receives v2 as well: full history + new messages.
  const a1Keys = await resolve(a1, server);
  assert.equal(a1Keys.keyVersion, 2);
  assert.equal(await open(a1, a1Keys.keys.get(2), fresh), 'v2 message from the recovered device');
  assert.equal(await open(a1, a1Keys.keys.get(1), oldMessage), 'v1 message');

  // And because A1 is a v1 holder it also provisions v1 to B3: history heals as soon as any holder is online.
  const b3Healed = await resolve(b3, server);
  assert.equal(b3Healed.keys.has(1), true);
  assert.equal(await open(b3, b3Healed.keys.get(1), oldMessage), 'v1 message');
});

test('only one device can mint the next key version at a time', async () => {
  const a1 = await enrol('a1', USER_A); const b1 = await enrol('b1', USER_B);
  const server = createServer([a1, b1]);
  await resolve(a1, server);
  a1.activate(); b1.activate();
  const [first, second] = await Promise.all([
    keysModule.rekeyConversationKeyForTest(room, server.depsFor(a1)),
    keysModule.rekeyConversationKeyForTest(room, server.depsFor(b1)),
  ]);
  const ready = [first, second].filter((r) => r.status === 'ready');
  const busy = [first, second].filter((r) => r.code === 'bootstrap_busy');
  assert.equal(ready.length, 1, 'exactly one re-key wins');
  assert.equal(busy.length, 1, 'the other is told to retry, and never creates a competing key');
  assert.equal(new Set(server.envelopes.map((e) => e.key_version)).size, 2);
});

test('tampered ciphertext and a wrong key are rejected as authentication failures, never rendered', async () => {
  const a1 = await enrol('a1', USER_A); const b1 = await enrol('b1', USER_B);
  const server = createServer([a1, b1]);
  const v1 = await resolve(a1, server);
  const sealed = await seal(a1, v1.key, 'do not tamper');
  const flipped = (hex) => hex.slice(0, 4) + (hex[4] === 'a' ? 'b' : 'a') + hex.slice(5);
  const processor = new ChatMessageProcessor(async () => v1, crypto.decryptWithConversationKey);
  a1.activate();
  const base = { id: 'x', conversation_id: CONVERSATION, sender_id: USER_B, nonce: sealed.nonceHex, created_at: new Date().toISOString(), expires_at: null, burned_at: null, key_version: 1 };
  await assert.rejects(processor.text(room, { ...base, ciphertext: flipped(sealed.cipherHex) }, USER_A), (e) => e instanceof MessageDecryptError && e.code === 'authentication_failed');
  await assert.rejects(processor.text(room, { ...base, id: 'y', ciphertext: sealed.cipherHex, nonce: flipped(sealed.nonceHex) }, USER_A), (e) => e.code === 'authentication_failed');
  assert.equal(await processor.text(room, { ...base, id: 'z', ciphertext: sealed.cipherHex }, USER_A), 'do not tamper');
  // A different conversation key (e.g. an attacker-supplied one) fails too.
  const other = await crypto.createConversationKey();
  const wrongKeyProcessor = new ChatMessageProcessor(async () => ({ key: other, keyVersion: 1, keys: new Map([[1, other]]), status: 'ready' }), crypto.decryptWithConversationKey);
  await assert.rejects(wrongKeyProcessor.text(room, { ...base, id: 'w', ciphertext: sealed.cipherHex }, USER_A), (e) => e.code === 'authentication_failed');
});

test('failed decrypts are flagged on the message and a later success clears the flag; stale placeholders cannot downgrade plaintext', () => {
  const msg = (extra) => ({ id: 'm', roomId: 'r', senderKey: 's', senderName: 'n', timestamp: 1, cipherText: 'c', nonceHex: 'n', plainText: '[Encrypted message]', ...extra });
  const failed = mergeMessages([], [msg({ decryptFailure: 'no_key' })]);
  assert.equal(failed[0].decryptFailure, 'no_key');
  const recovered = mergeMessages(failed, [msg({ plainText: 'hello' })]);
  assert.equal(recovered[0].plainText, 'hello');
  assert.equal(recovered[0].decryptFailure, undefined);
  const stale = mergeMessages(recovered, [msg({ decryptFailure: 'no_key' })]);
  assert.equal(stale[0].plainText, 'hello', 'a late failed attempt for the same ciphertext does not wipe decrypted text');
  assert.equal(stale[0].decryptFailure, undefined);
});

test('dedupe and ordering: optimistic send, Realtime echo and catch-up converge on one row in server order', () => {
  const row = (id, t, text) => ({ id, roomId: 'r', senderKey: 's', senderName: 'n', timestamp: t, cipherText: 'c' + id, nonceHex: 'n', plainText: text });
  let list = [];
  list = mergeMessages(list, [row('b', 2000, 'second'), row('a', 1000, 'first')]);          // catch-up arrives newest-first
  list = mergeMessages(list, [row('a', 1000, 'first')]);                                      // Realtime echo of an already-persisted row
  list = mergeMessages(list, [row('a', 1000, 'first'), row('b', 2000, 'second')]);            // refetch after reconnect
  list = mergeMessages(list, [row('c2', 3000, 'same ms 2'), row('c1', 3000, 'same ms 1')]);  // equal timestamps: stable id tiebreak
  assert.deepEqual(list.map((m) => m.id), ['a', 'b', 'c1', 'c2']);
  const same = mergeMessages(list, [row('a', 1000, 'first')]);
  assert.equal(same, list, 'a duplicate is a no-op (same array identity: no extra render)');
});

test('plaintext and key material never reach storage, server rows, or the console', async () => {
  const logs = [];
  const original = { log: console.log, warn: console.warn, error: console.error, info: console.info };
  for (const level of Object.keys(original)) console[level] = (...args) => { logs.push(args.map(String).join(' ')); };
  try {
    const a1 = await enrol('a1', USER_A); const b1 = await enrol('b1', USER_B);
    const server = createServer([a1, b1]);
    const secret = 'PLAINTEXT-CANARY-9f3b1c';
    const v1 = await resolve(a1, server);
    const sealed = await seal(a1, v1.key, secret);
    const everythingServerSees = JSON.stringify({ envelopes: server.envelopes, row: sealed, saves: server.saveLog });
    assert.equal(everythingServerSees.includes(secret), false, 'server-visible data holds no plaintext');
    const rawKey = Buffer.from(await globalThis.crypto.subtle.exportKey('raw', v1.key)).toString('hex');
    assert.equal(everythingServerSees.includes(rawKey), false, 'server-visible data holds no raw conversation key');
    for (const who of [a1, b1]) {
      const stored = JSON.stringify(who.device.localStorage._dump());
      assert.equal(stored.includes(secret), false, 'localStorage holds no plaintext');
      assert.equal(stored.includes(rawKey), false, 'localStorage holds no conversation key');
      assert.equal(/"d":"/.test(stored), false, 'localStorage holds no private JWK');
    }
  } finally {
    Object.assign(console, original);
  }
  assert.equal(logs.some((line) => line.includes('PLAINTEXT-CANARY')), false, 'no plaintext in console output');
});

test('keys are scoped per user and per room: no key or plaintext reuse across rooms or accounts', async () => {
  const calls = [];
  const processor = new ChatMessageProcessor(async (r, userId) => { calls.push(`${userId}:${r.id}`); return { key: null, status: 'unavailable', reason: 'none' }; }, crypto.decryptWithConversationKey);
  await processor.key({ id: 'room-1', type: 'group' }, USER_A);
  await processor.key({ id: 'room-2', type: 'group' }, USER_A);
  await processor.key({ id: 'room-1', type: 'group' }, USER_B);
  await processor.key({ id: 'room-1', type: 'group' }, USER_A); // cached
  assert.deepEqual(calls, [`${USER_A}:room-1`, `${USER_A}:room-2`, `${USER_B}:room-1`]);
  processor.clear();
  await processor.key({ id: 'room-1', type: 'group' }, USER_A);
  assert.equal(calls.length, 4, 'sign-out / account switch clears cached keys');
});
