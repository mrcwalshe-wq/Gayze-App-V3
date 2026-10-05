/**
 * GAYZE production service worker.
 * Web Push is always user-visible on iOS; no silent/invisible push path.
 */
const SW_VERSION = 'gayze-sw-v7';
const SHELL_CACHE = `${SW_VERSION}-shell`;
const ASSET_CACHE = `${SW_VERSION}-assets`;
const APP_SHELL_URL = '/index.html';
const PRECACHE_URLS = ['/', '/manifest.webmanifest', '/apple-touch-icon.png', '/icons/gayze-180.png', '/icons/gayze-192.png', '/icons/gayze-512.png', '/icons/gayze-512-maskable.png'];
const NOTIFICATION_ICON = '/icons/gayze-192.png';
const NOTIFICATION_BADGE = '/icons/gayze-192.png';

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

self.addEventListener('fetch', (event) => {
  if (event.request.method !== 'GET') return;
  const url = new URL(event.request.url);
  if (url.origin !== self.location.origin) return;
  event.respondWith((async () => {
    const cached = await caches.match(event.request);
    if (cached) return cached;
    try {
      const response = await fetch(event.request);
      if (response.ok && (event.request.destination === 'script' || event.request.destination === 'style' || event.request.destination === 'image' || event.request.destination === 'font')) {
        const cache = await caches.open(ASSET_CACHE);
        cache.put(event.request, response.clone());
      }
      return response;
    } catch {
      return caches.match(APP_SHELL_URL);
    }
  })());
});
