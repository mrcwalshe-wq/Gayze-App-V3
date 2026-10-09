import assert from 'node:assert/strict';
import { after, test } from 'node:test';
import { JSDOM } from 'jsdom';
import React from 'react';
import { cleanup, render } from '@testing-library/react';
import { createDevice } from './shims.mjs';
import { loadModule } from '../recovery-tests/load-module.mjs';

const dom = new JSDOM('<!doctype html><html><body></body></html>', {
  url: 'https://gayze.test/',
  pretendToBeVisual: true,
});
for (const key of ['window', 'document', 'navigator', 'HTMLElement', 'localStorage']) {
  Object.defineProperty(globalThis, key, { configurable: true, writable: true, value: dom.window[key] });
}
Object.defineProperty(dom.window, 'crypto', { configurable: true, value: globalThis.crypto });
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
after(() => { cleanup(); dom.window.close(); });

const accountA = '00000000-0000-4000-8000-000000000001';
const accountB = '00000000-0000-4000-8000-000000000002';
const conversationId = '10000000-0000-4000-8000-000000000001';
const messageId = '20000000-0000-4000-8000-000000000001';

test('encrypted message persists, reloads, decrypts, renders, and survives second-device identity recovery', async () => {
  let sessionUserId = accountA;
  const persistedRows = [];
  const backend = {
    auth: {
      async getSession() { return { data: { session: { user: { id: sessionUserId }, expires_at: Math.floor(Date.now() / 1000) + 3600 } }, error: null }; },
      onAuthStateChange() { return { data: { subscription: { unsubscribe() {} } } }; },
    },
    realtime: { async disconnect() {}, connect() {} },
    channel() {
      const channel = {
        on() { return channel; },
        subscribe() { return channel; },
        async unsubscribe() {},
        teardown() {},
      };
      return channel;
    },
    from(table) {
      if (table === 'intents') {
        const query = {
          select() { return query; },
          eq() { return query; },
          gt() { return query; },
          order() { return query; },
          limit() { return query; },
          abortSignal() { return query; },
          async maybeSingle() { return { data: null, error: null }; },
        };
        return query;
      }
      assert.equal(table, 'messages');
      let roomId;
      let inserted;
      const query = {
        select() { return query; },
        eq(_column, value) { roomId = value; return query; },
        order() { return query; },
        insert(values) {
          inserted = {
            ...values,
            created_at: '2026-10-03T14:00:00.000Z',
            burned_at: null,
          };
          persistedRows.push(inserted);
          return query;
        },
        async single() { return { data: inserted, error: null }; },
        then(resolve, reject) {
          return Promise.resolve({
            data: persistedRows.filter((row) => row.conversation_id === roomId),
            error: null,
          }).then(resolve, reject);
        },
      };
      return query;
    },
  };
  const deviceA = createDevice('sender');
  const deviceB = createDevice('recipient');
  const recoveredDevice = createDevice('recovered-recipient');
  const activate = (device) => {
    device.use();
    globalThis.window = dom.window;
    globalThis.localStorage = device.localStorage;
  };
  const crypto = await loadModule('src/services/cryptoService.ts');

  activate(deviceA);
  const identityA = await crypto.getOrCreateDeviceIdentity();
  activate(deviceB);
  const identityB = await crypto.getOrCreateDeviceIdentity();
  const recoveryBundle = await crypto.createRecoveryBundle('a sufficiently long recovery passphrase');
  activate(deviceA);
  const keyA = await crypto.deriveConversationKey(conversationId, identityB.publicKeyJwk);
  const cleartext = 'Persisted encrypted message';
  const sealed = await crypto.encryptWithConversationKey(cleartext, keyA);
  console.log(`[E2EE trace] ${JSON.stringify({
    conversationId,
    messageId,
    sender: { userId: accountA, deviceId: identityA.deviceId, fingerprint: identityA.fingerprint },
    recipient: { userId: accountB, deviceId: identityB.deviceId, fingerprint: identityB.fingerprint },
    keyVersion: 'GAYZE-CONVERSATION-v1',
    keyId: 'not persisted; direct ECDH key derived from peer public identity',
    ciphertextHex: sealed.cipherHex,
    nonceHex: sealed.nonceHex,
    envelopeLookup: 'direct conversation: none',
  })}`);

  const service = await loadModule('src/services/supabaseService.ts', backend);
  const receipt = await service.persistConversationMessage(
    conversationId, sealed.cipherHex, sealed.nonceHex, null, messageId, accountA,
  );
  assert.equal(receipt.id, messageId);
  assert.equal(receipt.sender_id, accountA);
  assert.equal(receipt.conversation_id, conversationId);
  assert.equal(receipt.ciphertext, sealed.cipherHex);
  assert.equal(receipt.nonce, sealed.nonceHex);
  assert.equal(sealed.cipherHex.includes(cleartext), false);

  activate(deviceB);
  const identityBAfterReload = await crypto.getOrCreateDeviceIdentity();
  assert.equal(identityBAfterReload.fingerprint, identityB.fingerprint);
  sessionUserId = accountB;
  const rows = await service.loadConversationMessages(conversationId);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].id, messageId);
  const keyB = await crypto.deriveConversationKey(conversationId, identityA.publicKeyJwk);
  const decrypted = await crypto.decryptWithConversationKey(rows[0].ciphertext, rows[0].nonce, keyB);
  assert.equal(decrypted, cleartext);

  const { ChatRoomView } = await loadModule('src/components/ChatRoomView.tsx', backend);
  const chat = render(React.createElement(ChatRoomView, {
    rooms: [{ id: conversationId, name: 'Sender', peerName: 'Sender', peerUserId: accountA, type: 'direct', ephemeralTtlSeconds: 0 }],
    messages: { [conversationId]: [{
      id: rows[0].id,
      roomId: rows[0].conversation_id,
      senderKey: rows[0].sender_id,
      senderName: 'Sender',
      timestamp: Date.parse(rows[0].created_at),
      cipherText: rows[0].ciphertext,
      nonceHex: rows[0].nonce,
      plainText: decrypted,
    }] },
    activeRoomId: conversationId,
    currentUserId: accountB,
    currentUser: { publicKey: identityB.fingerprint, displayName: 'Recipient' },
    onSelectRoom() {},
    onUpdateRoomTtl() {},
    async onSendMessage() {},
  }));
  assert.equal(chat.getByText(cleartext).textContent, cleartext);

  activate(recoveredDevice);
  const restored = await crypto.restoreRecoveryBundle(recoveryBundle, 'a sufficiently long recovery passphrase');
  assert.equal(restored.fingerprint, identityB.fingerprint);
  assert.notEqual(restored.deviceId, identityB.deviceId);
  sessionUserId = accountB;
  const recoveredKey = await crypto.deriveConversationKey(conversationId, identityA.publicKeyJwk);
  assert.equal(await crypto.decryptWithConversationKey(rows[0].ciphertext, rows[0].nonce, recoveredKey), cleartext);
});


