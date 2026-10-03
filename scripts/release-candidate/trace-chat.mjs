/** Local integrated trace, NOT a live Supabase/browser-paint/iPhone benchmark.
 * Real component + recovery + pagination + AES-GCM + merging. REST/join latency
 * are controlled boundary fixtures; no external endpoint is contacted. */
import '../interaction-tests/env.mjs';
import assert from 'node:assert/strict';
import { webcrypto } from 'node:crypto';
import { loadModule } from '../recovery-tests/load-module.mjs';
const React = await import('react');
const { render, cleanup } = await import('@testing-library/react');
const m = await loadModule('scripts/release-candidate/traceHarness.ts');
Object.defineProperty(window, 'crypto', { value: webcrypto });
const key = await webcrypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
const rows = await Promise.all(Array.from({ length: 1000 }, async (_, i) => {
  const payload = await m.encryptWithConversationKey('synthetic message ' + i, key);
  return { ...m.row(i), ciphertext: payload.cipherHex, nonce: payload.nonceHex };
}));
const room = { id: 'room', name: 'Fixture', peerName: 'Fixture', type: 'direct', memberIds: ['user', 'peer'], ephemeralTtlSeconds: 0 };
let keys = 0, decrypts = 0, joins = 0, history = [];
const processor = new m.ChatMessageProcessor(async () => { keys++; await m.delay(4); return { key, status: 'ready' }; }, async (...args) => { decrypts++; return m.decryptWithConversationKey(...args); });
const db = m.messageBackend(rows); const originalFrom = db.from;
db.from = table => {
  const query = originalFrom(table), then = query.then;
  query.then = (resolve, reject) => then(async result => { await m.delay(10); return resolve(result); }, reject);
  return query;
};
db.auth = { async getSession() { return { data: { session: { user: { id: 'user' }, expires_at: Date.now() / 1000 + 3600 } } }; },
  onAuthStateChange() { return { data: { subscription: { unsubscribe() {} } } }; } };
db.channel = () => {
  let timer;
  const channel = { on() { return channel; }, subscribe(callback) { joins++; timer = setTimeout(() => callback('SUBSCRIBED'), 20); return channel; },
    async unsubscribe() { clearTimeout(timer); return 'ok'; }, teardown() {} };
  return channel;
};
const props = { rooms: [room], activeRoomId: 'room', currentUserId: 'user', currentUser: { publicKey: 'fixture', displayName: 'Fixture' }, onSelectRoom() {}, onUpdateRoomTtl() {}, async onSendMessage() {} };
const output = [];
globalThis.__GAYZE_CHAT_TRACE_ENABLED__ = true;
for (const [label, recent] of [['cold', false], ['warm-previous-full-scan', false], ['warm-controlled-recent', true]]) {
  const beforeDecrypts = decrypts, beforeKeys = keys, beforeJoins = joins;
  db.requests.length = 0;
  m.beginChatTrace('room');
  const ui = render(React.createElement(m.ChatRoomView, { ...props, messages: { room: history } }));
  const batcher = new m.MessageBatcher(batch => {
    const merged = m.mergeMessages(history, batch);
    if (merged === history) return;
    history = merged;
    ui.rerender(React.createElement(m.ChatRoomView, { ...props, messages: { room: history } }));
  });
  let finish;
  const done = new Promise(resolve => { finish = resolve; });
  const stop = m.subscribeToRecoveredMessages(db, 'user', 'room', async row => {
    const text = await processor.text(room, row, 'user');
    batcher.add({ id: row.id, roomId: 'room', senderKey: row.sender_id, senderName: 'Fixture', timestamp: Date.parse(row.created_at),
      cipherText: row.ciphertext, nonceHex: row.nonce, plainText: text });
  }, next => { if (next === 'connected') finish(); }, undefined, () => recent);
  let timeout;
  try { await Promise.race([done, new Promise((_, reject) => { timeout = setTimeout(() => reject(new Error('Trace timed out')), 30000); })]); }
  finally { clearTimeout(timeout); }
  await m.delay(25);
  assert.equal(history.length, 1000); assert(ui.getByText('synthetic message 999'));
  output.push({ label, ...globalThis.__GAYZE_CHAT_TRACES__.at(-1), queries: db.requests.length, keyLookups: keys - beforeKeys, decrypts: decrypts - beforeDecrypts, joins: joins - beforeJoins });
  stop(); batcher.clear(); cleanup(); await m.delay(5);
}
m.clearChatTrace(); delete globalThis.__GAYZE_CHAT_TRACE_ENABLED__;
console.log(JSON.stringify({ environment: 'jsdom commits; synthetic 1000-message DB, 10ms REST, 20ms channel ACK, 4ms key discovery; real AES-GCM', traces: output }, null, 2));
