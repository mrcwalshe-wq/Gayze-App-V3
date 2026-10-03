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
const { render, cleanup, fireEvent, waitFor } = await import('@testing-library/react');
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

test('profile photos upload, display from signed storage URLs, replace primary, and delete cleanly', async () => {
  const owner = '30000000-0000-4000-8000-000000000001';
  const rows = [], objects = new Map(), profile = { avatar_path: null };
  let signedRequests = 0;
  const backend = {
    auth: { async getUser() { return { data: { user: { id: owner } }, error: null }; } },
    storage: { from(bucket) {
      assert.equal(bucket, 'profile-photos');
      return {
        async upload(path, file, options) {
          objects.set(path, { file, options }); return { error: null };
        },
        async createSignedUrl(path, expiresIn) {
          signedRequests++;
          assert.equal(expiresIn, 3600);
          assert(objects.has(path), `signed URL path exists in storage: ${path}`);
          return { data: { signedUrl: `https://signed.test/${path}?signature=${signedRequests}` }, error: null };
        },
        async remove(paths) {
          for (const path of paths) objects.delete(path);
          return { error: null };
        },
      };
    } },
    from(table) {
      let operation = 'select', values, filters = {};
      const query = {
        select() { operation = 'select'; return query; },
        insert(value) { operation = 'insert'; values = value; return query; },
        update(value) { operation = 'update'; values = value; return query; },
        delete() { operation = 'delete'; return query; },
        eq(column, value) { filters[column] = value; return query; },
        order() { return query; },
        async maybeSingle() {
          const data = table === 'profile_photos'
            ? rows.find((row) => Object.entries(filters).every(([key, value]) => row[key] === value)) ?? null
            : null;
          return { data, error: null };
        },
        then(resolve, reject) {
          let data = null;
          if (table === 'profile_photos') {
            if (operation === 'insert') {
              rows.push({ id: crypto.randomUUID(), ...values });
            } else if (operation === 'delete') {
              for (let i = rows.length - 1; i >= 0; i--) {
                if (Object.entries(filters).every(([key, value]) => rows[i][key] === value)) rows.splice(i, 1);
              }
            } else if (operation === 'update') {
              for (const row of rows) {
                if (Object.entries(filters).every(([key, value]) => row[key] === value)) Object.assign(row, values);
              }
            } else {
              data = rows.filter((row) => row.user_id === filters.user_id)
                .sort((a, b) => a.sort_order - b.sort_order).map((row) => ({ ...row }));
            }
          } else if (table === 'profiles' && operation === 'update' && filters.id === owner) {
            Object.assign(profile, values);
          }
          return Promise.resolve({ data, error: null }).then(resolve, reject);
        },
      };
      return query;
    },
    rpc: async () => ({ error: new Error('exercise owner-scoped fallback updates') }),
  };
  const photos = await loadModule('src/services/profilePhotoService.ts', backend);
  const first = await photos.uploadProfilePhoto(new dom.window.File(['first'], 'first.jpg', { type: 'image/jpeg' }));
  assert.equal(first.length, 1);
  assert.equal(objects.size, 1);
  assert.equal(profile.avatar_path, first[0].storagePath);
  assert.match(first[0].url, new RegExp(first[0].storagePath));

  const { ProfileView } = await loadModule('src/components/ProfileView.tsx', backend);
  const props = {
    currentUser: { displayName: 'Owner', handle: 'owner', privacySetting: 'ghost', interests: [] },
    onOpenSafetyTimer() {}, isSafetyTimerActive: false, onOpenMask() {}, onOpenIdentity() {}, onOpenQR() {}, onOpenSafeHavens() {},
  };
  let ui = render(React.createElement(ProfileView, props));
  await waitFor(() => assert(ui.container.querySelector(`img[src*="${first[0].storagePath}"]`)));
  const initialSignedUrl = ui.container.querySelector('img')?.src;
  const realNow = Date.now;
  Date.now = () => realNow() + 51 * 60 * 1000;
  const requestsBeforeRefresh = signedRequests;
  window.dispatchEvent(new window.Event('pageshow'));
  await waitFor(() => assert(signedRequests > requestsBeforeRefresh));
  assert.notEqual(ui.container.querySelector('img')?.src, initialSignedUrl);
  Date.now = realNow;

  const twoPhotos = await photos.uploadProfilePhoto(new dom.window.File(['second'], 'second.jpg', { type: 'image/jpeg' }));
  assert.equal(twoPhotos.length, 2);
  assert.equal(profile.avatar_path, first[0].storagePath);
  const replaced = await photos.setPrimaryProfilePhoto(twoPhotos[1].id);
  assert.equal(replaced.find((photo) => photo.isPrimary).storagePath, twoPhotos[1].storagePath);
  assert.equal(profile.avatar_path, twoPhotos[1].storagePath);
  assert.equal(objects.has(twoPhotos[1].storagePath), true);
  ui.unmount();
  ui = render(React.createElement(ProfileView, props));
  await waitFor(() => assert(ui.container.querySelector(`img[src*="${twoPhotos[1].storagePath}"]`)));

  const afterDelete = await photos.deleteProfilePhoto(replaced.find((photo) => photo.isPrimary));
  assert.equal(afterDelete.length, 1);
  assert.equal(afterDelete[0].isPrimary, true);
  assert.equal(profile.avatar_path, first[0].storagePath);
  assert.equal(objects.has(twoPhotos[1].storagePath), false);
  ui.unmount();
  ui = render(React.createElement(ProfileView, props));
  await waitFor(() => assert(ui.container.querySelector(`img[src*="${first[0].storagePath}"]`)));
  assert(signedRequests >= 4, 'profile image URLs are freshly signed rather than served from a public bucket');
  ui.unmount();
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
  vm.runInNewContext(readFileSync('public/service-worker.js', 'utf8'), { self, caches: { open: async () => cache }, URL, URLSearchParams, Request, Response, MessageChannel, setTimeout, clearTimeout, console });
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
