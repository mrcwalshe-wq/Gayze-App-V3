import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createECDH, randomBytes } from 'node:crypto';
import { JSDOM } from 'jsdom';
import { loadModule } from '../recovery-tests/load-module.mjs';
const A = '10000000-0000-4000-8000-000000000001', B = '10000000-0000-4000-8000-000000000002';
const markerKey = 'gayze_push_enrollment_v1';
const flush = async () => { for (let i = 0; i < 100; i++) await Promise.resolve(); };
async function until(condition) { for (let i = 0; i < 100; i++) { await flush(); if (condition()) return; await new Promise(r => setTimeout(r, 2)); } assert.fail('condition timed out'); }
async function fixture({ permission = 'granted', delayReady = false, vapid } = {}) {
  const dom = new JSDOM('<!doctype html><html></html>', { url: 'https://gayze.co.uk/', pretendToBeVisual: true });
  globalThis.window = dom.window; globalThis.document = dom.window.document;
  Object.defineProperty(globalThis, 'navigator', { configurable: true, value: dom.window.navigator });
  Object.defineProperty(navigator, 'standalone', { configurable: true, value: true });
  Object.defineProperty(navigator, 'userAgent', { configurable: true, value: 'iPhone Safari' });
  const key = createECDH('prime256v1'); key.generateKeys(); const publicKey = key.getPublicKey().toString('base64url');
  const rows = new Map(), calls = [], authListeners = new Set(); let rowNo = 0, releaseReady, sharedLock = Promise.resolve();
  const state = { user: A, current: null, permissionCalls: 0, subscribeCalls: 0, registerCalls: 0, revoked: [], lockCalls: 0,
    heldRead: null, readError: false, writeError: false, deleteError: false, pushEnabled: true, heldSubscribe: null, heldRegistration: null, getRegistrationCalls: 0, browserError: null, permissionResult: 'granted', gesture: true };
  const subscription = (label = 'subscription') => {
    const receiver = createECDH('prime256v1'); receiver.generateKeys(); const auth = randomBytes(16), raw = receiver.getPublicKey();
    const sub = { endpoint: `https://web.push.apple.com/${label}`, options: { applicationServerKey: Uint8Array.from(key.getPublicKey()).buffer },
      getKey(name) { return Uint8Array.from(name === 'p256dh' ? raw : auth).buffer; },
      async unsubscribe() { state.revoked.push(sub.endpoint); if (state.current === sub) state.current = null; return true; } };
    return sub;
  };
  const seed = (sub, user = A) => {
    const row = { id: `row-${++rowNo}`, user_id: user, endpoint: sub.endpoint,
      p256dh: Buffer.from(sub.getKey('p256dh')).toString('base64url'), auth: Buffer.from(sub.getKey('auth')).toString('base64url') };
    rows.set(row.id, row); return row;
  };
  const registration = { pushManager: { async getSubscription() { return state.current; }, async subscribe() {
    state.subscribeCalls++; calls.push('subscribe'); if (state.browserError) throw state.browserError;
    const sub = subscription('new-' + state.subscribeCalls); state.current = sub;
    await state.heldSubscribe; return sub;
  } } };
  const ready = delayReady ? new Promise(r => { releaseReady = r; }) : Promise.resolve(registration);
  Object.defineProperty(navigator, 'serviceWorker', { configurable: true, value: {
    async register() { state.registerCalls++; return registration; }, ready,
    async getRegistration() { state.getRegistrationCalls++; await state.heldRegistration; return registration; },
  } });
  Object.defineProperty(navigator, 'locks', { configurable: true, value: { async request(name, fn) { assert.equal(name, 'gayze-push-registration'); state.lockCalls++; const work = sharedLock.catch(() => {}).then(fn); sharedLock = work.catch(() => {}); return work; } } });
  window.PushManager = class {};
  window.Notification = globalThis.Notification = { permission, async requestPermission() {
    state.permissionCalls++; calls.push('permission'); assert(state.gesture, 'permission requested outside direct action');
    window.Notification.permission = state.permissionResult; return state.permissionResult;
  } };
  const db = { auth: { async getSession() { return { data: { session: state.user ? { user: { id: state.user } } : null }, error: null }; },
    onAuthStateChange(fn) { authListeners.add(fn); return { data: { subscription: { unsubscribe() { authListeners.delete(fn); } } } }; },
  }, from(table) {
    const filters = {}; let deleting = false;
    const q = { select() { return q; }, eq(k, v) { filters[k] = v; return q; }, delete() { deleting = true; return q; },
      async maybeSingle() {
        calls.push('read');
        const data = table === 'notification_preferences' ? { push_enabled: state.pushEnabled }
          : [...rows.values()].find(r => r.user_id === state.user && Object.entries(filters).every(([k, v]) => r[k] === v)) ?? null;
        await state.heldRead; return { data, error: state.readError ? { message: 'offline' } : null };
      },
      async upsert(value) {
        calls.push('upsert');
        if (state.writeError || value.user_id !== state.user) return { error: { message: 'write rejected' } };
        const exists = [...rows.values()].find(r => r.endpoint === value.endpoint);
        if (exists && exists.user_id !== state.user) return { error: { message: 'RLS owner conflict' } };
        const row = { ...value, id: exists?.id ?? `row-${++rowNo}` }; rows.set(row.id, row); return { error: null };
      },
      then(resolve, reject) {
        assert(deleting); calls.push('delete');
        if (state.deleteError) return Promise.resolve({ error: { message: 'cleanup offline' } }).then(resolve, reject);
        for (const [id, r] of rows) if (r.user_id === state.user && Object.entries(filters).every(([k, v]) => r[k] === v)) rows.delete(id);
        return Promise.resolve({ error: null }).then(resolve, reject);
      },
    }; return q;
  } };
  const service = await loadModule('src/services/pushService.ts', db, { VITE_VAPID_PUBLIC_KEY: vapid ?? publicKey });
  return { service, state, rows, calls, subscription, seed, registration, dom,
    releaseReady: () => releaseReady?.(registration),
    marker: () => JSON.parse(window.localStorage.getItem(markerKey) || 'null'),
    setMarker(row, userId = A) { window.localStorage.setItem(markerKey, JSON.stringify({ userId, rowId: row.id })); },
    auth(event, userId) { state.user = userId; for (const fn of authListeners) fn(event, userId ? { user: { id: userId } } : null); },
    newTab: () => loadModule('src/services/pushService.ts', db, { VITE_VAPID_PUBLIC_KEY: publicKey }),
    close() { dom.window.close(); },
  };
}

