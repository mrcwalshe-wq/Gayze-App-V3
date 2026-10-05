/** Offline release audit, NOT a delivery test. Does not contact a provider,
 * production Supabase or Cloudflare. Exit 1 means unresolved release findings;
 * these are separate from the five pre-existing broken test suites.
 * Run after npm ci && npm run test:setup, from the repository root.
 */
import { readFileSync } from 'node:fs';
import { createECDH, randomBytes } from 'node:crypto';
import vm from 'node:vm';
import { MessageChannel } from 'node:worker_threads';
import { JSDOM } from 'jsdom';
import { loadModule } from '../recovery-tests/load-module.mjs';

const findings = [];
const observations = {};
const id = '10000000-0000-4000-8000-000000000001';
const room = '20000000-0000-4000-8000-000000000001';
const payload = { type: 'message', notificationId: id, conversationId: room, url: `/messages/${room}?notification=${id}`, tag: `gayze-${id}` };
function worker(receipts = new Map(), clients = []) {
  const events = {}, opened = [], shown = [];
  let attempts = 0, displayed = 0, fail = false;
  const self = { location: new URL('https://gayze.co.uk/service-worker.js'), navigator: {},
    addEventListener(type, fn) { events[type] = fn; },
    registration: { async showNotification(title, options) { attempts++; if (fail) throw new Error('simulated notification display failure'); displayed++; shown.push({ title, options }); } },
    clients: { async matchAll() { return clients; }, async openWindow(url) { opened.push(url); } },
  };
  const cache = { async match(key) { return receipts.get(String(key)); }, async put(key, value) { receipts.set(String(key), value); },
    async keys() { return [...receipts.keys()]; }, async delete(key) { return receipts.delete(key); } };
  vm.runInNewContext(readFileSync('public/service-worker.js', 'utf8'), { self, caches: { open: async () => cache }, URL, Response, Request, MessageChannel, setTimeout, clearTimeout, console });
  return { opened, shown, get attempts() { return attempts; }, get displayed() { return displayed; }, set fail(value) { fail = value; },
    async fire(type, value) { let work; events[type]({ waitUntil(promise) { work = promise; }, ...value }); await work; } };
}

const failedReceipts = new Map(), failing = worker(failedReceipts);
failing.fail = true;
await failing.fire('push', { data: { json: () => payload } }).catch(() => {});
observations.noReceiptAfterFailedDisplay = failedReceipts.size === 0;
const afterRestart = worker(failedReceipts);
await afterRestart.fire('push', { data: { json: () => payload } });
observations.displayFailure = { firstAttempts: failing.attempts, firstDisplayed: failing.displayed, replayDisplayed: afterRestart.displayed };
if (!observations.noReceiptAfterFailedDisplay || afterRestart.displayed !== 1) findings.push({ id: 'display-receipt-order', severity: 'blocker',
  evidence: 'Receipt survives showNotification rejection; replay after restart never retries display.' });

const replay = worker();
await replay.fire('push', { data: { json: () => payload } });
const before = replay.displayed;
await replay.fire('push', { data: { json: () => payload } });
observations.replayDisplaysVisibleNotification = replay.displayed > before;
observations.replayQuietStableTag = replay.shown[1]?.options.tag === replay.shown[0]?.options.tag && replay.shown[1]?.options.silent === true;
if (!observations.replayDisplaysVisibleNotification || !observations.replayQuietStableTag) findings.push({ id: 'apple-visible-replay', severity: 'platform-policy-risk',
  evidence: 'Duplicate push event returns without showNotification. Requires review against Apple userVisibleOnly policy, not an exactly-once claim.' });

const staleClient = worker(new Map(), [{ url: 'https://gayze.co.uk/', async focus() { throw new Error('simulated stale client'); }, postMessage() {} }]);
let clickRejected = false;
await staleClient.fire('notificationclick', { notification: { data: payload, close() {} } }).catch(() => { clickRejected = true; });
observations.staleWindowClick = { clickRejected, fallbackWindows: staleClient.opened.length };
if (clickRejected || staleClient.opened[0] !== `https://gayze.co.uk${payload.url}`) findings.push({ id: 'click-fallback', severity: 'blocker',
  evidence: 'A rejecting window.focus aborts click routing without openWindow fallback. Warm routing also has no SPA-ready acknowledgement.' });

const { allowedEndpoint, createPushHandler } = await loadModule('supabase/functions/send-push/handler.ts');
observations.appleEndpoints = { canonical: allowedEndpoint('https://web.push.apple.com/local-audit'),
  alternativeSubdomain: allowedEndpoint('https://alternate.push.apple.com/local-audit') };
if (!observations.appleEndpoints.alternativeSubdomain) findings.push({ id: 'apple-host-contract', severity: 'compatibility-risk',
  evidence: 'Only web.push.apple.com is accepted; official Apple guidance allows any subdomain of push.apple.com. Other such hosts are classified invalid and pruned. No actual device hostname was inspected.' });