test('direct chat bootstraps device envelopes while preserving legacy history read access', async () => {
  const deviceA = createDevice('bootstrap-sender');
  const deviceB = createDevice('bootstrap-recipient');
  const deviceC = createDevice('unprovisioned-device');
  const activate = (device) => {
    device.use();
    globalThis.window = dom.window;
    globalThis.localStorage = device.localStorage;
  };
  const crypto = await loadModule('src/services/cryptoService.ts');
  activate(deviceA);
  const identityA = await crypto.getOrCreateDeviceIdentity();
  activate(deviceB);
  const identityB = await crypto.getOrCreateDeviceIdentity();
  activate(deviceC);
  const identityC = await crypto.getOrCreateDeviceIdentity();
  activate(deviceA);

  const legacyKey = await crypto.deriveConversationKey(conversationId, identityB.publicKeyJwk);
  const envelopes = [];
  const devices = [
    { user_id: accountA, device_id: identityA.deviceId, public_key: identityA.publicKeyJwkString, status: 'active' },
    { user_id: accountB, device_id: identityB.deviceId, public_key: identityB.publicKeyJwkString, status: 'active' },
  ];
  const { resolveConversationKeyForTest } = await loadModule('src/services/conversationKeyService.ts');
  const deps = {
    async readEnvelopes() { return { ok: true, envelopes: [...envelopes] }; },
    async readDevices() { return { ok: true, devices }; },
    async readMemberDevices() { return { ok: true, devices }; },
    async getIdentity() { return identityA; },
    async resolveLegacyKey() { return legacyKey; },
    async claimBootstrap() { return true; },
    async saveEnvelope(envelope) {
      const row = { ...envelope, created_at: new Date().toISOString() };
      if (!envelopes.some((saved) => saved.device_id === row.device_id)) envelopes.push(row);
      return row;
    },
    createKey: crypto.createConversationKey,
    retryDelayMs: 1,
  };
  const room = {
    id: conversationId,
    type: 'direct',
    peerUserId: accountB,
    peerKey: identityB.publicKeyJwkString,
    memberIds: [accountA, accountB],
  };

  const resolved = await resolveConversationKeyForTest(room, accountA, deps);
  assert.equal(resolved.status, 'ready');
  assert.ok(resolved.key, 'new sends receive an envelope-backed active key');
  assert.notEqual(resolved.key, legacyKey, 'legacy ECDH is never reused as the active send key');
  assert.equal(resolved.legacyKey, legacyKey, 'legacy key remains available to decrypt old messages');
  assert.equal(envelopes.length, 2, 'bootstrap creates one envelope per active member device');
  assert.ok(envelopes.some((row) => row.device_id === identityA.deviceId));
  assert.ok(envelopes.some((row) => row.device_id === identityB.deviceId));

  const recipientEnvelope = envelopes.find((row) => row.device_id === identityB.deviceId);
  const recipientKey = await crypto.unwrapConversationKey(
    conversationId,
    recipientEnvelope.wrapped_key,
    recipientEnvelope.nonce,
    identityA.publicKeyJwk,
  );
  const sealed = await crypto.encryptWithConversationKey('new envelope-key message', resolved.key);
  assert.equal(
    await crypto.decryptWithConversationKey(sealed.cipherHex, sealed.nonceHex, recipientKey),
    'new envelope-key message',
    'the recipient envelope decrypts messages sent with the new active key',
  );
  const historical = await crypto.encryptWithConversationKey('historical legacy message', legacyKey);
  assert.equal(
    await crypto.decryptWithConversationKey(historical.cipherHex, historical.nonceHex, resolved.legacyKey),
    'historical legacy message',
    'historical ciphertext remains readable with the legacy fallback',
  );

  // A device that is not in the authorised device set may read legacy history,
  // but must not send with that legacy key or bypass envelope provisioning.
  const unprovisioned = await resolveConversationKeyForTest(room, accountB, {
    ...deps,
    async getIdentity() { return identityC; },
    async readEnvelopes() { return { ok: true, envelopes: [...envelopes] }; },
  });
  assert.equal(unprovisioned.status, 'unavailable');
  assert.equal(unprovisioned.key, null, 'unprovisioned devices cannot send with a legacy key');
  assert.equal(unprovisioned.legacyKey, legacyKey, 'legacy key is retained only as a historical decryption candidate');
});
