import assert from 'node:assert/strict';
import { test, afterEach } from 'node:test';
import { readFileSync } from 'node:fs';
import { MessageChannel } from 'node:worker_threads';
import vm from 'node:vm';
import { JSDOM } from 'jsdom';
import { loadModule } from '../recovery-tests/load-module.mjs';
const dom = new JSDOM('<!doctype html><html><body></body></html>', { url: 'https://gayze.co.uk/', pretendToBeVisual: true });
for (const key of ['window', 'document', 'navigator', 'HTMLElement', 'localStorage']) Object.defineProperty(globalThis, key, { configurable: true, value: dom.window[key] });
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
const React = await import('react');
const { render, cleanup, fireEvent } = await import('@testing-library/react');
const { ChatRoomView } = await loadModule('src/components/ChatRoomView.tsx');
afterEach(cleanup);
const room = { id: 'room', name: 'Peer', peerName: 'Peer', peerUserId: 'peer', type: 'direct', ephemeralTtlSeconds: 0 };
const props = { rooms: [room], activeRoomId: 'room', currentUserId: 'user', currentUser: { publicKey: 'key', displayName: 'You' },
  onSelectRoom() {}, onUpdateRoomTtl() {}, async onSendMessage() {} };
const messages = Array.from({ length: 1000 }, (_, i) => ({ id: `id-${i}`, roomId: 'room', senderKey: 'peer', senderName: 'Peer', timestamp: i,
  cipherText: 'cipher', nonceHex: 'nonce', plainText: `body-${String(i).padStart(4, '0')}` }));

test('large cached room renders newest 100 immediately; older expansion preserves chronology and scroll anchor', () => {
  const ui = render(React.createElement(ChatRoomView, { ...props, messages: { room: messages }, connectionState: 'syncing' }));
  assert(ui.getByText('body-0999')); assert(!ui.queryByText('body-0899'));
  assert.equal(ui.getAllByText(/^body-/).length, 100);
  const button = ui.getByRole('button', { name: 'Show older messages' }), feed = button.parentElement;
  Object.defineProperty(feed, 'scrollHeight', { configurable: true, get: () => ui.getAllByText(/^body-/).length * 20 });
  feed.scrollTop = 120;
  fireEvent.click(button);
  assert.equal(ui.getAllByText(/^body-/).length, 200); assert.equal(feed.scrollTop, 2120);
  assert.equal(ui.getAllByText(/^body-/)[0].textContent, 'body-0800');
  assert.equal(ui.getAllByText(/^body-/).at(-1).textContent, 'body-0999');
  ui.unmount();
  const reopened = render(React.createElement(ChatRoomView, { ...props, messages: { room: messages }, connectionState: 'syncing' }));
  assert(reopened.getByText('body-0999')); assert.equal(reopened.getAllByText(/^body-/).length, 100);
});

test('prepending recovered history does not yank the reader to the bottom; presence is not tied to sync status', () => {
  const ui = render(React.createElement(ChatRoomView, { ...props, messages: { room: messages.slice(-50) }, onlineUserIds: new Set(['peer']), connectionState: 'syncing' }));
  const body = ui.getByText('body-0999');
  const feed = body.closest('.overflow-y-auto');
  feed.scrollTop = 123;
  ui.rerender(React.createElement(ChatRoomView, { ...props, messages: { room: messages }, onlineUserIds: new Set(['peer']), connectionState: 'syncing' }));
  assert.equal(feed.scrollTop, 123); assert(ui.getByText('Online now'));
  assert(!ui.container.textContent.includes('Connection interrupted'));
});

test('parallel/repeated avatar signing requests coalesce; failures are retryable, not a render loop', async () => {
  let requests = 0, fail = false;
  const backend = { storage: { from() { return { async createSignedUrl() {
    requests++; await new Promise((resolve) => setTimeout(resolve, 5));
    return fail ? { error: new Error('unavailable') } : { data: { signedUrl: 'https://example.invalid/signed.jpg' } };
  } }; } } };
  const { getProfilePhotoUrl } = await loadModule('src/services/profilePhotoService.ts', backend);
  const urls = await Promise.all(Array.from({ length: 20 }, () => getProfilePhotoUrl('photo/path')));
  assert.equal(requests, 1); assert(urls.every((url) => url === urls[0]));
  fail = true; assert.equal(await getProfilePhotoUrl('missing/path'), null);
  fail = false; assert(await getProfilePhotoUrl('missing/path')); assert.equal(requests, 3);
});

function worker({ focused = false, acknowledge = false, respond = true } = {}) {
  const handlers = {}, shown = [], posted = [], receipts = new Map();
  const self = { location: new URL('https://gayze.co.uk/service-worker.js'), navigator: {},
    addEventListener(type, fn) { handlers[type] = fn; },
    registration: { async showNotification(title, options) { shown.push({ title, options }); } },
    clients: { async matchAll() { return [{ focused, visibilityState: focused ? 'visible' : 'hidden',
      postMessage(value, ports) { posted.push(value); if (ports?.[0]) { if (respond) ports[0].postMessage({ handled: acknowledge }); ports[0].close(); } },
    }]; } },
  };
  const cache = { async match(key) { return receipts.get(key); }, async put(key, value) { receipts.set(key, value); },
    async keys() { return [...receipts.keys()]; }, async delete(key) { receipts.delete(key); } };
  vm.runInNewContext(readFileSync('public/service-worker.js', 'utf8'), { self, caches: { open: async () => cache }, URL, Request, Response, MessageChannel, setTimeout, clearTimeout, console });
  return { shown, posted, async push(payload) { let pending; handlers.push({ data: { json: () => payload }, waitUntil(work) { pending = work; } }); await pending; } };
}
const payload = { type: 'message', notificationId: '10000000-0000-4000-8000-000000000001', messageId: '20000000-0000-4000-8000-000000000001',
  recipientId: '30000000-0000-4000-8000-000000000001', conversationId: '40000000-0000-4000-8000-000000000001', url: '/messages/40000000-0000-4000-8000-000000000001' };

test('foreground acknowledgement gives one quiet OS record, one presentation request; native replay replaces the same OS record quietly', async () => {
  const w = worker({ focused: true, acknowledge: true });
  await w.push(payload); await w.push(payload);
  assert.equal(w.shown.length, 2); assert.equal(w.shown[0].options.silent, true);
  assert.equal(w.shown[1].options.silent, true); assert.equal(w.shown[1].options.tag, w.shown[0].options.tag);
  assert.equal(w.posted.filter((message) => message.type === 'PRESENT_MESSAGE').length, 1);
  assert.equal(w.shown[0].options.data.messageId, payload.messageId);
});

test('background, old/unresponsive app or rejected account acknowledgement keeps native alert audible', async () => {
  for (const options of [{ focused: false }, { focused: true, acknowledge: false }, { focused: true, respond: false }]) {
    const w = worker(options); await w.push(payload);
    assert.equal(w.shown.length, 1); assert.equal(w.shown[0].options.silent, false);
  }
});

test('foreground push without correlation IDs safely falls back to normal native delivery', async () => {
  const w = worker({ focused: true, acknowledge: true }); await w.push({ ...payload, messageId: undefined });
  assert.equal(w.shown[0].options.silent, false);
  assert.equal(w.posted.filter((message) => message.type === 'PRESENT_MESSAGE').length, 0);
});
