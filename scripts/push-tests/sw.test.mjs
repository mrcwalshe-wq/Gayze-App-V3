/**
 * Service worker routing tests.
 *
 * Loads the REAL `public/service-worker.js` into Node against a fake `self` and
 * drives the `push` and `notificationclick` handlers exactly as a browser
 * would, asserting the notification destination for every Gayze event type and
 * the narrow-fetch guarantees.
 *
 * Run: node scripts/push-tests/sw.test.mjs
 */
import fs from 'node:fs';
import url from 'node:url';

const REPO = url.fileURLToPath(new URL('../..', import.meta.url)).replace(/\/$/, '');
const SW_URL = 'https://gayze.app/service-worker.js';

let failures = 0;
function assert(cond, msg) {
  if (!cond) { console.error('  ✗ FAIL:', msg); failures += 1; process.exitCode = 1; }
  else console.log('  ✓', msg);
}

// ---------------------------------------------------------------------------
// Fake service worker global
// ---------------------------------------------------------------------------
const listeners = new Map();
const shown = [];        // showNotification(title, options)
const clientMessages = []; // client.postMessage(...)
const opened = [];       // clients.openWindow(url)
const focused = [];      // client.focus()

const clientList = [];
const fakeSelf = {
  location: new URL(SW_URL),
  addEventListener: (type, fn) => { (listeners.get(type) ?? listeners.set(type, []).get(type)).push(fn); },
  skipWaiting: async () => {},
  registration: {
    navigationPreload: null,
    showNotification: async (title, options) => { shown.push({ title, options }); },
  },
  clients: {
    matchAll: async () => clientList,
    openWindow: async (u) => { opened.push(u); return null; },
  },
  navigator: {},
};
globalThis.self = fakeSelf;
globalThis.caches = {
  open: async () => ({ add: async () => {}, match: async () => null, put: async () => {} }),
  keys: async () => [],
  delete: async () => true,
};

await import(fs.realpathSync(`${REPO}/public/service-worker.js`));

const fire = async (type, event) => {
  const waits = [];
  for (const fn of listeners.get(type) ?? []) {
    await fn({ waitUntil: (p) => waits.push(Promise.resolve(p)), ...event });
  }
  await Promise.all(waits);
};

// ---------------------------------------------------------------------------
console.log('\n=== [1] push event -> correct notification destination per event type ===');
// ---------------------------------------------------------------------------
const cases = [
  ['message',        { type: 'message', body: 'Chris sent you a message', conversationId: 'conv-1', url: '/messages/conv-1' }, '/messages/conv-1', 'New message'],
  ['connection',     { type: 'connection', body: 'You and someone nearby are both interested.', conversationId: 'conv-1', url: '/messages/conv-1' }, '/messages/conv-1', 'New connection'],
  ['intent',         { type: 'intent', body: 'Someone responded to your active intent.', intentId: 'i-1', url: '/right-now' }, '/right-now', 'Someone is interested'],
  ['intent_expiring',{ type: 'intent_expiring', body: 'Your active intent expires shortly.', intentId: 'i-1', url: '/profile' }, '/profile', 'Your intent is ending soon'],
  ['safety',         { type: 'safety', title: 'Gayze safety alert', body: 'Your safety check-in timer has ended. Confirm you are safe.', url: '/profile' }, '/profile', 'Gayze safety alert'],
  ['system/test',    { type: 'test', body: 'Your Gayze push notifications are now enabled.', url: '/profile' }, '/profile', 'Gayze notifications are working'],
];
for (const [label, payload, expectUrl, expectTitle] of cases) {
  shown.length = 0;
  await fire('push', { data: { json: () => payload, text: () => '' } });
  const n = shown[0];
  assert(Boolean(n) && n.title === expectTitle, `${label}: notification shown with the expected title`);
  assert(n.options.data.url === expectUrl,
    `${label}: tap destination is ${expectUrl} (got ${n.options.data?.url})`);
  assert(n.options.tag === `gayze-${payload.type}-${payload.conversationId || payload.intentId || 'general'}`,
    `${label}: per-object tag replaces instead of stacking (tag: ${n.options.tag})`);
  assert(n.options.icon === '/icons/gayze-192.png', `${label}: Gayze icon set`);
  assert((n.options.body ?? '') === payload.body, `${label}: body carried verbatim`);
}
{
  shown.length = 0;
  await fire('push', { data: { json: () => ({ type: 'safety', body: 'x', url: '/profile' }), text: () => '' } });
  assert(shown[0].options.requireInteraction === true, 'safety: requireInteraction persists on the Lock Screen');
}
{
  shown.length = 0;
  await fire('push', { data: { json: () => ({ type: 'message', body: 'x', url: '/messages/c9', conversationId: 'c9' }), text: () => '' } });
  assert(shown[0].options.data.conversationId === 'c9', 'notification data carries the conversation id for the router');
}