test('permission precedes every await; slow worker gates subscribe/persist; parallel Enable is one flight', async () => {
  const f = await fixture({ permission: 'default', delayReady: true });
  try {
    const p = f.service.subscribeToPush(A), again = f.service.subscribeToPush(A); assert.equal(p, again);
    assert.equal(f.state.permissionCalls, 1); f.state.gesture = false;
    await until(() => f.state.registerCalls === 1); assert.equal(f.state.subscribeCalls, 0); assert.equal(f.rows.size, 0);
    f.releaseReady(); assert.equal((await p).ok, true); assert.equal((await again).ok, true);
    assert.equal(f.state.subscribeCalls, 1); assert.equal(f.rows.size, 1); assert(f.marker().rowId);
    assert.deepEqual(Object.keys(f.marker()).sort(), ['rowId', 'userId']);
    assert.equal((await f.service.subscribeToPush(A)).ok, true); assert.equal(f.state.permissionCalls, 1); assert.equal(f.state.subscribeCalls, 1);
  } finally { f.close(); }
});

test('granted permission is never re-asked; denied or malformed VAPID does not register/subscribe', async () => {
  for (const options of [{}, { permission: 'denied' }, { permission: 'default', vapid: 'invalid' }]) {
    const f = await fixture(options);
    try { const result = await f.service.subscribeToPush(A); assert.equal(f.state.permissionCalls, 0);
      assert.equal(result.ok, !Object.keys(options).length); if (!result.ok) assert.equal(f.state.subscribeCalls, 0);
    } finally { f.close(); }
  }
});

test('healthy authenticated recovery adopts owned legacy registration and is a persistence no-op', async () => {
  const f = await fixture();
  try {
    f.state.current = f.subscription(); const row = f.seed(f.state.current);
    assert.equal(await f.service.resyncSubscription(null, A), 'ready');
    assert.equal(f.marker().rowId, row.id); assert.equal(f.state.subscribeCalls, 0); assert.equal(f.state.permissionCalls, 0);
    assert(!f.calls.includes('upsert'));
  } finally { f.close(); }
});

