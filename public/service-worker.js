/**
 * GAYZE production service worker.
 * Web Push is always user-visible on iOS; no silent/invisible push path.
 */
const SW_VERSION = 'gayze-sw-v15-brand';
const SHELL_CACHE = `${SW_VERSION}-shell`;
const ASSET_CACHE = `${SW_VERSION}-assets`;
const APP_SHELL_URL = '/index.html';
const ICON_VERSION = '?v=20261008-brand4';
const IOS_ICON = `/icons/gayze-180.png${ICON_VERSION}`;
const PRECACHE_URLS = ['/', '/manifest.webmanifest', IOS_ICON, `/icons/gayze-192.png${ICON_VERSION}`, `/icons/gayze-512.png${ICON_VERSION}`, `/brand/gayze-nav-v3.svg${ICON_VERSION}`];
const NOTIFICATION_ICON = '/icons/gayze-192.png';
const NOTIFICATION_BADGE = '/icons/gayze-180.png';

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
});

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
  if ((data.type === 'message' || data.type === 'connection') && validId(data.conversationId)) {
    return `/messages/${data.conversationId}${validId(data.notificationId) ? `?notification=${data.notificationId}` : ''}`;
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

self.addEventListener('notificationclick', (event) => {
  const data = event.notification?.data || {};
  event.notification.close();
  const targetPath = notificationTarget(data);
  const targetUrl = new URL(targetPath, self.location.origin).href;
  event.waitUntil((async () => {
    const clients = await self.clients.matchAll({ type: 'window', includeUncontrolled: true }).catch(() => []);
    const sameOrigin = clients.filter((client) => { try { return new URL(client.url).origin === self.location.origin; } catch { return false; } });
    const focused = sameOrigin.find((client) => client.focused) || sameOrigin[0];
    if (focused) {
      try { await focused.focus(); } catch {}
      try { if (focused.navigate) { await focused.navigate(targetUrl); return; } } catch {}
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