// Exact provider-status handling, using real handler/key validation and a fake
// store/provider. The existing PGlite suite independently tests DB ownership.
observations.expiredSubscriptionMatrix = [];
for (const providerStatus of [404, 410, 401, 403, 429, 500, 'timeout']) {
  const receiver = createECDH('prime256v1'); receiver.generateKeys();
  const subscription = { id: room, user_id: id, endpoint: 'https://web.push.apple.com/offline-only',
    p256dh: receiver.getPublicKey().toString('base64url'), auth: randomBytes(16).toString('base64url') };
  let claimed = false, pruned = false, attempts = 0, state;
  const notice = { id, user_id: id, category: 'message', event_key: room, url: `/messages/${room}`, read_at: null, created_at: new Date().toISOString() };
  const store = {
    async notice() { return notice; }, async eligible() { return true; }, async preferences() { return {}; },
    async subscriptions() { return pruned ? [] : [subscription]; }, async unread() { return 1; },
    async claim() { if (claimed) return false; claimed = true; return true; },
    async finish(_id, _endpoint, value) { state = value; }, async prune(value) { if (value !== subscription) throw new Error('Wrong subscription'); pruned = true; },
    async complete() {},
  };
  const handler = createPushHandler(store, async () => { attempts++; throw providerStatus === 'timeout' ? new Error('offline simulated timeout') : { statusCode: providerStatus }; },
    { configured: true, origins: [], dispatchSecret: 'offline-test-only' });
  const request = () => new Request('https://offline.invalid/send-push', { method: 'POST', headers: { 'x-gayze-dispatch-secret': 'offline-test-only' }, body: JSON.stringify({ notificationId: id }) });
  const response = await handler(request()); await handler(request());
  observations.expiredSubscriptionMatrix.push({ providerStatus, response: response.status, pruned, state, attempts, noticeRetained: (await store.notice()).id === id });
  const shouldPrune = providerStatus === 404 || providerStatus === 410;
  if (pruned !== shouldPrune || attempts !== 1 || response.status !== 200) findings.push({ id: 'provider-pruning', severity: 'blocker', evidence: `Unexpected handling of ${providerStatus}` });
}

// A strict gesture boundary is simulated, NOT an assertion about a physical iPhone.
const dom = new JSDOM('<!doctype html><html></html>', { url: 'https://gayze.co.uk/' });
Object.defineProperty(globalThis, 'window', { configurable: true, value: dom.window });
Object.defineProperty(globalThis, 'navigator', { configurable: true, value: dom.window.navigator });
Object.defineProperty(navigator, 'userAgent', { configurable: true, value: 'iPhone Safari' });
Object.defineProperty(navigator, 'standalone', { configurable: true, value: true });
window.PushManager = class {};
let ready, gesture = true, permissionCalls = 0;
const readyPromise = new Promise(resolve => { ready = resolve; });
const registration = { pushManager: { async getSubscription() { return null; }, async subscribe() {
  return { endpoint: 'https://web.push.apple.com/local-only', getKey() { return new Uint8Array([1, 2, 3]).buffer; } };
} } };
Object.defineProperty(navigator, 'serviceWorker', { configurable: true, value: { async register() { return registration; }, ready: readyPromise } });
window.Notification = globalThis.Notification = { permission: 'default', async requestPermission() { permissionCalls++; return gesture ? 'granted' : 'denied'; } };
let persistedRow = null;
const backend = { auth: { async getSession() { return { data: { session: { user: { id } } } }; } },
  from() { return { select() { return this; }, eq() { return this; },
    async maybeSingle() { return { data: persistedRow, error: null }; },
    async upsert(value) { persistedRow = { ...value, id: 'offline-enrollment' }; return { error: null }; } }; } };
const key = createECDH('prime256v1'); key.generateKeys();
const { subscribeToPush } = await loadModule('src/services/pushService.ts', backend, { VITE_VAPID_PUBLIC_KEY: key.getPublicKey().toString('base64url') });
const pending = subscribeToPush();
observations.permissionRequestedBeforeWorkerReady = permissionCalls > 0;
gesture = false; ready(registration);
observations.strictGestureSimulation = await pending;
if (!observations.permissionRequestedBeforeWorkerReady || !observations.strictGestureSimulation.ok) findings.push({ id: 'permission-gesture', severity: 'device-risk',
  evidence: 'requestPermission runs only after awaiting serviceWorker.ready. A slow first activation can outlive user activation; strict-gesture simulation fails. Physical Safari behavior untested.' });
dom.window.close();

const app = readFileSync('src/App.tsx', 'utf8');
observations.resyncCallSitesInApp = [...app.matchAll(/\bresyncSubscription\(/g)].length;
observations.authenticatedLifecycleHook = /return watchPushSubscriptionRecovery\(supabaseUserId\)/.test(app);
if (!observations.authenticatedLifecycleHook) findings.push({ id: 'rotation-on-launch', severity: 'recovery-gap',
  evidence: 'Authenticated lifecycle recovery is not wired into App. Behavioral resume/ownership/rotation assertions run in test:push-hardening.' });
observations.ownershipAndLifecycleBehaviorSuite = 'npm run test:push-hardening (must pass separately)';

console.log(JSON.stringify({ environment: 'offline real-source audit with simulated browser/auth boundaries; no physical iPhone or provider calls', observations, findings }, null, 2));
process.exitCode = findings.length ? 1 : 0;
