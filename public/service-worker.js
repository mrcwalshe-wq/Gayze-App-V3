/**
 * GAYZE — production service worker.
 *
 * Responsibilities:
 *   1. Install/activate lifecycle with a versioned cache.
 *   2. A deliberately narrow fetch strategy (see SAFETY below).
 *   3. Real Web Push: `push` -> persistent OS notification.
 *   4. `notificationclick` -> focus an existing Gayze window or open a new one,
 *      then route the SPA to the correct destination.
 *   5. `pushsubscriptionchange` -> tell the app to re-register the subscription.
 *
 * SAFETY — what this worker deliberately does NOT do:
 *   - It never intercepts cross-origin requests. Supabase REST/Realtime/Auth,
 *     Google Fonts, map tiles and the Supabase Storage CDN all go straight to
 *     the network, untouched and uncached.
 *   - It never caches a request that carries an Authorization header or
 *     cookies, and never caches a non-GET request.
 *   - It never caches HTML responses beyond a single offline fallback copy of
 *     the app shell, so no authenticated, user-specific payload is ever stored.
 *   - Only content-hashed build output and static brand assets are cached.
 */

const SW_VERSION = 'gayze-sw-v4';
const SHELL_CACHE = `${SW_VERSION}-shell`;
const ASSET_CACHE = `${SW_VERSION}-assets`;

/** The offline fallback document for SPA navigations. */
const APP_SHELL_URL = '/index.html';

/** Static, non-sensitive, safe-to-cache brand assets. */
const PRECACHE_URLS = [
  '/',
  '/manifest.webmanifest',
  '/apple-touch-icon.png',
  '/icons/gayze-192.png',
  '/icons/gayze-512.png',
];

const NOTIFICATION_ICON = '/icons/gayze-192.png';
const NOTIFICATION_BADGE = '/icons/gayze-192.png';

// ---------------------------------------------------------------------------
// Lifecycle
// ---------------------------------------------------------------------------

self.addEventListener('install', (event) => {
  event.waitUntil(
    (async () => {
      const cache = await caches.open(SHELL_CACHE);
      // Best-effort: a single missing asset must never fail the install.
      await Promise.allSettled(PRECACHE_URLS.map((url) => cache.add(new Request(url, { cache: 'reload' }))));
      await self.skipWaiting();
    })(),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      const keys = await caches.keys();
      await Promise.all(
        keys
          .filter((key) => key.startsWith('gayze-sw-') && !key.startsWith(SW_VERSION))
          .map((key) => caches.delete(key)),
      );
      if (self.registration.navigationPreload) {
        await self.registration.navigationPreload.enable();
      }
      await self.clients.claim();
    })(),
  );
});

self.addEventListener('message', (event) => {
  const data = event.data || {};
  if (data.type === 'SKIP_WAITING') {
    void self.skipWaiting();
    return;
  }
  if (data.type === 'SET_BADGE') {
    applyBadge(typeof data.count === 'number' ? data.count : 0);
  }
});

// ---------------------------------------------------------------------------
// Fetch — narrow, privacy-preserving caching
// ---------------------------------------------------------------------------

/** Build assets emitted by Vite are content-hashed and immutable. */
function isImmutableAsset(url) {
  return url.pathname.startsWith('/assets/');
}

/** Static brand assets that are safe to serve from cache. */
function isStaticBrandAsset(url) {
  return (
    url.pathname.startsWith('/icons/') ||
    url.pathname === '/apple-touch-icon.png' ||
    url.pathname === '/manifest.webmanifest' ||
    /\.(?:png|jpe?g|webp|svg|ico|woff2?)$/.test(url.pathname)
  );
}

/** A response we are willing to persist. */
function isCacheableResponse(response) {
  return Boolean(response) && response.status === 200 && response.type === 'basic';
}

