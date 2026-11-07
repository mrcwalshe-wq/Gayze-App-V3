/**
 * GAYZE production service worker.
 * Web Push is always user-visible on iOS; no silent/invisible push path.
 */
const SW_VERSION = 'gayze-sw-v24-ios-icon-20261022';
const SHELL_CACHE = `${SW_VERSION}-shell`;
const ASSET_CACHE = `${SW_VERSION}-assets`;
const APP_SHELL_URL = '/index.html';
const ICON_VERSION = '?v=20261022-1';
const IOS_ICON = `/brand/gayze-nav-mark-v1.png${ICON_VERSION}`;
const PRECACHE_URLS = ['/', `/manifest.webmanifest${ICON_VERSION}`, IOS_ICON, `/brand/gayze-nav-v3.svg${ICON_VERSION}`, `/brand/gayze-app-icon-v3.svg${ICON_VERSION}`, `/icons/gayze-180.png${ICON_VERSION}`, `/icons/gayze-apple-touch-180.png${ICON_VERSION}`, `/icons/gayze-apple-touch-167.png${ICON_VERSION}`, `/icons/gayze-apple-touch-152.png${ICON_VERSION}`, `/icons/gayze-apple-touch-120.png${ICON_VERSION}`, `/icons/gayze-192.png${ICON_VERSION}`, `/icons/gayze-512.png${ICON_VERSION}`, `/icons/gayze-512-maskable.png${ICON_VERSION}`];
const NOTIFICATION_ICON = IOS_ICON;
const NOTIFICATION_BADGE = IOS_ICON;

self.addEventListener('install', (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(SHELL_CACHE);
    await Promise.allSettled(PRECACHE_URLS.map((url) => cache.add(new Request(url, { cache: 'reload' }))));
    await self.skipWaiting();
  })());
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter((key) => key.startsWith('gayze-sw-') && !key.startsWith(SW_VERSION)).map((key) => caches.delete(key)));
    if (self.registration.navigationPreload) await self.registration.navigationPreload.enable();
    await self.clients.claim();
  })());
});

self.addEventListener('message', (event) => {
  const data = event.data || {};
  if (data.type === 'SKIP_WAITING') void self.skipWaiting();
  if (data.type === 'SET_BADGE') applyBadge(typeof data.count === 'number' ? data.count : 0);
  // Which account is signed in on this device. Kept so a push meant for a different account is not shown here.
  if (data.type === 'ACTIVE_USER') event.waitUntil(rememberActiveUser(typeof data.userId === 'string' ? data.userId : null));
});

const ACCOUNT_CACHE = 'gayze-account';
const ACCOUNT_KEY = '/__gayze_active_user';
async function rememberActiveUser(userId) {
  try { await (await caches.open(ACCOUNT_CACHE)).put(ACCOUNT_KEY, new Response(JSON.stringify({ userId, at: Date.now() }))); } catch {}
}
/** undefined when this device has never said who is signed in (then nothing is suppressed). */
async function readActiveUser() {
  try {
    const hit = await (await caches.open(ACCOUNT_CACHE)).match(ACCOUNT_KEY);
    if (!hit) return undefined;
    const value = await hit.json();
    return typeof value.userId === 'string' || value.userId === null ? value.userId : undefined;
  } catch { return undefined; }
}

function isImmutableAsset(url) { return url.pathname.startsWith('/assets/'); }
function isStaticBrandAsset(url) {
  return url.pathname.startsWith('/icons/') || url.pathname.startsWith('/brand/') || url.pathname === '/apple-touch-icon.png' ||
    url.pathname === '/manifest.webmanifest' || /\.(?:png|jpe?g|webp|svg|ico|woff2?)$/.test(url.pathname);
}
function isCacheableResponse(response) { return Boolean(response) && response.status === 200 && response.type === 'basic'; }

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin || request.headers.has('Authorization')) return;
  if (request.mode === 'navigate') {
    event.respondWith((async () => {
      try { return (await event.preloadResponse) || await fetch(request); }
      catch {
        const cache = await caches.open(SHELL_CACHE);
        return (await cache.match(APP_SHELL_URL)) || (await cache.match('/')) ||
          new Response('<h1>Gayze is offline</h1>', { status: 503, headers: { 'Content-Type': 'text/html; charset=utf-8' } });
      }
    })());
    return;
  }
  if (isImmutableAsset(url)) {
    event.respondWith((async () => {
      const cache = await caches.open(ASSET_CACHE);
      const cached = await cache.match(request);
      if (cached) return cached;
      const response = await fetch(request);
      if (isCacheableResponse(response)) await cache.put(request, response.clone());
      return response;
    })());
    return;
  }
  if (isStaticBrandAsset(url)) {
    event.respondWith((async () => {
      const cache = await caches.open(ASSET_CACHE);
      const cached = await cache.match(request);
      const network = fetch(request).then((response) => {
        if (isCacheableResponse(response)) void cache.put(request, response.clone());
        return response;
      }).catch(() => undefined);
      return cached || (await network) || Response.error();
    })());
  }
});

