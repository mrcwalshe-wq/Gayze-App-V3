// REAL browser-to-browser call tests.
//   * Two independent Chromium contexts (separate storage, separate user identities).
//   * The REAL webrtcService, RTCPeerConnection, getUserMedia (Chromium fake devices),
//     SDP/ICE negotiation, remote rendering and track control.
//   * Signalling goes through scripts/browser-tests/relay.mjs (a broadcast stand-in), NOT
//     Supabase. Realtime RLS is covered by scripts/call-tests/realtime-authorization.test.mjs.
//   * Media is peer-to-peer on loopback; TURN relay is NOT exercised here.
import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer } from 'vite';
import { startRelay } from './relay.mjs';
import { playwright, resolveBrowser } from './browser-env.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const HARNESS = path.join(HERE, 'harness');
const FAKE_SUPABASE = path.join(HARNESS, 'fakeSupabase.ts');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

let relay, vite, browser, base;
const users = [];
const CONV = 'conv-e2e-1';

const DENY_SCRIPT = (name) => `
  (() => {
    const err = new Error('simulated ${name}');
    err.name = '${name}';
    navigator.mediaDevices.getUserMedia = () => Promise.reject(err);
  })();`;

before(async () => {
  relay = await startRelay({ port: 0 });
  vite = await createServer({
    configFile: false, root: HARNESS, logLevel: 'warn',
    resolve: { alias: [{ find: /^(\.\/|.*\/)supabaseClient$/, replacement: FAKE_SUPABASE }] },
    server: { host: '127.0.0.1', port: 0, strictPort: false },
  });
  await vite.listen();
  base = vite.resolvedUrls.local[0];
  const { executablePath, args } = await resolveBrowser();
  const { chromium } = playwright();
  browser = await chromium.launch({
    executablePath,
    args: [...args.filter((a) => a !== '--single-process'), '--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream', '--autoplay-policy=no-user-gesture-required'],
    headless: true,
  });
}, { timeout: 180_000 });

after(async () => {
  for (const u of users) await u.ctx.close().catch(() => undefined);
  await browser?.close().catch(() => undefined);
  await vite?.close();
  await relay?.close();
});

async function openUser(userId, { denyMedia = null } = {}) {
  const ctx = await browser.newContext();
  await ctx.addInitScript(`window.__RELAY_URL__ = ${JSON.stringify(`ws://127.0.0.1:${relay.port}`)};`);
  if (denyMedia) await ctx.addInitScript(DENY_SCRIPT(denyMedia));
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(`console: ${m.text()}`); });
  await page.goto(`${base}?u=${encodeURIComponent(userId)}`);
  await page.waitForFunction(() => window.__ready === true, null, { timeout: 60_000 });
  await waitFor(() => relay.subscribers(`gayze-user-${userId}`) > 0, 15_000, `${userId} personal channel subscribed`);
  const user = { ctx, page, errors, userId };
  users.push(user);
  return user;
}

async function waitFor(predicate, timeoutMs, label) {
  const started = Date.now();
  for (;;) {
    if (await predicate()) return;
    if (Date.now() - started > timeoutMs) throw new Error(`Timed out waiting for: ${label}`);
    await sleep(250);
  }
}

const snap = (u) => u.page.evaluate(() => window.__gayze.snapshot());
const act = (u, fn, ...args) => u.page.evaluate(([name, a]) => window.__gayze[name](...a), [fn, args]);

async function waitState(u, states, timeoutMs = 20_000) {
  let last;
  await waitFor(async () => { last = await snap(u); return states.includes(last.state); }, timeoutMs,
    `${u.userId} state in [${states}] (last: ${last?.state}, error: ${last?.error})`);
  return last;
}

async function inbound(u, kind, field = 'bytesReceived') {
  const s = await snap(u);
  return s.inbound.filter((x) => x.kind === kind).reduce((n, x) => n + (x[field] || 0), 0);
}