self.addEventListener('fetch', (event) => {
  const { request } = event;

  // Never touch non-GET traffic (messages, intents, auth, uploads).
  if (request.method !== 'GET') return;

  // Never touch cross-origin traffic — Supabase, fonts, tiles, storage.
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  // Never cache anything that is explicitly authenticated.
  if (request.headers.has('Authorization')) return;

  // SPA navigations: network-first, fall back to the cached shell offline.
  if (request.mode === 'navigate') {
    event.respondWith(
      (async () => {
        try {
          const preloaded = await event.preloadResponse;
          if (preloaded) return preloaded;
          return await fetch(request);
        } catch {
          const cache = await caches.open(SHELL_CACHE);
          const cached = (await cache.match(APP_SHELL_URL)) || (await cache.match('/'));
          return (
            cached ||
            new Response('<h1>Gayze is offline</h1>', {
              status: 503,
              headers: { 'Content-Type': 'text/html; charset=utf-8' },
            })
          );
        }
      })(),
    );
    return;
  }

  // Content-hashed build output: cache-first (safe, immutable, non-personal).
  if (isImmutableAsset(url)) {
    event.respondWith(
      (async () => {
        const cache = await caches.open(ASSET_CACHE);
        const cached = await cache.match(request);
        if (cached) return cached;
        const response = await fetch(request);
        if (isCacheableResponse(response)) await cache.put(request, response.clone());
        return response;
      })(),
    );
    return;
  }

  // Static brand assets: stale-while-revalidate.
  if (isStaticBrandAsset(url)) {
    event.respondWith(
      (async () => {
        const cache = await caches.open(ASSET_CACHE);
        const cached = await cache.match(request);
        const network = fetch(request)
          .then((response) => {
            if (isCacheableResponse(response)) void cache.put(request, response.clone());
            return response;
          })
          .catch(() => undefined);
        return cached || (await network) || Response.error();
      })(),
    );
    return;
  }

  // Everything else same-origin (API-ish routes, anything dynamic): pass through.
});

// ---------------------------------------------------------------------------
// Badging
// ---------------------------------------------------------------------------

function applyBadge(count) {
  try {
    if (typeof count === 'number' && count > 0 && 'setAppBadge' in self.navigator) {
      void self.navigator.setAppBadge(count);
    } else if ('clearAppBadge' in self.navigator) {
      void self.navigator.clearAppBadge();
    }
  } catch {
    /* Badging is a progressive enhancement. */
  }
}

// ---------------------------------------------------------------------------
// Push
// ---------------------------------------------------------------------------

/** Notification copy per Gayze event type. All content is non-explicit. */
const DEFAULT_COPY = {
  gaze: { title: 'New Gayze', body: 'Someone sent you a Gayze.', url: '/notifications' },
  message: { title: 'New message', body: 'You have a new Gayze message.', url: '/messages' },
  intent: { title: 'Someone is interested', body: 'Someone responded to your intent.', url: '/right-now' },
  intent_expiring: { title: 'Your intent is ending soon', body: 'Your active intent expires shortly.', url: '/profile' },
  connection: { title: 'New connection', body: 'You have a new Gayze connection.', url: '/messages' },
  safety: { title: 'Safety alert', body: 'A Gayze safety event needs your attention.', url: '/profile' },
  test: { title: 'Gayze notifications are working', body: 'Your Gayze push notifications are now enabled.', url: '/profile' },
};

/**
 * Resolve a push payload URL to a safe same-origin path.
 * A payload can never make Gayze navigate off-origin (or to localhost in
 * production) — anything unexpected collapses to the app root.
 */
function safePath(rawUrl, fallback) {
  try {
    const resolved = new URL(rawUrl || fallback || '/', self.location.origin);
    if (resolved.origin !== self.location.origin) return fallback || '/';
    return `${resolved.pathname}${resolved.search}${resolved.hash}`;
  } catch {
    return fallback || '/';
  }
}

