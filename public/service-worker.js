/**
 * GAYZE production service worker.
 * Web Push is always user-visible on iOS; no silent/invisible push path.
 */
const SW_VERSION = 'gayze-sw-v11';
const SHELL_CACHE = `${SW_VERSION}-shell`;
const ASSET_CACHE = `${SW_VERSION}-assets`;
const APP_SHELL_URL = '/index.html';
const ICON_VERSION = '?v=20261006-1';
const IOS_ICON = `/apple-touch-icon.png${ICON_VERSION}`;
const PRECACHE_URLS = ['/', '/manifest.webmanifest', IOS_ICON, `/icons/gayze-180.png${ICON_VERSION}`, `/icons/gayze-192.png${ICON_VERSION}`, `/icons/gayze-512.png${ICON_VERSION}`, `/icons/gayze-512-maskable.png${ICON_VERSION}`];
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
