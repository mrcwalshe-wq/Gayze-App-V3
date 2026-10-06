/**
 * GAYZE intent composer regression tests.
 *
 * Mounts the REAL <App/> (and therefore the real SetIntentSheet and the real
 * handleSaveUserIntent -> saveActiveIntentWithSession path) inside jsdom.
 * The Supabase wire is mocked at the fetch boundary so the test exercises the
 * app's own request/response handling — including the honest-failure branch —
 * without touching the live project.
 *
 * Run: npm run test:intent-composer
 */
await import('../interaction-tests/env.mjs');

const React = (await import('react')).default;
const { createRoot } = await import('react-dom/client');
const { act } = await import('react');

let failures = 0;
function assert(cond: unknown, msg: string) {
  if (!cond) { console.error('  \u2717 FAIL:', msg); failures += 1; process.exitCode = 1; }
  else console.log('  \u2713', msg);
}
const section = (t: string) => console.log(`\n=== ${t} ===`);
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function waitFor(fn: () => boolean, ms = 5000): Promise<boolean> {
  const start = Date.now();
  while (Date.now() - start < ms) {
    if (fn()) return true;
    await act(async () => { await sleep(40); });
  }
  return fn();
}

const click = async (el: Element) => {
  await act(async () => {
    el.dispatchEvent(new window.MouseEvent('click', { bubbles: true, cancelable: true }));
  });
};

const buttons = () => [...document.querySelectorAll('button')];
const buttonByText = (text: string) =>
  buttons().find((b) => (b.textContent || '').trim().includes(text));
const tileByLabel = (label: string) =>
  buttons().find((b) => [...b.querySelectorAll('.g-opt__t')].some((s) => s.textContent === label));

// ---------------------------------------------------------------------------
// Supabase wire mock (fetch boundary)
// ---------------------------------------------------------------------------
const UID = '11111111-2222-3333-4444-555555555555';
const wire: { url: string; method: string }[] = [];
let intentsBackend: 'ok' | 'fail' = 'ok';

const jsonResponse = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

let storedIntentRow: Record<string, unknown> | null = null;

globalThis.fetch = (async (input: RequestInfo | URL, init: RequestInit = {}) => {
  const url = String(typeof input === 'string' || input instanceof URL ? input : input.url);
  const method = (init.method || 'GET').toUpperCase();
  const headers: any = init.headers || {};
  const accept = String(headers.get ? headers.get('accept') : headers.accept || headers.Accept || '');
  const wantsObject = accept.includes('vnd.pgrst.object');
  const restReply = (rows: any[]) => {
    if (wantsObject) {
      if (rows.length === 0) {
        return jsonResponse({ message: 'JSON object requested, multiple (or no) rows returned', code: 'PGRST116', details: 'Results contain 0 rows', hint: null }, 406);
      }
      return jsonResponse(rows[0]);
    }
    return jsonResponse(rows);
  };
  if (url.includes('supabase.co')) {
    wire.push({ url, method });
    if (url.includes('/auth/v1/user')) {
      return jsonResponse({
        id: UID, aud: 'authenticated', email: 'test@gayze.example',
        user_metadata: { profile_complete: true, display_name: 'Tester' },
        app_metadata: {}, created_at: '2026-01-01T00:00:00Z',
      });
    }
    if (url.includes('/rest/v1/intents')) {
      if (method === 'POST') {
        if (intentsBackend === 'fail') return jsonResponse({ message: 'mocked outage' }, 500);
        const body = typeof init.body === 'string' ? JSON.parse(init.body) : {};
        storedIntentRow = { ...body, id: 'intent-test-1', user_id: UID, is_paused: false };
        return restReply([{ id: 'intent-test-1', expires_at: (storedIntentRow as any).expires_at, is_paused: false }]);
      }
      if (method === 'PATCH') {
        const body = typeof init.body === 'string' ? JSON.parse(init.body) : {};
        if (storedIntentRow) storedIntentRow = { ...storedIntentRow, ...body };
        return restReply(storedIntentRow ? [{ id: 'intent-test-1', expires_at: (storedIntentRow as any).expires_at, is_paused: (storedIntentRow as any).is_paused }] : []);
      }
      // SELECT: the stored row, if live — keeps loadActiveIntent/refresh honest.
      if (storedIntentRow && !(storedIntentRow as any).is_paused) return restReply([storedIntentRow]);
      return restReply([]);
    }
    if (url.includes('/rest/v1/')) return jsonResponse([]);
    return jsonResponse({});
  }
  return jsonResponse({});
}) as typeof fetch;
window.fetch = globalThis.fetch;

// Session first, so the real app boots authenticated (live mode).
function installSession() {
  const exp = Math.floor(Date.now() / 1000) + 3600;
  const b64 = (o: unknown) => Buffer.from(JSON.stringify(o)).toString('base64url');
  const jwt = `${b64({ alg: 'HS256', typ: 'JWT' })}.${b64({ sub: UID, exp, role: 'authenticated' })}.sig`;
  localStorage.setItem('gayze-auth-token', JSON.stringify({
    access_token: jwt, token_type: 'bearer', expires_in: 3600, expires_at: exp,
    refresh_token: 'refresh', user: { id: UID, aud: 'authenticated', email: 'test@gayze.example' },
  }));
}