// Presentation receipts are NOT backend delivery claims. Always display a
// user-visible notification for every push event (Apple userVisibleOnly).
// A replay quietly replaces the SAME tagged record, without another toast.
// v2 deliberately does not trust the old receipt-before-display cache as proof.
let pushQueue = Promise.resolve();
const displayedInWorker = new Set();
const validId = (id) => typeof id === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id);
async function displayReceipt(id, write = false) {
  if (!validId(id)) return false;
  if (!write && displayedInWorker.has(id)) return true;
  if (write) {
    displayedInWorker.add(id);
    if (displayedInWorker.size > 2500) displayedInWorker.delete(displayedInWorker.values().next().value);
  }
  try {
    const cache = await caches.open('gayze-notification-receipts-v2');
    const key = new URL('/__notification_receipt__/' + id, self.location.origin).href;
    if (!write) return Boolean(await cache.match(key));
    await cache.put(key, new Response('displayed'));
    const keys = await cache.keys();
    if (keys.length > 2500) await Promise.all(keys.slice(0, keys.length - 2500).map((old) => cache.delete(old)));
  } catch { /* Storage failure never prevents user-visible push. */ }
  return false;
}

function notificationTarget(data) {
  if ((data.type === 'message' || data.type === 'connection') && validId(data.conversationId)) {
    const query = new URLSearchParams();
    if (validId(data.notificationId)) query.set('notification', data.notificationId);
    if (validId(data.recipientId)) query.set('recipient', data.recipientId);
    const params = query.toString();
    const suffix = params ? `?${params}` : '';
    return `/messages/${data.conversationId}${suffix}`;
  }
  return safePath(data.url, (DEFAULT_COPY[data.type] || DEFAULT_COPY.message).url);
}

// Web Push requires a visible notification (especially on iOS). Do not drop
// pushes merely because a window exists. A focused app can acknowledge the
// same stable message ID: keep ONE OS record, silent, and ONE foreground toast.
// Missing/old/unresponsive clients fall back to the normal audible OS alert.
async function presentInFocusedApp(data) {
  if (data.type !== 'message' || !data.messageId || !data.recipientId || typeof MessageChannel === 'undefined') return false;
  const windows = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
  const client = windows.find((window) => window.visibilityState === 'visible' && window.focused);
  if (!client) return false;
  return new Promise((resolve) => {
    const channel = new MessageChannel();
    const finish = (handled) => {
      clearTimeout(timer);
      channel.port1.close();
      resolve(handled);
    };
    const timer = setTimeout(() => finish(false), 400);
    channel.port1.onmessage = (event) => finish(event.data?.handled === true);
    try { client.postMessage({ source: 'gayze-sw', type: 'PRESENT_MESSAGE', payload: { ...data, presentationExpiresAt: Date.now() + 300 } }, [channel.port2]); }
    catch { channel.port2.close(); finish(false); }
  });
}

self.addEventListener('push', (event) => {
  event.waitUntil(
    (pushQueue = pushQueue.catch(() => {}).then(async () => {
      let payload = {};
      if (event.data) {
        try {
          payload = event.data.json();
        } catch {
          payload = { body: event.data.text() };
        }
      }

      let replay = await displayReceipt(payload.notificationId);
      const type = typeof payload.type === 'string' ? payload.type : 'message';
      const defaults = DEFAULT_COPY[type] || DEFAULT_COPY.message;

      const title = payload.title || defaults.title;
      const body = payload.body || defaults.body;
      const url = notificationTarget({ ...payload, type });

      // Stable server ID wins over an arbitrary changing payload tag.
      const tag = validId(payload.notificationId) ? `gayze-${payload.notificationId}`
        : payload.tag || `gayze-${type}-${payload.conversationId || payload.intentId || 'general'}`;
      try {
        replay ||= Boolean((await self.registration.getNotifications?.({ tag }))?.length);
      } catch { /* Best effort; still display. */ }

      const data = {
        type,
        notificationId: payload.notificationId || null,
        messageId: payload.messageId || null,
        recipientId: payload.recipientId || null,
        url,
        conversationId: payload.conversationId || null,
        intentId: payload.intentId || null,
        receivedAt: Date.now(),
      };

      let foregroundHandled = false;
      if (!replay) {
        try { foregroundHandled = await presentInFocusedApp(data); }
        catch { /* App handshake is optional; native display must still run. */ }
      }
      await self.registration.showNotification(title, {
        body,
        tag,
        data,
        icon: NOTIFICATION_ICON,
        badge: NOTIFICATION_BADGE,
        // Persist on the Lock Screen / Notification Centre until acted on.
        requireInteraction: type === 'safety',
        renotify: false,
        silent: replay || foregroundHandled,
        timestamp: Date.now(),
      });

      // Only successful display earns a receipt. Rejection leaves retry safe.
      await displayReceipt(payload.notificationId, true);

      if (typeof payload.badgeCount === 'number') applyBadge(payload.badgeCount);

      // Let any open Gayze window refresh its own unread state.
      const clientList = await self.clients.matchAll({ type: 'window', includeUncontrolled: true }).catch(() => []);
      for (const client of clientList) {
        try { client.postMessage({ source: 'gayze-sw', type: 'PUSH_RECEIVED', payload: data }); } catch { /* A stale app cannot invalidate display success. */ }
      }
    })),
  );
});

