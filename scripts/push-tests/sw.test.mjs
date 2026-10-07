import fs from 'node:fs';
import url from 'node:url';

const REPO = url.fileURLToPath(new URL('../..', import.meta.url)).replace(/\/$/, '');
const SW_URL = 'https://gayze.co.uk/service-worker.js';
let failures = 0;
const assert = (ok, message) => { if (!ok) { console.error('  ✗ FAIL:', message); failures += 1; process.exitCode = 1; } else console.log('  ✓', message); };
const listeners = new Map();
const shown = [];
const opened = [];
const clients = [];
const diagnostics = [];
let rejectNext = false;
const nativeInfo = console.info;
console.info = (...args) => { if (args[0] === '[GAYZE push diagnostic]') diagnostics.push(args.slice(1)); else nativeInfo(...args); };
globalThis.self = {
  location: new URL(SW_URL),
  addEventListener: (type, fn) => { if (!listeners.has(type)) listeners.set(type, []); listeners.get(type).push(fn); },
  skipWaiting: async () => {},
  registration: { navigationPreload: null, showNotification: async (title, options) => { if (rejectNext) { const e = new Error('simulated'); e.name = 'NotAllowedError'; throw e; } shown.push({ title, options }); } },
  clients: { matchAll: async () => clients, openWindow: async (target) => { opened.push(target); return null; } },
  navigator: {},
};
globalThis.caches = { open: async () => ({ add: async () => {}, match: async () => null, put: async () => {} }), keys: async () => [], delete: async () => true };
await import(fs.realpathSync(`${REPO}/public/service-worker.js`));
async function fire(type, event) { const waits = []; for (const fn of listeners.get(type) ?? []) await fn({ waitUntil: (p) => waits.push(Promise.resolve(p)), ...event }); await Promise.all(waits); }
console.log('\n=== Service worker push presentation ===');
for (const [type, expectedTitle, expectedPath] of [
  ['message', 'New message', '/messages/11111111-1111-4111-8111-111111111111?notification=22222222-2222-4222-8222-222222222222'],
  ['connection', 'New connection', '/messages/11111111-1111-4111-8111-111111111111?notification=22222222-2222-4222-8222-222222222222'],
  ['gaze', 'New Gayze', '/notifications'],
  ['intent', 'Someone is interested', '/right-now'],
  ['intent_expiring', 'Your intent is ending soon', '/profile'],
  ['safety', 'Safety alert', '/profile'],
  ['test', 'Gayze Test', '/notifications'],
]) {
  shown.length = 0;
  const payload = { type, title: expectedTitle, body: 'Push notification test', notificationId: '22222222-2222-4222-8222-222222222222', conversationId: type === 'message' || type === 'connection' ? '11111111-1111-4111-8111-111111111111' : undefined, url: expectedPath.split('?')[0] };
  await fire('push', { data: { json: () => payload, text: () => '' } });
  const n = shown.at(-1);
  assert(Boolean(n), `${type}: notification shown`);
  assert(n?.title === expectedTitle, `${type}: title`);
  assert(n?.options.data.url === expectedPath, `${type}: route`);
  assert(n?.options.icon === '/icons/gayze-192.png', `${type}: icon`);
  assert(n?.options.silent === false, `${type}: never silent`);
  assert(n?.options.renotify === true, `${type}: renotify enabled`);
}
console.log('\n=== Safe payload and diagnostics ===');
shown.length = 0;
await fire('push', { data: { json: () => ({ type: 'unknown-type', url: 'https://evil.example/phish' }), text: () => '' } });
assert(shown.at(-1)?.title === 'New message', 'unknown type uses safe default');
assert(shown.at(-1)?.options.data.url === '/messages', 'off-origin URL uses safe fallback');
const start = diagnostics.length;
rejectNext = true;
let rejected = false;
try { await fire('push', { data: { json: () => ({ title: 'Gayze Test', body: 'Push notification test' }) } }); } catch { rejected = true; }
rejectNext = false;
const d = diagnostics.slice(start);
assert(rejected, 'showNotification rejection propagates');
assert(d.some(([stage]) => stage === 'push-received'), 'push receipt diagnostic');
assert(d.some(([stage]) => stage === 'payload-parsed'), 'payload diagnostic');
assert(d.some(([stage]) => stage === 'showNotification-called'), 'showNotification-called diagnostic');
assert(d.some(([stage, detail]) => stage === 'showNotification-rejected' && detail?.errorName === 'NotAllowedError'), 'safe rejection diagnostic');
assert(!JSON.stringify(d).includes('Push notification test'), 'diagnostics never contain notification text');
console.log('\n=== Notification click ===');
clients.length = 0; opened.length = 0;
await fire('notificationclick', { notification: { data: { type: 'message', conversationId: '11111111-1111-4111-8111-111111111111', notificationId: '22222222-2222-4222-8222-222222222222' }, close: () => {} } });
assert(opened[0] === 'https://gayze.co.uk/messages/11111111-1111-4111-8111-111111111111?notification=22222222-2222-4222-8222-222222222222', 'message click opens the correct same-origin conversation');
console.log('\n=== Fetch boundary ===');
const fetchHandler = listeners.get('fetch')?.[0];
let intercepted = false;
await fetchHandler({ request: { method: 'GET', url: 'https://qdewyupsqmtonkloqxsh.supabase.co/rest/v1/messages', headers: { has: () => false } }, respondWith: () => { intercepted = true; } });
assert(!intercepted, 'cross-origin Supabase traffic is untouched');
console.info = nativeInfo;
if (failures) { console.error(`SERVICE WORKER TESTS: ${failures} FAILED`); process.exitCode = 1; } else console.log('SERVICE WORKER TESTS: ALL PASSED');