function applyBadge(count) {
  try {
    if (count > 0 && 'setAppBadge' in self.navigator) void self.navigator.setAppBadge(count);
    else if ('clearAppBadge' in self.navigator) void self.navigator.clearAppBadge();
  } catch {}
}

const DEFAULT_COPY = {
  gaze: { title: 'New Gayze', body: 'Someone sent you a Gayze.', url: '/notifications' },
  interest: { title: 'Intent interest', body: 'Someone is interested in your intent.', url: '/right-now' },
  message: { title: 'New message', body: 'You have a new Gayze message.', url: '/messages' },
  intent: { title: 'Someone is interested', body: 'Someone responded to your intent.', url: '/right-now' },
  intent_expiring: { title: 'Your intent is ending soon', body: 'Your active intent expires shortly.', url: '/profile' },
  connection: { title: 'New connection', body: 'You have a new Gayze connection.', url: '/messages' },
  safety: { title: 'Safety alert', body: 'A Gayze safety event needs your attention.', url: '/profile' },
  test: { title: 'Gayze Test', body: 'Push notification test', url: '/notifications' },
};
function safePath(rawUrl, fallback) {
  try {
    const resolved = new URL(rawUrl || fallback || '/', self.location.origin);
    return resolved.origin === self.location.origin ? `${resolved.pathname}${resolved.search}${resolved.hash}` : (fallback || '/');
  } catch { return fallback || '/'; }
}
const validId = (id) => typeof id === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id);
function notificationTarget(data) {
  // Gayze lock-screen notifications must deep-link to the existing chat too.
  // The push sender resolves the shared conversation before sending the payload.
  if ((data.type === 'message' || data.type === 'connection' || data.type === 'gaze' || data.type === 'call' || data.type === 'missed_call') && validId(data.conversationId)) {
    // The recipient travels in the click message, not the URL, so the address stays short and stable.
    return validId(data.notificationId)
      ? `/messages/${data.conversationId}?notification=${data.notificationId}`
      : `/messages/${data.conversationId}`;
  }
  return safePath(data.url, (DEFAULT_COPY[data.type] || DEFAULT_COPY.message).url);
}
function pushDiagnostic(stage, details = {}) {
  try { console.info('[GAYZE push diagnostic]', stage, details); } catch {}
}
function diagnosticErrorName(error) { return String(error?.name || 'UnknownError').slice(0, 64); }

self.addEventListener('push', (event) => {
  pushDiagnostic('push-received', { hasData: Boolean(event.data) });
  const work = (async () => {
    let stage = 'payload-parse';
    try {
      let payload = {};
      let format = 'empty';
      if (event.data) {
        try { payload = event.data.json(); format = 'json'; }
        catch { payload = { body: event.data.text() }; format = 'text-fallback'; }
      }
      const type = typeof payload.type === 'string' ? payload.type : 'message';
      // A push addressed to another account (a stale registration for a previous sign-in on this phone) is not shown here.
      const activeUser = await readActiveUser();
      if (validId(payload.recipientId) && activeUser !== undefined && activeUser !== payload.recipientId) {
        pushDiagnostic('wrong-account-suppressed');
        return;
      }
      const defaults = DEFAULT_COPY[type] || DEFAULT_COPY.message;
      pushDiagnostic('payload-parsed', { format, hasTitle: typeof payload.title === 'string', hasBody: typeof payload.body === 'string' });
      const title = payload.title || defaults.title;
      const body = payload.body || defaults.body;
      const tag = validId(payload.notificationId) ? `gayze-${payload.notificationId}` : (payload.tag || `gayze-${type}-${payload.conversationId || 'general'}`);
      const data = {
        type,
        notificationId: payload.notificationId || null,
        messageId: payload.messageId || null,
        recipientId: payload.recipientId || null,
        conversationId: payload.conversationId || null,
        intentId: payload.intentId || null,
        url: notificationTarget({ ...payload, type }),
        receivedAt: Date.now(),
      };
      stage = 'showNotification';
      pushDiagnostic('showNotification-called');
      await self.registration.showNotification(title, {
        body,
        tag,
        data,
        icon: NOTIFICATION_ICON,
        badge: NOTIFICATION_BADGE,
        silent: false,
        renotify: true,
        requireInteraction: type === 'safety',
        timestamp: Date.now(),
      });
      pushDiagnostic('showNotification-resolved');
      applyBadge(typeof payload.badgeCount === 'number' ? payload.badgeCount : 0);
      const clients = await self.clients.matchAll({ type: 'window', includeUncontrolled: true }).catch(() => []);
      for (const client of clients) {
        try { client.postMessage({ source: 'gayze-sw', type: 'PUSH_RECEIVED', payload: data }); } catch {}
      }
    } catch (error) {
      const stageName = stage === 'showNotification' ? 'showNotification-rejected' : 'push-processing-rejected';
      pushDiagnostic(stageName, { stage, errorName: diagnosticErrorName(error) });
      throw error;
    }
  })();
  event.waitUntil(work);
});