async function waitIncoming(u, timeoutMs = 20_000) {
  await waitFor(async () => (await u.page.evaluate(() => window.__gayze.incoming())) !== null, timeoutMs, `${u.userId} incoming call`);
}

async function connectCall(caller, callee, callType, conversationId = CONV) {
  await act(caller, 'startCall', callee.userId, callType, conversationId);
  await waitIncoming(callee);
  await act(callee, 'acceptIncoming');
  await waitState(caller, ['connected'], 45_000);
  await waitState(callee, ['connected'], 45_000);
}

// ---------------------------------------------------------------------------

test('audio call: A rings B, B answers, both connect, audio flows peer-to-peer', { timeout: 120_000 }, async () => {
  const a = await openUser('user-a'), b = await openUser('user-b');
  await connectCall(a, b, 'audio');

  const sa = await snap(a), sb = await snap(b);
  assert.equal(sa.local.filter((t) => t.kind === 'audio' && t.readyState === 'live').length, 1, 'caller has a live microphone track');
  assert.equal(sb.local.filter((t) => t.kind === 'audio' && t.readyState === 'live').length, 1, 'callee has a live microphone track');
  assert.equal(sa.pcState, 'connected'); assert.equal(sb.pcState, 'connected');
  assert.equal(sa.selectedPair?.state, 'succeeded', 'ICE selected a succeeded candidate pair');
  console.log('[audio] selected pair (A):', JSON.stringify(sa.selectedPair));

  const r1 = await inbound(b, 'audio');
  await sleep(2000);
  const r2 = await inbound(b, 'audio');
  assert.ok(r2 > r1 + 1000, `B receives audio from A (bytes ${r1} -> ${r2})`);
  assert.deepEqual([a.errors, b.errors].flat().filter((e) => !/favicon|DevTools|Failed to load resource: the server responded with a status of 404/.test(e)), [], 'no page errors');
  await act(a, 'endCall'); await act(b, 'endCall');
});

test('audio mute changes the real microphone track and stops the peer hearing it', { timeout: 120_000 }, async () => {
  const a = await openUser('user-mute-a'), b = await openUser('user-mute-b');
  await connectCall(a, b, 'audio');

  const unmutedEnergy = await audioEnergy(b, 2500);
  const off = await act(a, 'toggleAudio', false);
  assert.equal(off, false);
  let s = await snap(a);
  assert.equal(s.audioEnabled, false);
  assert.equal(s.local.find((t) => t.kind === 'audio').enabled, false, 'real track disabled');
  await sleep(500);
  const mutedEnergy = await audioEnergy(b, 2500);
  assert.ok(unmutedEnergy > 0, `peer hears audio before mute (energy ${unmutedEnergy})`);
  assert.ok(mutedEnergy < unmutedEnergy / 10, `peer hears silence while muted (energy ${mutedEnergy} vs ${unmutedEnergy})`);

  await act(a, 'toggleAudio', true);
  s = await snap(a);
  assert.equal(s.local.find((t) => t.kind === 'audio').enabled, true, 'unmuted track enabled again');
  await sleep(500);
  const resumedEnergy = await audioEnergy(b, 2500);
  assert.ok(resumedEnergy > mutedEnergy * 10 && resumedEnergy > 0, `audio resumes after unmute (energy ${resumedEnergy} vs muted ${mutedEnergy})`);
  await act(a, 'endCall'); await act(b, 'endCall');
});

async function measure(u, kind, ms) {
  const before = await inbound(u, kind);
  await sleep(ms);
  return (await inbound(u, kind)) - before;
}

// Received audio ENERGY (not bytes): Chromium keeps sending silent Opus packets at the
// full packet rate, so byte counts cannot show a mute. Energy is zero for silence.
async function audioEnergy(u, ms) {
  const before = await inbound(u, 'audio', 'totalAudioEnergy');
  await sleep(ms);
  return (await inbound(u, 'audio', 'totalAudioEnergy')) - before;
}

