import { readFileSync } from 'node:fs';
import { basename } from 'node:path';
import { createRequire } from 'node:module';
import type { Locator, Page } from '@playwright/test';
import { consentMetadata } from '../../src/services/consent';
import { ledgerFor, type Handling } from './network';

const require = createRequire(import.meta.url);
const FONTS_DIR = new URL('./fonts/', import.meta.url);
const FONTS_CSS = readFileSync(new URL('./fonts.css', FONTS_DIR), 'utf8');
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
  user: { id: USER_ID, aud: 'authenticated', role: 'authenticated', email: 'visual-test@example.invalid', app_metadata: {}, user_metadata: { ...consentMetadata(FIXED_NOW), profile_complete: true }, created_at: '2026-01-01T00:00:00Z' },
});

/** Open the app signed in, with no real network: every external and Supabase request is answered locally. */
export async function openApp(page: Page, path = '/') {
  await page.clock.setFixedTime(FIXED_NOW);
  // Test-only: nothing moves. Playwright cancels animations only at capture time, which lets the compositor
  // promote layers differently between runs and rasterise text at different sub-pixel offsets.
  if (process.env.E2E_FREEZE !== 'pw') await page.addInitScript(() => {
    const freeze = () => {
      const style = document.createElement('style');
      style.textContent = '*,*::before,*::after{animation:none !important;transition:none !important;caret-color:transparent !important;scroll-behavior:auto !important}';
      (document.head || document.documentElement).appendChild(style);
    };
    if (document.head) freeze(); else document.addEventListener('DOMContentLoaded', freeze, { once: true });
  });
  await page.addInitScript((session) => {
    try {
      localStorage.setItem('gayze-auth-token', JSON.stringify(session));
      localStorage.setItem('gayze_sounds_enabled', 'false');
      localStorage.setItem('gayze_install_prompt_dismissed_at', String(Date.now()));
    } catch { /* ignore */ }
  }, fakeSession());

  const ledger = ledgerFor(page);
  await page.route(/^https?:\/\//, async (route) => {
    const url = new URL(route.request().url());
    const note = (handling: Handling) => ledger.note(url.hostname, handling, url.pathname);
    if (url.hostname === 'localhost') { note('localhost (app under test)'); return route.continue(); }
    // Fonts come from a local copy (latin + latin-ext only) so the baseline never depends on the network.
    if (url.hostname === 'fonts.googleapis.com') { note('served locally'); return route.fulfill({ contentType: 'text/css', body: FONTS_CSS.replace(/\/__e2e_fonts\//g, 'https://fonts.gstatic.com/e2e/') }); }
    if (url.hostname === 'fonts.gstatic.com') { note('served locally'); return route.fulfill({ contentType: 'font/woff2', body: readFileSync(new URL(basename(url.pathname), FONTS_DIR)) }); }
    if (url.hostname === 'unpkg.com' && url.pathname.endsWith('leaflet.css')) { note('served locally'); return route.fulfill({ contentType: 'text/css', body: LEAFLET_CSS }); }
    if (/tile|openstreetmap|cartocdn|basemaps/.test(url.hostname)) { note('served locally'); return route.fulfill({ contentType: 'image/png', body: TILE }); }
    if (url.hostname.endsWith('supabase.co')) {
      note('fake server (answered in harness.ts)');
      const json = (body: unknown) => route.fulfill({ contentType: 'application/json', body: JSON.stringify(body) });
      if (url.pathname.startsWith('/auth/v1/user')) return json(fakeSession().user);
      // The app publishes the signed-in user only after its device is registered and a signed challenge is verified.
      if (url.pathname.endsWith('/rpc/register_identity_device')) {
        const body = route.request().postDataJSON() ?? {};
        return json({ id: 'e2e-device-row', user_id: USER_ID, device_id: body.p_device_id, device_fingerprint: body.p_fingerprint, device_label: 'e2e', public_key: body.p_public_key, signing_public_key: body.p_signing_public_key, status: 'active', created_at: FIXED_NOW.toISOString() });
      }
      if (url.pathname.endsWith('/functions/v1/verify-device-signature')) {
        const body = route.request().postDataJSON() ?? {};
        return json(body.action === 'issue' ? { challenge_id: 'e2e-challenge', challenge: 'e2e-challenge' } : { verified: true });
      }
      // List-returning RPCs answer with an empty list; anything else with null.
      if (url.pathname.endsWith('/rpc/discover_people') || url.pathname.endsWith('/rpc/get_presence')) return json([]);
      if (url.pathname.startsWith('/rest/v1/rpc/')) return route.fulfill({ contentType: 'application/json', body: 'null' });
      if (url.pathname.startsWith('/rest/v1/')) return route.fulfill({ contentType: 'application/json', body: '[]' });
      return route.fulfill({ contentType: 'application/json', body: '{}' });
    }
    // Anything else (analytics, CDNs, other APIs) is not mocked: abort it and let the network guard fail the test.
    note('BLOCKED (aborted)');
    return route.abort();
  });
  // Realtime: accept every channel join so the app shows "connected" instead of "connecting". Any other websocket is blocked.
  await page.routeWebSocket(/.*/, (ws) => {
    const url = new URL(ws.url());
    if (!(url.hostname.endsWith('supabase.co') && url.pathname.startsWith('/realtime'))) { ledger.note(url.hostname, 'BLOCKED (aborted)', url.pathname); void ws.close(); return; }
    ledger.note(url.hostname, 'fake server (answered in harness.ts)', url.pathname);
    ws.onMessage((raw) => {
      const m = JSON.parse(String(raw));
      const [joinRef, ref, topic, event, payload] = Array.isArray(m) ? m : [null, m.ref, m.topic, m.event, m.payload];
      if (event !== 'phx_join' && event !== 'heartbeat') return;
      const response = event === 'phx_join' ? { postgres_changes: (payload?.config?.postgres_changes ?? []).map((c: object, i: number) => ({ ...c, id: i + 1 })) } : {};
      const reply = { status: 'ok', response };
      ws.send(JSON.stringify(Array.isArray(m) ? [joinRef, ref, topic, 'phx_reply', reply] : { topic, event: 'phx_reply', payload: reply, ref }));
    });
  });
  await page.goto(path, { waitUntil: 'load' });
  await page.locator('.g-tabbar, .g-shell').first().waitFor({ timeout: 20_000 });
  await ready(page, page.locator('.leaflet-container'));
}

/**
 * Condition wait, not a timer: fonts ready, every image decoded, two animation frames, and a visible anchor.
 */
export async function ready(page: Page, anchor?: Locator) {
  if (anchor) await anchor.first().waitFor({ state: 'visible', timeout: 15_000 });
  await page.evaluate(async () => {
    await document.fonts.ready;
    await Promise.all([...document.images].map((img) => (img.complete ? Promise.resolve() : img.decode().catch(() => undefined))));
    await new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
  });
}