test('missed rotation reconciles new current endpoint before removing only the old owned row', async () => {
  const f = await fixture();
  try {
    const old = f.subscription('old'), oldRow = f.seed(old); f.setMarker(oldRow);
    const other = f.seed(f.subscription('other-device'), B); f.state.current = f.subscription('rotated');
    assert.equal(await f.service.resyncSubscription(null, A), 'ready');
    assert(!f.rows.has(oldRow.id)); assert(f.rows.has(other.id)); assert.equal(f.rows.size, 2);
    assert.equal([...f.rows.values()].find(r => r.user_id === A).endpoint, f.state.current.endpoint);
    assert(f.calls.indexOf('upsert') < f.calls.indexOf('delete')); assert.equal(f.state.subscribeCalls, 0);
    await f.service.resyncSubscription(null, A); assert.equal(f.calls.filter(c => c === 'upsert').length, 1);
  } finally { f.close(); }
});

test('launch/resume owner coalesces events, repairs rotation and removes lifecycle listeners on stop', async () => {
  const f = await fixture(); let stop;
  try {
    f.state.current = f.subscription('old'); f.seed(f.state.current); const states = [];
    stop = f.service.watchPushSubscriptionRecovery(A, state => states.push(state)); await until(() => states.includes('ready'));
    f.state.current = f.subscription('rotated');
    for (const name of ['pageshow', 'focus', 'online']) window.dispatchEvent(new window.Event(name));
    document.dispatchEvent(new window.Event('visibilitychange'));
    await until(() => [...f.rows.values()].some(r => r.endpoint.endsWith('/rotated')));
    await until(() => states.length >= 2); await flush();
    assert.equal(f.rows.size, 1); assert.equal(f.state.subscribeCalls, 0); assert.equal(f.calls.filter(c => c === 'upsert').length, 1);
    stop(); await flush(); const count = f.calls.length;
    window.dispatchEvent(new window.Event('pageshow')); document.dispatchEvent(new window.Event('visibilitychange')); await flush(); assert.equal(f.calls.length, count);
  } finally { stop?.(); f.close(); }
});

test('unowned current endpoint, forged other-owner pointer and pruned old row require explicit enable', async () => {
  for (const variant of ['no-proof', 'other-owner', 'pruned']) {
    const f = await fixture();
    try {
      f.state.current = f.subscription('unknown'); f.seed(f.state.current, B);
      if (variant !== 'no-proof') {
        const prior = f.seed(f.subscription('old'), variant === 'other-owner' ? B : A); f.setMarker(prior);
        if (variant === 'pruned') f.rows.delete(prior.id);
      }
      assert.equal(await f.service.resyncSubscription(null, A), 'needs-enable');
      assert.equal(f.state.subscribeCalls, 0); assert.equal(f.state.revoked.length, 0); assert(!f.calls.includes('upsert'));
      assert.equal(f.state.permissionCalls, 0);
    } finally { f.close(); }
  }
});

test('missing browser subscription is recreated once only with proven owner opt-in and enabled preferences', async () => {
  for (const enabled of [true, false]) {
    const f = await fixture();
    try {
      const old = f.seed(f.subscription('expired')); f.setMarker(old); f.state.pushEnabled = enabled;
      const results = await Promise.all([f.service.resyncSubscription(null, A), f.service.resyncSubscription(null, A)]);
      assert(results.every(r => r === (enabled ? 'ready' : 'needs-enable')));
      assert.equal(f.state.subscribeCalls, enabled ? 1 : 0); assert.equal(f.state.permissionCalls, 0); assert.equal(f.rows.size, 1);
    } finally { f.close(); }
  }
});

test('read outage never revokes existing subscription or treats it as another owner', async () => {
  const f = await fixture();
  try {
    f.state.current = f.subscription(); f.seed(f.state.current); f.state.readError = true;
    assert.equal((await f.service.subscribeToPush(A)).ok, false); assert.equal(await f.service.resyncSubscription(null, A), 'unavailable');
    assert.equal(f.state.revoked.length, 0); assert.equal(f.state.subscribeCalls, 0);
  } finally { f.close(); }
});

test('failed rotation persistence keeps prior ownership evidence; next resume repairs without a new subscription', async () => {
  const f = await fixture();
  try {
    const old = f.seed(f.subscription('old')); f.setMarker(old); f.state.current = f.subscription('rotated'); f.state.writeError = true;
    assert.equal(await f.service.resyncSubscription(null, A), 'unavailable'); assert(f.rows.has(old.id)); assert.equal(f.marker().rowId, old.id);
    f.state.writeError = false; assert.equal(await f.service.resyncSubscription(null, A), 'ready');
    assert.equal(f.rows.size, 1); assert(!f.rows.has(old.id)); assert.equal(f.state.subscribeCalls, 0);
  } finally { f.close(); }
});

