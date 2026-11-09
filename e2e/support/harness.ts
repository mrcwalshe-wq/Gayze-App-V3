import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import type { Page } from '@playwright/test';

const require = createRequire(import.meta.url);
const LEAFLET_CSS = readFileSync(require.resolve('leaflet/dist/leaflet.css'), 'utf8');
// 1x1 dark PNG: map tiles are flat and identical on every run.
const TILE = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mMQmj3rPwAFPgK8Sx1c9QAAAABJRU5ErkJggg==', 'base64');
export const FIXED_NOW = new Date('2026-11-09T12:00:00Z');
const USER_ID = '00000000-0000-4000-8000-000000000001';

const b64u = (value: unknown) => Buffer.from(JSON.stringify(value)).toString('base64url');
const fakeJwt = () => `${b64u({ alg: 'HS256', typ: 'JWT' })}.${b64u({ sub: USER_ID, role: 'authenticated', exp: 4102444800 })}.test`;

export const fakeSession = () => ({
  access_token: fakeJwt(),
  refresh_token: 'test-refresh',
  token_type: 'bearer',
  expires_in: 3_000_000_000,
  expires_at: 4102444800,
  user: { id: USER_ID, aud: 'authenticated', role: 'authenticated', email: 'visual-test@example.invalid', app_metadata: {}, user_metadata: {}, created_at: '2026-01-01T00:00:00Z' },
});

/** Open the app signed in, with no real network: every external and Supabase request is answered locally. */
export async function openApp(page: Page, path = '/') {
  await page.clock.setFixedTime(FIXED_NOW);
  await page.addInitScript((session) => {
    try {
      localStorage.setItem('gayze-auth-token', JSON.stringify(session));
      localStorage.setItem('gayze_sounds_enabled', 'false');
      localStorage.setItem('gayze_install_prompt_dismissed_at', String(Date.now()));
    } catch { /* ignore */ }
  }, fakeSession());

  await page.route(/^https?:\/\//, async (route) => {
    const url = new URL(route.request().url());
    if (url.hostname === 'localhost') return route.continue();
    if (url.hostname === 'unpkg.com' && url.pathname.endsWith('leaflet.css')) return route.fulfill({ contentType: 'text/css', body: LEAFLET_CSS });
    if (/tile|openstreetmap|cartocdn|basemaps/.test(url.hostname)) return route.fulfill({ contentType: 'image/png', body: TILE });
    if (url.hostname.endsWith('supabase.co')) {
      if (url.pathname.startsWith('/auth/v1/user')) return route.fulfill({ contentType: 'application/json', body: JSON.stringify(fakeSession().user) });
      if (url.pathname.startsWith('/rest/v1/rpc/')) return route.fulfill({ contentType: 'application/json', body: 'null' });
      if (url.pathname.startsWith('/rest/v1/')) return route.fulfill({ contentType: 'application/json', body: '[]' });
      return route.fulfill({ contentType: 'application/json', body: '{}' });
    }
    return route.abort();
  });
  await page.goto(path, { waitUntil: 'load' });
  await page.locator('.g-tabbar, .g-shell').first().waitFor({ timeout: 20_000 });
  await page.waitForTimeout(1500);
}