// jsdom's window.crypto has no SubtleCrypto; borrow Node's webcrypto.
if (!(window.crypto as any)?.subtle) {
  Object.defineProperty(window, 'crypto', {
    configurable: true,
    value: {
      subtle: (globalThis.crypto as any).subtle,
      getRandomValues: (a: any) => globalThis.crypto.getRandomValues(a),
      randomUUID: () => globalThis.crypto.randomUUID(),
    },
  });
}

// Node's undici WebSocket crashes on failed connections; supabase realtime
// only needs a socket that never connects in this offline harness.
class OfflineWebSocket {
  static CONNECTING = 0; static OPEN = 1; static CLOSING = 2; static CLOSED = 3;
  readyState = 3;
  onopen: any = null; onerror: any = null; onmessage: any = null; onclose: any = null;
  constructor(public url: string, public protocol?: string) {}
  addEventListener() {} removeEventListener() {} dispatchEvent() { return false; }
  send() {} close() {} binaryType: any = 'blob';
}
(globalThis as any).WebSocket = OfflineWebSocket;
(window as any).WebSocket = OfflineWebSocket;

if (!(window.navigator as any).geolocation) {
  Object.defineProperty(window.navigator, 'geolocation', {
    configurable: true,
    value: { getCurrentPosition: () => {}, watchPosition: () => 1, clearWatch: () => {}, clearPosition: () => {} },
  });
}

// ---------------------------------------------------------------------------
// Mount the REAL App
// ---------------------------------------------------------------------------
installSession();
const App = (await import('../../src/App.tsx')).default;

const root = createRoot(document.getElementById('root')!);
await act(async () => { root.render(React.createElement(App)); });
await act(async () => { await sleep(150); });

section('[1] PRIVATE intent — honest failure keeps the sheet open');
intentsBackend = 'fail';

const navOk = await waitFor(() => Boolean(document.querySelector('[data-tab="right_now"]')));
assert(navOk, 'mobile nav renders the Right Now tab');
await click(document.querySelector('[data-tab="right_now"]')!);

const ctaOk = await waitFor(() => Boolean(document.querySelector('.g-live-cta')));
assert(ctaOk, 'live-signal CTA renders on the Right Now map');
await click(document.querySelector('.g-live-cta')!);

const sheetOk = await waitFor(() => Boolean(document.getElementById('set-intent-title')));
assert(sheetOk, 'Set a live signal sheet opens');

await click(buttonByText('Private')!);
await click(tileByLabel('Hookup')!);
await click(buttonByText('Right now')!);
await click(buttonByText('2 hrs')!);
await click(buttonByText('Within 2 km')!);

const privatePill = buttons().find((b) => (b.textContent || '').trim() === 'Within 2 km');
assert(privatePill?.getAttribute('data-active') === 'true', 'distance pill selected in Private mode');

await click(buttonByText('Go live')!);
await waitFor(() => wire.some((w) => w.url.includes('/rest/v1/intents') && w.method === 'POST'));

const errorShown = await waitFor(() => (document.body.textContent || '').includes('Could not publish your signal'));
assert(document.getElementById('set-intent-title'), 'backend failure: sheet stays OPEN (regression fixed)');
assert(errorShown, 'backend failure: honest error shown in the sheet');
const retryOk = await waitFor(() => {
  const b = buttonByText('Go live');
  return Boolean(b) && !(b as HTMLButtonElement).disabled;
});
assert(retryOk, 'backend failure: Go live re-enabled for retry');

section('[2] SOCIAL intent — successful save closes the sheet and goes live');
intentsBackend = 'ok';
wire.length = 0;

await click(buttonByText('Social')!);
await click(tileByLabel('Meet')!);
await click(buttonByText('Go live')!);

const closedOk = await waitFor(() => !document.getElementById('set-intent-title'));
assert(closedOk, 'successful save: sheet closes only AFTER the write succeeded');
assert(wire.some((w) => w.url.includes('/rest/v1/intents') && w.method === 'POST'), 'intent row written to the intents table');

const liveShown = await waitFor(() =>
  (document.body.textContent || '').includes('You are live on the map')
  || Boolean(document.querySelector('.g-live-cta--social'))
  || (document.body.textContent || '').includes('Meet'));
assert(liveShown, 'active intent appears after publish');

section('[3] PRIVATE host/travel variants submit through the same path');

await click(document.querySelector('.g-live-cta')!);
const editOk = await waitFor(() => Boolean(buttonByText('Edit')));
assert(editOk, 'live CTA opens the manage drawer with an Edit action');
await click(buttonByText('Edit')!);
const reopenOk = await waitFor(() => Boolean(document.getElementById('set-intent-title')));
assert(reopenOk, 'composer reopens for editing the live signal');
await click(buttonByText('Private')!);
await click(tileByLabel('Hookup Host')!);
assert((document.body.textContent || '').includes('Can you host?'), 'hosting options revealed for Hookup Host');
wire.length = 0;
const submitBtn = buttonByText('Update signal') ?? buttonByText('Go live');
assert(Boolean(submitBtn), 'submit button present while editing');
await click(submitBtn!);
const hostSaved = await waitFor(() => !document.getElementById('set-intent-title'));
assert(hostSaved, 'Hookup Host update saves and closes');
assert(wire.some((w) => w.url.includes('/rest/v1/intents')), 'Hookup Host write reached the backend');

console.log(failures === 0 ? '\nINTENT COMPOSER TESTS: ALL PASSED' : `\nINTENT COMPOSER TESTS: ${failures} FAILED`);
process.exit(failures === 0 ? 0 : 1);