test('failed explicit enrollment revokes newly created unpersisted subscription', async () => {
  const f = await fixture();
  try { f.state.writeError = true; assert.equal((await f.service.subscribeToPush(A)).ok, false);
    assert.equal(f.state.revoked.length, 1); assert.equal(f.state.current, null); assert.equal(f.rows.size, 0);
  } finally { f.close(); }
});

test('account changes during browser subscribe cannot persist into the next account', async () => {
  const f = await fixture(); let release;
  try {
    f.state.heldSubscribe = new Promise(r => { release = r; }); const old = f.service.subscribeToPush(A);
    await until(() => f.state.subscribeCalls === 1); f.auth('SIGNED_IN', B); f.state.heldSubscribe = null; release();
    assert.equal((await old).ok, false); assert.equal(f.rows.size, 0); assert.equal(f.state.revoked.length, 1);
    assert.equal((await f.service.subscribeToPush(B)).ok, true); assert.equal([...f.rows.values()][0].user_id, B);
  } finally { release?.(); f.close(); }
});

test('same-account sign-out/sign-in invalidates old recovery generation; stopped owners cannot mutate', async () => {
  for (const mode of ['account', 'stop']) {
    const f = await fixture(); let release, alive = true;
    try {
      const old = f.seed(f.subscription('old')); f.setMarker(old); f.state.current = f.subscription('rotated');
      f.state.heldRead = new Promise(r => { release = r; }); const pending = f.service.resyncSubscription(null, A, () => alive);
      await until(() => f.calls.includes('read'));
      if (mode === 'account') { f.auth('SIGNED_OUT', null); f.auth('SIGNED_IN', A); } else alive = false;
      f.state.heldRead = null; release(); assert.equal(await pending, 'cancelled'); assert(!f.calls.includes('upsert'));
    } finally { release?.(); f.close(); }
  }
});

test('VAPID change needs explicit user action; recovery never silently rotates key enrollment', async () => {
  const f = await fixture();
  try {
    f.state.current = f.subscription('old-key'); f.seed(f.state.current);
    f.state.current.options.applicationServerKey = new Uint8Array(65).buffer;
    assert.equal(await f.service.resyncSubscription(null, A), 'needs-enable'); assert.equal(f.state.revoked.length, 0);
    assert.equal((await f.service.subscribeToPush(A)).ok, true); assert.equal(f.state.revoked.length, 1); assert.equal(f.rows.size, 1);
  } finally { f.close(); }
});

test('explicit enable resets a different account endpoint rather than claiming its row', async () => {
  const f = await fixture();
  try {
    f.state.current = f.subscription('belongs-to-B'); const b = f.seed(f.state.current, B);
    assert.equal((await f.service.subscribeToPush(A)).ok, true); assert(f.rows.has(b.id));
    assert.equal(f.rows.get(b.id).user_id, B); assert.equal(f.state.revoked.length, 1);
    assert.equal([...f.rows.values()].filter(r => r.user_id === A).length, 1);
  } finally { f.close(); }
});


test('interrupted cleanup preserves old pointer and successful replacement; retry does not create another endpoint', async () => {
  for (const mode of ['recovery', 'explicit']) {
    const f = await fixture();
    try {
      const old = f.seed(f.subscription('old')); f.setMarker(old); f.state.deleteError = true;
      const run = () => mode === 'recovery' ? f.service.resyncSubscription(null, A) : f.service.subscribeToPush(A);
      const first = await run(); assert.equal(mode === 'recovery' ? first : first.ok, mode === 'recovery' ? 'unavailable' : false);
      assert.equal(f.rows.size, 2); assert.equal(f.marker().rowId, old.id); assert.equal(f.state.subscribeCalls, 1); assert.equal(f.state.revoked.length, 0);
      f.state.deleteError = false; const retry = await run(); assert.equal(mode === 'recovery' ? retry : retry.ok, mode === 'recovery' ? 'ready' : true);
      assert.equal(f.rows.size, 1); assert(!f.rows.has(old.id)); assert.equal(f.state.subscribeCalls, 1); assert.notEqual(f.marker().rowId, old.id);
    } finally { f.close(); }
  }
});

