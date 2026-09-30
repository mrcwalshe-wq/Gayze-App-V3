/* eslint-disable no-restricted-globals */
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

const SW_VERSION = 'gayze-sw-v2';
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

self.addEventListener('push', (event) => {
  event.waitUntil(
    (async () => {
      let payload = {};
      if (event.data) {
        try {
          payload = event.data.json();
        } catch {
          payload = { body: event.data.text() };
        }
      }

      const type = typeof payload.type === 'string' ? payload.type : 'message';
      const defaults = DEFAULT_COPY[type] || DEFAULT_COPY.message;

      const title = payload.title || defaults.title;
      const body = payload.body || defaults.body;
      const url = safePath(payload.url, defaults.url);

      // One notification per conversation/intent replaces the previous one
      // instead of stacking — this is the "do not spam" guarantee on-device.
      const tag = payload.tag || `gayze-${type}-${payload.conversationId || payload.intentId || 'general'}`;

      const data = {
        type,
        url,
        conversationId: payload.conversationId || null,
        intentId: payload.intentId || null,
        receivedAt: Date.now(),
      };

      await self.registration.showNotification(title, {
        body,
        tag,
        data,
        icon: NOTIFICATION_ICON,
        badge: NOTIFICATION_BADGE,
        // Persist on the Lock Screen / Notification Centre until acted on.
        requireInteraction: type === 'safety',
        renotify: Boolean(payload.renotify),
        silent: false,
        timestamp: Date.now(),
      });

      if (typeof payload.badgeCount === 'number') applyBadge(payload.badgeCount);

      // Let any open Gayze window refresh its own unread state.
      const clientList = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
      for (const client of clientList) {
        client.postMessage({ source: 'gayze-sw', type: 'PUSH_RECEIVED', payload: data });
      }
    })(),
  );
});

self.addEventListener('notificationclick', (event) => {
  const data = (event.notification && event.notification.data) || {};
  // Fall back to THIS event type's destination (same rule as the push handler),
  // so a message notification with a corrupt/absent URL still opens Messages.
  const defaults = DEFAULT_COPY[data.type] || DEFAULT_COPY.message;
  const targetPath = safePath(data.url, defaults.url);
  event.notification.close();

  event.waitUntil(
    (async () => {
      const clientList = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });

      // Prefer an already-open Gayze window: focus it and route in-place so the
      // authenticated SPA session is preserved (no reload, no re-auth).
      for (const client of clientList) {
        if (new URL(client.url).origin !== self.location.origin) continue;
        await client.focus();
        client.postMessage({ source: 'gayze-sw', type: 'NOTIFICATION_CLICK', url: targetPath, data });
        return;
      }

      // Otherwise open a new window on this worker's own origin. Because the
      // worker is served from https://gayze.co.uk in production, this can never
      // resolve to localhost.
      await self.clients.openWindow(new URL(targetPath, self.location.origin).toString());
    })(),
  );
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