test('video call: remote video renders, local preview is live, camera off stops the real video track', { timeout: 120_000 }, async () => {
  const a = await openUser('user-v-a'), b = await openUser('user-v-b');
  await connectCall(a, b, 'video', 'conv-e2e-video');
  await waitFor(async () => (await b.page.evaluate(() => window.__gayze.snapshot())).remoteVideo.width > 0, 20_000, 'remote video has dimensions');
  const frames1 = await inbound(b, 'video', 'framesDecoded');
  await sleep(1500);
  const frames2 = await inbound(b, 'video', 'framesDecoded');
  assert.ok(frames2 > frames1, `remote video frames are decoded (${frames1} -> ${frames2})`);
  const rv = (await snap(b)).remoteVideo;
  assert.ok(rv.width > 0 && rv.height > 0, 'remote <video> has intrinsic dimensions');
  assert.equal((await snap(a)).local.find((t) => t.kind === 'video').readyState, 'live', 'local preview track live');
  const audioBytes = await measure(b, 'audio', 1500);
  assert.ok(audioBytes > 0, 'audio flows alongside video');

  await act(a, 'toggleVideo', false);
  let sa = await snap(a);
  assert.equal(sa.videoEnabled, false);
  assert.equal(sa.local.find((t) => t.kind === 'video').enabled, false, 'real camera track disabled');
  await sleep(500);
  const frozenFrames = await measure(b, 'video', 1500);   // decoded frames delta while camera off
  await act(a, 'toggleVideo', true);
  sa = await snap(a);
  assert.equal(sa.local.find((t) => t.kind === 'video').enabled, true);
  await sleep(500);
  const resumed = await measure(b, 'video', 1500);
  assert.ok(resumed > frozenFrames, `video resumes after camera on (${frozenFrames} -> ${resumed} frames/1.5s)`);
  await act(a, 'endCall'); await act(b, 'endCall');
});

test('hang-up by the callee ends both sides, stops local tracks and closes the peer connection', { timeout: 120_000 }, async () => {
  const a = await openUser('user-h-a'), b = await openUser('user-h-b');
  await connectCall(a, b, 'audio');
  const tracksA = await snap(a);
  await act(b, 'endCall');
  await waitState(b, ['ended'], 10_000);
  await waitState(a, ['ended'], 10_000);
  const sa = await snap(a), sb = await snap(b);
  assert.equal(sa.pcState, null, 'caller peer connection closed');
  assert.equal(sb.pcState, null, 'callee peer connection closed');
  assert.equal(sa.local.length, 0, 'caller released local media');
  assert.equal(sb.local.length, 0, 'callee released local media');
  assert.ok(tracksA.local.length > 0);
  await act(a, 'endCall');
});

test('hang-up by the caller ends the callee', { timeout: 120_000 }, async () => {
  const a = await openUser('user-hc-a'), b = await openUser('user-hc-b');
  await connectCall(a, b, 'audio');
  await act(a, 'endCall');
  await waitState(b, ['ended'], 10_000);
  assert.equal((await snap(b)).local.length, 0);
});

test('declined call: caller sees declined, callee returns to idle', { timeout: 60_000 }, async () => {
  const a = await openUser('user-d-a'), b = await openUser('user-d-b');
  await act(a, 'startCall', 'user-d-b', 'audio', CONV);
  await waitIncoming(b);
  await act(b, 'declineIncoming');
  await waitState(a, ['declined'], 10_000);
  assert.equal((await snap(b)).state, 'idle');
  await act(a, 'endCall');
});

test('cancelled ringing: the callee\'s incoming call is dismissed by the caller\'s cancel', { timeout: 60_000 }, async () => {
  const a = await openUser('user-x-a'), b = await openUser('user-x-b');
  await act(a, 'startCall', 'user-x-b', 'audio', CONV);
  await waitIncoming(b);
  await act(a, 'endCall');
  await waitFor(async () => (await b.page.evaluate(() => window.__gayze.incoming())) === null, 10_000, 'incoming cleared');
  assert.equal((await snap(a)).state, 'ended');
});