test('opt-out and sign-out remove the current endpoint and prevent automatic re-enrollment', async () => {
  for (const mode of ['disable', 'sign-out', 'interrupted-sign-out']) {
    const f = await fixture();
    try {
      assert.equal((await f.service.subscribeToPush(A)).ok, true);
      if (mode === 'disable') assert.equal(await f.service.unsubscribeFromPush(A), true);
      else if (mode === 'sign-out') await f.service.releasePushOnSignOut();
      else {
        window.localStorage.setItem('gayze_push_pending_revoke', '1');
        assert.equal(await f.service.resyncSubscription(null, A), 'needs-enable');
        await f.service.finishPendingPushRevoke();
      }
      assert.equal(f.state.current, null); assert.equal(f.marker(), null);
      assert.equal(await f.service.resyncSubscription(null, A), 'needs-enable'); assert.equal(f.state.subscribeCalls, 1);
    } finally { f.close(); }
  }
});

test('stale Disable cannot revoke the next account subscription', async () => {
  const f = await fixture();
  try {
    f.auth('SIGNED_IN', B); f.state.current = f.subscription('belongs-to-B'); f.seed(f.state.current, B);
    assert.equal(await f.service.unsubscribeFromPush(A), false); assert.equal(f.state.revoked.length, 0);
  } finally { f.close(); }
});

test('slow first activation times out without subscribing or persisting; a ready retry does not re-prompt', async () => {
  const f = await fixture({ permission: 'default', delayReady: true });
  try {
    const timeout = window.setTimeout.bind(window); window.setTimeout = (fn, delay, ...args) => timeout(fn, delay === 10000 ? 5 : delay, ...args);
    assert.equal((await f.service.subscribeToPush(A)).ok, false); assert.equal(f.state.subscribeCalls, 0); assert.equal(f.rows.size, 0);
    f.releaseReady(); assert.equal((await f.service.subscribeToPush(A)).ok, true); assert.equal(f.state.permissionCalls, 1);
  } finally { f.releaseReady(); f.close(); }
});

test('permission refusal is handled without any PushManager or backend mutation', async () => {
  const f = await fixture({ permission: 'default' });
  try {
    f.state.permissionResult = 'denied'; assert.equal((await f.service.subscribeToPush(A)).ok, false);
    assert.equal(f.state.permissionCalls, 1); assert.equal(f.state.subscribeCalls, 0); assert.equal(f.state.registerCalls, 0); assert.equal(f.rows.size, 0);
    assert.equal((await f.service.subscribeToPush(A)).ok, false); assert.equal(f.state.permissionCalls, 1);
  } finally { f.close(); }
});


test('App auth listener may start revoke before the push auth listener observes SIGNED_OUT', async () => {
  const f = await fixture();
  try {
    assert.equal((await f.service.subscribeToPush(A)).ok, true);
    const pending = f.service.revokeLocalPushSubscription(); f.auth('SIGNED_OUT', null); await pending;
    assert.equal(f.state.current, null); assert.equal(f.state.revoked.length, 1); assert.equal(f.marker(), null);
  } finally { f.close(); }
});


test('two independently loaded tabs use the shared lock to repair missing registration only once', async () => {
  const f = await fixture();
  try {
    const old = f.seed(f.subscription('old')); f.setMarker(old); const tab = await f.newTab();
    assert.deepEqual(await Promise.all([f.service.resyncSubscription(null, A), tab.resyncSubscription(null, A)]), ['ready', 'ready']);
    assert.equal(f.state.subscribeCalls, 1); assert.equal(f.rows.size, 1); assert.equal(f.state.lockCalls, 2);
  } finally { f.close(); }
});

test('late sign-out cleanup cannot revoke a newly signed-in account registration', async () => {
  const f = await fixture(); let release;
  try {
    assert.equal((await f.service.subscribeToPush(A)).ok, true);
    f.state.heldRegistration = new Promise(r => { release = r; }); const pending = f.service.releasePushOnSignOut();
    await until(() => f.state.getRegistrationCalls > 0);
    f.auth('SIGNED_IN', B); f.state.current = f.subscription('B-registration'); f.seed(f.state.current, B);
    f.state.heldRegistration = null; release(); await pending;
    assert.equal(f.state.revoked.length, 0); assert.equal(f.state.current.endpoint, 'https://web.push.apple.com/B-registration');
  } finally { release?.(); f.close(); }
});
