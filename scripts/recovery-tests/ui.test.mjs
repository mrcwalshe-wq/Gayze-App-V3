import assert from 'node:assert/strict';
import { test, afterEach } from 'node:test';
import { JSDOM } from 'jsdom';
import { loadModule } from './load-module.mjs';

const dom = new JSDOM('<!doctype html><html><body></body></html>', { url: 'https://gayze.test/' });
for (const key of ['window', 'document', 'navigator', 'HTMLElement', 'localStorage']) {
  Object.defineProperty(globalThis, key, { configurable: true, value: dom.window[key] });
}
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
dom.window.HTMLElement.prototype.scrollIntoView = () => undefined;
const viewport = new dom.window.EventTarget();
viewport.height = 700; viewport.offsetTop = 0;
Object.defineProperty(dom.window, 'visualViewport', { value: viewport });
const React = await import('react');
const { render, cleanup, fireEvent, waitFor } = await import('@testing-library/react');
const { ChatRoomView } = await loadModule('src/components/ChatRoomView.tsx');
afterEach(cleanup);

const room = { id: 'room', name: 'Peer', peerName: 'Peer', peerUserId: 'peer', type: 'direct', ephemeralTtlSeconds: 0 };
const props = {
  rooms: [room], messages: {}, activeRoomId: 'room', currentUserId: 'user',
  currentUser: { publicKey: 'key', displayName: 'You' }, onSelectRoom() {},
  onUpdateRoomTtl() {}, async onSendMessage() {},
};

test('chat status reflects recovery and clears interruption after actual connected state', () => {
  const ui = render(React.createElement(ChatRoomView, { ...props, connectionState: 'reconnecting' }));
  assert.match(ui.getByRole('status').textContent, /reconnecting/);
  ui.rerender(React.createElement(ChatRoomView, { ...props, connectionState: 'syncing' }));
  assert.match(ui.getByRole('status').textContent, /Recovering messages/);
  ui.rerender(React.createElement(ChatRoomView, { ...props, connectionState: 'connected' }));
  assert.match(ui.getByRole('status').textContent, /messages synced/);
  assert(!ui.container.textContent.includes('Connection interrupted'));
});

test('failed send keeps the draft and reuses the same ID on manual retry', async () => {
  const ids = [];
  const ui = render(React.createElement(ChatRoomView, { ...props, onSendMessage: async (...args) => {
    ids.push(args[5]); if (ids.length === 1) throw new Error('network response lost');
  } }));
  const input = ui.getByRole('textbox');
  fireEvent.change(input, { target: { value: 'hello' } });
  fireEvent.submit(input.closest('form'));
  await waitFor(() => assert(ui.getByRole('alert')));
  assert.equal(input.value, 'hello');
  fireEvent.submit(input.closest('form'));
  await waitFor(() => assert.equal(input.value, ''));
  assert.equal(ids.length, 2); assert.equal(ids[0], ids[1]);
});

test('replayed expired/burned rows cannot expose message text, media or forged recent presence', () => {
  const base = { roomId: 'room', senderKey: 'peer', senderName: 'Peer', timestamp: 1 };
  const messages = { room: [
    { ...base, id: 'old', expiresAt: Date.now() - 1000, plainText: 'expired-secret' },
    { ...base, id: 'burned', isBurned: true, plainText: 'burned-secret', mediaUrl: 'https://example.com/private.jpg' },
    { ...base, id: 'live', plainText: 'visible-message' },
  ] };
  const ui = render(React.createElement(ChatRoomView, { ...props, messages }));
  assert(!ui.container.textContent.includes('expired-secret'));
  assert(!ui.container.textContent.includes('burned-secret'));
  assert(ui.container.textContent.includes('visible-message'));
  assert(!ui.container.innerHTML.includes('private.jpg'));
  assert(ui.container.textContent.includes('Last seen unavailable'));
  ui.rerender(React.createElement(ChatRoomView, { ...props, onlineUserIds: new Set(['peer']) }));
  assert(ui.container.textContent.includes('Online now'));
  assert(ui.container.innerHTML.includes('bg-[#C9A24D]'));
});

test('chat consumes keyboard-sized visual viewport and removes layout listeners on unmount', () => {
  const ui = render(React.createElement(ChatRoomView, props));
  viewport.height = 350; viewport.offsetTop = 30;
  viewport.dispatchEvent(new dom.window.Event('resize'));
  assert.equal(document.documentElement.style.getPropertyValue('--g-visual-height'), '350px');
  assert.equal(document.documentElement.style.getPropertyValue('--g-visual-top'), '30px');
  const shell = ui.container.querySelector('.gayze-chat-shell');
  assert(shell.className.includes('min-h-0')); assert(!shell.className.includes('460px'));
  ui.unmount(); viewport.height = 900; viewport.dispatchEvent(new dom.window.Event('resize'));
  assert.equal(document.documentElement.style.getPropertyValue('--g-visual-height'), '');
});

// Actual presence wrapper with a fake Supabase transport and real DOM lifecycle events.
test('incognito never tracks; visible presence leaves on background and tracks again after resume', async () => {
  Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'visible' });
  const active = new Map(), channels = [], callbacks = new Set(); let tracks = 0;
  const backend = {
    auth: {
      async getSession() { return { data: { session: { user: { id: 'user' }, expires_at: Date.now() / 1000 + 3600 } } }; },
      onAuthStateChange(fn) { callbacks.add(fn); return { data: { subscription: { unsubscribe() { callbacks.delete(fn); } } } }; },
    },
    channel(topic) {
      assert(!active.has(topic));
      const ch = {
        state: 'joining', on() { return ch; }, presenceState() { return {}; },
        subscribe(fn) { ch.status = fn; queueMicrotask(() => { ch.state = 'joined'; fn('SUBSCRIBED'); }); return ch; },
        async track() { tracks++; return 'ok'; }, async untrack() { return 'ok'; },
        async unsubscribe() { ch.state = 'closed'; ch.status('CLOSED'); return 'ok'; },
        teardown() { active.delete(topic); },
      }; active.set(topic, ch); channels.push(ch); return ch;
    },
  };
  const { initPresence } = await loadModule('src/services/supabaseService.ts', backend);
  let stop = initPresence('user', 'Private', () => {}, false);
  await new Promise((resolve) => setTimeout(resolve, 220));
  assert.equal(tracks, 0); stop(); await new Promise((resolve) => setTimeout(resolve, 0));
  stop = initPresence('user', 'Visible', () => {}, true);
  try {
    await new Promise((resolve) => setTimeout(resolve, 220)); assert.equal(tracks, 1);
    Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'hidden' });
    document.dispatchEvent(new dom.window.Event('visibilitychange'));
    await new Promise((resolve) => setTimeout(resolve, 0)); assert.equal(active.size, 0);
    Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'visible' });
    window.dispatchEvent(new dom.window.Event('pageshow'));
    await new Promise((resolve) => setTimeout(resolve, 1100)); assert.equal(active.size, 1); assert.equal(tracks, 2);
  } finally { stop(); }
});