function bounded(work, ms) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('Client unavailable')), ms);
    Promise.resolve(work).then(value => { clearTimeout(timer); resolve(value); }, error => { clearTimeout(timer); reject(error); });
  });
}

async function routeInReadyApp(client, targetPath, data) {
  if (typeof MessageChannel === 'undefined') return false;
  return new Promise(resolve => {
    const channel = new MessageChannel();
    let finished = false;
    const finish = handled => {
      if (finished) return;
      finished = true; clearTimeout(timer); channel.port1.close(); channel.port2.close(); resolve(handled);
    };
    const timer = setTimeout(() => finish(false), 600);
    channel.port1.onmessage = event => finish(event.data?.handled === true);
    try { client.postMessage({ source: 'gayze-sw', type: 'NOTIFICATION_CLICK', url: targetPath,
      navigationExpiresAt: Date.now() + 600, data }, [channel.port2]); }
    catch { finish(false); }
  });
}

self.addEventListener('notificationclick', (event) => {
  const data = (event.notification && event.notification.data) || {};
  event.notification.close();
  const targetPath = notificationTarget(data);
  const targetUrl = new URL(targetPath, self.location.origin).href;
  event.waitUntil((async () => {
    let clients = [];
    try { clients = await bounded(self.clients.matchAll({ type: 'window', includeUncontrolled: true }), 800); }
    catch { /* Fall through to a cold launch. */ }
    clients = clients.filter(client => {
      try { return new URL(client.url).origin === self.location.origin; } catch { return false; }
    }).sort((a, b) => Number(Boolean(b.focused)) - Number(Boolean(a.focused)));
    // Bound retries so notification user activation isn't consumed by stale windows.
    for (const client of clients.slice(0, 2)) {
      try {
        await bounded(client.focus(), 800);
        if (await routeInReadyApp(client, targetPath, data)) return;
        // Old, suspended or not-yet-mounted SPA: carry the destination in the URL.
        if (client.navigate && await bounded(client.navigate(targetUrl), 800)) return;
      } catch { /* A failed focus/message/navigation never aborts the fallback. */ }
    }
    await self.clients.openWindow(targetUrl);
  })());
});

self.addEventListener('notificationclose', () => {
  /* No tracking on dismissal — intentionally a no-op. */
});

/**
 * Browsers can rotate a push subscription at any time. When that happens the
 * old endpoint is dead, so ask every open Gayze window to re-subscribe and
 * re-persist. If no window is open the app re-syncs on next launch.
 */
self.addEventListener('pushsubscriptionchange', (event) => {
  event.waitUntil(
    (async () => {
      const clientList = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
      for (const client of clientList) {
        client.postMessage({
          source: 'gayze-sw',
          type: 'PUSH_SUBSCRIPTION_CHANGED',
          oldEndpoint: event.oldSubscription ? event.oldSubscription.endpoint : null,
        });
      }
    })(),
  );
});