test('simultaneous call: a third user calling a busy callee is declined', { timeout: 120_000 }, async () => {
  const a = await openUser('user-s-a'), b = await openUser('user-s-b'), c = await openUser('user-s-c');
  await connectCall(a, b, 'audio', 'conv-busy-ab');
  await act(c, 'startCall', 'user-s-b', 'audio', 'conv-busy-cb');
  await waitState(c, ['declined'], 15_000);
  assert.equal((await snap(b)).state, 'connected', 'the busy callee stays on the original call');
  assert.equal((await snap(a)).state, 'connected');
  await act(a, 'endCall'); await act(b, 'endCall');
});

test('callee microphone permission denied: the caller is told promptly and the callee sees a clear error', { timeout: 90_000 }, async () => {
  const a = await openUser('user-p-a'), b = await openUser('user-p-b', { denyMedia: 'NotAllowedError' });
  await act(a, 'startCall', 'user-p-b', 'audio', CONV);
  await waitIncoming(b);
  await act(b, 'acceptIncoming');
  const sb = await waitState(b, ['failed'], 10_000);
  assert.match(sb.error, /permission was denied/i);
  await waitState(a, ['declined', 'failed', 'ended'], 10_000);
  assert.equal((await snap(a)).state !== 'connected', true);
  await act(a, 'endCall');
});

test('callee has no camera/microphone device: honest "not detected" message', { timeout: 90_000 }, async () => {
  const a = await openUser('user-n-a'), b = await openUser('user-n-b', { denyMedia: 'NotFoundError' });
  await act(a, 'startCall', 'user-n-b', 'video', CONV);
  await waitIncoming(b);
  await act(b, 'acceptIncoming');
  const sb = await waitState(b, ['failed'], 10_000);
  assert.match(sb.error, /No camera or microphone/);
  await act(a, 'endCall');
});

test('signalling interruption during a live call: media survives and the call stays connected', { timeout: 150_000 }, async () => {
  const a = await openUser('user-r-a'), b = await openUser('user-r-b');
  await connectCall(a, b, 'audio');
  await a.page.evaluate(() => window.__gayze.relay.drop());
  await b.page.evaluate(() => window.__gayze.relay.drop());
  await sleep(4000);
  const duringOutage = await snap(a);
  assert.equal(duringOutage.pcState, 'connected', 'media path survives the signalling outage');
  await a.page.evaluate(() => window.__gayze.relay.restore());
  await b.page.evaluate(() => window.__gayze.relay.restore());
  const before = await inbound(b, 'audio');
  await sleep(3000);
  const after = await inbound(b, 'audio');
  assert.ok(after > before, 'audio continues after the signalling socket returns');
  // Signalling rejoin follows the SDK/recovery backoff (up to ~30 s); allow it.
  await waitFor(async () => (await snap(a)).state === 'connected' && (await snap(b)).state === 'connected', 45_000, 'both sides report connected after signalling rejoin');
  const ea = await snap(a), eb = await snap(b);
  console.log('[interrupt] A', ea.state, ea.pcState, ea.iceState, 'B', eb.state, eb.pcState, eb.iceState);
  assert.equal(ea.state, 'connected', `caller recovers after signalling returns (events: ${ea.events.join(' > ')}; pc=${ea.pcState}/${ea.iceState}; peer pc=${eb.pcState}/${eb.iceState})`);
  assert.equal(eb.state, 'connected', `callee recovers after signalling returns (events: ${eb.events.join(' > ')})`);
  await act(a, 'endCall'); await act(b, 'endCall');
});

test('caller unanswered for 35 seconds: the call becomes missed and nothing keeps ringing', { timeout: 90_000 }, async () => {
  const a = await openUser('user-m-a');
  await act(a, 'startCall', 'user-nobody', 'audio', CONV);
  const s = await waitState(a, ['missed'], 60_000);
  assert.equal(s.state, 'missed');
});