// ---------------------------------------------------------------------------
console.log('\n=== [2] payload hardening ===');
// ---------------------------------------------------------------------------
{
  shown.length = 0;
  await fire('push', { data: { json: () => ({ type: 'unknown-type', url: 'https://evil.example/phish' }), text: () => '' } });
  assert(shown[0].title === 'New message', 'unknown type collapses to the message default copy');
  assert(shown[0].options.data.url === '/messages', `off-origin URL collapses to the safe default (got ${shown[0].options.data.url})`);
}
{
  shown.length = 0;
  await fire('push', { data: { json: () => ({ type: 'message', url: '/messages/conv-9?tab=chat#bottom' }), text: () => '' } });
  assert(shown[0].options.data.url === '/messages/conv-9?tab=chat#bottom', 'same-origin path survives with query and hash intact');
}
{
  shown.length = 0;
  await fire('push', { data: { json: () => ({ type: 'message', url: 'javascript:alert(1)' }), text: () => '' } });
  assert(shown[0].options.data.url === '/messages', 'javascript: URLs collapse to the safe default');
}
{
  shown.length = 0;
  await fire('push', { data: null });
  assert(shown[0].title === 'New message' && shown[0].options.data.url === '/messages', 'payload-less push shows the default message notification without crashing');
}
{
  shown.length = 0;
  await fire('push', { data: { json: () => { throw new Error('not json'); }, text: () => 'plain text body' } });
  assert(shown[0].options.body === 'plain text body', 'non-JSON payload body is used as plain text (still no crash)');
}

// ---------------------------------------------------------------------------
console.log('\n=== [3] notificationclick routing ===');
// ---------------------------------------------------------------------------
{
  // With an open Gayze window: focus it and route in-place (session preserved).
  clientList.length = 0; opened.length = 0; focused.length = 0; clientMessages.length = 0;
  clientList.push({
    url: 'https://gayze.app/profile',
    focus: async () => { focused.push(true); },
    postMessage: (m, ports) => { clientMessages.push(m); ports?.[0]?.postMessage({ handled: true }); ports?.[0]?.close(); },
  });
  await fire('notificationclick', {
    notification: { data: { type: 'message', url: '/messages/conv-9', conversationId: 'conv-9' }, close: () => {} },
  });
  assert(focused.length === 1 && clientMessages.length === 1, 'open window is focused and receives the route message');
  assert(clientMessages[0].type === 'NOTIFICATION_CLICK' && clientMessages[0].url === '/messages/conv-9',
    `message tap -> /messages/<conversation-id> (got ${clientMessages[0].url})`);
  assert(opened.length === 0, 'no second window is opened when one is already running');
}
{
  // No open window: open a new one on this worker's own origin.
  clientList.length = 0; opened.length = 0;
  await fire('notificationclick', {
    notification: { data: { type: 'intent', url: '/right-now', intentId: 'i-2' }, close: () => {} },
  });
  assert(opened.length === 1 && opened[0] === 'https://gayze.app/right-now',
    `intent tap with app closed -> opens ${opened[0] ?? 'nothing'}`);
}
{
  // A foreign-origin window is ignored; off-origin targets collapse.
  clientList.length = 0; opened.length = 0; focused.length = 0; clientMessages.length = 0;
  clientList.push({
    url: 'https://other-site.example/page',
    focus: async () => { focused.push(true); },
    postMessage: (m) => { clientMessages.push(m); },
  });
  await fire('notificationclick', {
    notification: { data: { type: 'connection', url: 'https://evil.example/x' }, close: () => {} },
  });
  assert(focused.length === 0 && opened.length === 1 && opened[0] === 'https://gayze.app/messages',
    `foreign windows are never focused; collapsed target opens on the Gayze origin (got ${opened[0]})`);
}
{
  // Every event type routes to its documented destination on tap.
  const tapCases = [
    [{ type: 'safety', url: '/profile' }, '/profile'],
    [{ type: 'intent_expiring', url: '/profile' }, '/profile'],
    [{ type: 'test', url: '/profile' }, '/profile'],
    [{ type: 'message', url: '/messages' }, '/messages'],
  ];
  for (const [data, expect] of tapCases) {
    clientList.length = 0; opened.length = 0;
    await fire('notificationclick', { notification: { data, close: () => {} } });
    assert(opened[0] === `https://gayze.app${expect}`, `tap routes to ${expect} (got ${opened[0]})`);
  }
}

// ---------------------------------------------------------------------------
console.log('\n=== [4] fetch handler stays narrow (never intercepts API traffic) ===');
// ---------------------------------------------------------------------------
{
  const fetchFn = (listeners.get('fetch') ?? [])[0];
  assert(Boolean(fetchFn), 'fetch handler registered');
  const passthrough = async (request) => {
    let intercepted = false;
    await fetchFn({ request, respondWith: () => { intercepted = true; } });
    return intercepted;
  };
  assert(!(await passthrough({ method: 'GET', url: 'https://qdewyupsqmtonkloqxsh.supabase.co/rest/v1/messages', headers: { has: () => false } })),
    'Supabase REST (cross-origin) is never intercepted');
  assert(!(await passthrough({ method: 'GET', url: 'https://qdewyupsqmtonkloqxsh.supabase.co/auth/v1/token', headers: { has: () => false } })),
    'Supabase Auth (cross-origin) is never intercepted');
  assert(!(await passthrough({ method: 'POST', url: 'https://gayze.app/api/write', headers: { has: () => false } })),
    'non-GET same-origin traffic is never intercepted');
  assert(!(await passthrough({ method: 'GET', url: 'https://gayze.app/rest/proxy', headers: { has: (h) => h === 'Authorization' } })),
    'Authorization-bearing requests are never intercepted');
}

console.log('');
if (failures > 0) {
  console.error(`SERVICE WORKER TESTS: ${failures} FAILED`);
  process.exitCode = 1;
} else {
  console.log('SERVICE WORKER TESTS: ALL PASSED');
}