// Carry the notification's own id on a tap so the app can open exactly what it is about, whatever the stored URL says.
function withNotificationId(path, id) {
  if (!validId(id) || /[?&]notification=/.test(path)) return path;
  const hashAt = path.indexOf('#');
  const base = hashAt >= 0 ? path.slice(0, hashAt) : path, hash = hashAt >= 0 ? path.slice(hashAt) : '';
  return `${base}${base.includes('?') ? '&' : '?'}notification=${id}${hash}`;
}

const CLICK_STEP_MS = 1500;
// A phone waking the app can take a few seconds before it answers. Reloading a window that is merely slow kills a call being
// answered at that moment, so the answer gets longer, and a visible window is never reloaded.
const CLICK_ACK_MS = 6000;
const withTimeout = (promise, ms, fallback) => new Promise((resolve) => {
  const timer = setTimeout(() => resolve(fallback), ms);
  Promise.resolve(promise).then((v) => { clearTimeout(timer); resolve(v); }, () => { clearTimeout(timer); resolve(fallback); });
});

// A tap goes to the right place in the already-open app (no reload, session kept). If no app answers in time it falls back
// to navigating that window, and finally to opening a new one. Every step is bounded so a dead window can never swallow the tap.
self.addEventListener('notificationclick', (event) => {
  const data = event.notification?.data || {};
  event.notification.close();
  const targetPath = withNotificationId(notificationTarget(data), data.notificationId);
  const targetUrl = new URL(targetPath, self.location.origin).href;
  event.waitUntil((async () => {
    const clients = await withTimeout(self.clients.matchAll({ type: 'window', includeUncontrolled: true }), CLICK_STEP_MS, []);
    const sameOrigin = (clients || []).filter((client) => { try { return new URL(client.url).origin === self.location.origin; } catch { return false; } });
    const app = sameOrigin.find((client) => client.focused) || sameOrigin[0];
    if (app) {
      const focused = await withTimeout((async () => { await app.focus(); return true; })(), CLICK_STEP_MS, false);
      if (focused) {
        const handled = await withTimeout(new Promise((resolve) => {
          const channel = new MessageChannel();
          channel.port1.onmessage = (e) => resolve(Boolean(e.data && e.data.handled));
          try {
            app.postMessage({ source: 'gayze-sw', type: 'NOTIFICATION_CLICK', url: targetPath, navigationExpiresAt: Date.now() + 60000, data: { recipientId: validId(data.recipientId) ? data.recipientId : null } }, [channel.port2]);
          } catch { resolve(false); }
        }), CLICK_ACK_MS, false);
        if (handled) return;
        if (app.visibilityState === 'visible') return;
        if (app.navigate) {
          const navigated = await withTimeout((async () => { await app.navigate(targetUrl); return true; })(), CLICK_STEP_MS, false);
          if (navigated) return;
        }
      }
    }
    await self.clients.openWindow(targetUrl);
  })());
});

self.addEventListener('notificationclose', () => {});
self.addEventListener('pushsubscriptionchange', (event) => {
  event.waitUntil((async () => {
    const clients = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    for (const client of clients) {
      try { client.postMessage({ source: 'gayze-sw', type: 'PUSH_SUBSCRIPTION_CHANGED' }); } catch {}
    }
  })());
});
