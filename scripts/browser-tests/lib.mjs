// Shared browser-test machinery: a local harness server, a relay, Chromium, and user pages.
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer } from 'vite';
import { startRelay } from './relay.mjs';
import { playwright, resolveBrowser } from './browser-env.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
export const HARNESS = path.join(HERE, 'harness');
export const FAKE_SUPABASE = path.join(HARNESS, 'fakeSupabase.ts');
export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export async function waitFor(predicate, timeoutMs, label) {
  const started = Date.now();
  for (;;) {
    if (await predicate()) return;
    if (Date.now() - started > timeoutMs) throw new Error(`Timed out waiting for: ${label}`);
    await sleep(250);
  }
}

export async function startEnvironment() {
  const relay = await startRelay({ port: 0 });
  const vite = await createServer({
    configFile: false, root: HARNESS, logLevel: 'warn',
    resolve: { alias: [{ find: /^(\.\/|.*\/)supabaseClient$/, replacement: FAKE_SUPABASE }] },
    server: { host: '127.0.0.1', port: 0, strictPort: false },
  });
  await vite.listen();
  const base = vite.resolvedUrls.local[0];
  const { executablePath, args } = await resolveBrowser();
  const browser = await playwright().chromium.launch({
    executablePath,
    args: [...args.filter((a) => a !== '--single-process'), '--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream', '--autoplay-policy=no-user-gesture-required'],
    headless: true,
  });
  const users = [];
  const DENY = (name) => `(() => { const err = new Error('simulated ${name}'); err.name = '${name}'; navigator.mediaDevices.getUserMedia = () => Promise.reject(err); })();`;
  // Test-only: force relay-only ICE to prove the TURN path, without changing the service.
  const FORCE_RELAY = `(() => { const Orig = window.RTCPeerConnection; window.RTCPeerConnection = class extends Orig { constructor(cfg = {}, ...rest) { super({ ...cfg, iceTransportPolicy: 'relay' }, ...rest); } }; })();`;

  async function openUser(userId, { denyMedia = null, ice = null, relayOnly = false } = {}) {
    const ctx = await browser.newContext();
    await ctx.addInitScript(`window.__RELAY_URL__ = ${JSON.stringify(`ws://127.0.0.1:${relay.port}`)};`);
    if (denyMedia) await ctx.addInitScript(DENY(denyMedia));
    if (relayOnly) await ctx.addInitScript(FORCE_RELAY);
    const page = await ctx.newPage();
    const errors = [];
    page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
    page.on('console', (m) => { if (m.type() === 'error') errors.push(`console: ${m.text()}`); });
    const query = new URLSearchParams({ u: userId });
    if (ice) query.set('ice', JSON.stringify(ice));
    await page.goto(`${base}?${query}`);
    await page.waitForFunction(() => window.__ready === true, null, { timeout: 60_000 });
    await waitFor(() => relay.subscribers(`gayze-user-${userId}`) > 0, 15_000, `${userId} personal channel subscribed`);
    const user = { ctx, page, errors, userId };
    users.push(user);
    return user;
  }

  const snap = (u) => u.page.evaluate(() => window.__gayze.snapshot());
  const act = (u, fn, ...args) => u.page.evaluate(([name, a]) => window.__gayze[name](...a), [fn, args]);
  async function waitState(u, states, timeoutMs = 20_000) {
    let last;
    await waitFor(async () => { last = await snap(u); return states.includes(last.state); }, timeoutMs,
      `${u.userId} state in [${states}] (last: ${last?.state}, error: ${last?.error}, events: ${last?.events?.join(' > ')})`);
    return last;
  }
  async function inbound(u, kind, field = 'bytesReceived') {
    const s = await snap(u);
    return s.inbound.filter((x) => x.kind === kind).reduce((n, x) => n + (x[field] || 0), 0);
  }
  async function waitIncoming(u, timeoutMs = 20_000) {
    await waitFor(async () => (await u.page.evaluate(() => window.__gayze.incoming())) !== null, timeoutMs, `${u.userId} incoming call`);
  }
  async function connectCall(caller, callee, callType, conversationId) {
    await act(caller, 'startCall', callee.userId, callType, conversationId);
    await waitIncoming(callee);
    await act(callee, 'acceptIncoming');
    await waitState(caller, ['connected'], 45_000);
    await waitState(callee, ['connected'], 45_000);
  }
  async function audioEnergy(u, ms) {
    const before = await inbound(u, 'audio', 'totalAudioEnergy');
    await sleep(ms);
    return (await inbound(u, 'audio', 'totalAudioEnergy')) - before;
  }
  async function measure(u, kind, ms, field = 'bytesReceived') {
    const before = await inbound(u, kind, field);
    await sleep(ms);
    return (await inbound(u, kind, field)) - before;
  }

  async function close() {
    for (const u of users) await u.ctx.close().catch(() => undefined);
    await browser.close().catch(() => undefined);
    await vite.close();
    await relay.close();
  }

  return { relay, base, users, openUser, snap, act, waitState, inbound, waitIncoming, connectCall, audioEnergy, measure, close };
}
