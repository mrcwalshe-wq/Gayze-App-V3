// TURN relay verification (browser-to-browser, real ICE).
//   * A local TURN server (node-turn, from the browser tools directory, outside the repo) with
//     long-term credentials runs on 127.0.0.1.
//   * The harness supplies TURN credentials exactly as the Supabase function is specified to
//     deliver them (turn: URL + username + credential) through the client's own validation.
//   * Each browser forces iceTransportPolicy 'relay' (a test-only shim), so the only path that can
//     carry media is TURN. A call that connects therefore proves a working relay.
//   * This is NOT Cloudflare TURN and does not exercise the production credential function, which
//     is absent from the repository (no credential function is in this repository; see the final report).
import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { startEnvironment } from './lib.mjs';

const tools = process.env.GAYZE_BROWSER_TOOLS || path.join(os.homedir(), '.tools', 'browser');
const require = createRequire(path.join(tools, 'package.json'));
const TURN_PORT = 3479;
const USER = 'gayze-e2e';
const PASSWORD = 'e2e-only-password';

let env, turnServer;
before(async () => {
  const Turn = require('node-turn');
  turnServer = new Turn({
    listeningPort: TURN_PORT, listeningIps: ['127.0.0.1'], relayIps: ['127.0.0.1'],
    authMech: 'long-term', credentials: { [USER]: PASSWORD }, debugLevel: 'ERROR',
  });
  turnServer.start();
  await new Promise((r) => setTimeout(r, 500));
  env = await startEnvironment();
}, { timeout: 180_000 });
after(async () => { await env?.close(); turnServer?.stop(); });

const iceFor = (password) => [{ urls: `turn:127.0.0.1:${TURN_PORT}?transport=udp`, username: USER, credential: password }];

test('relay-only call connects through TURN and carries audio (selected candidates are relay)', { timeout: 150_000 }, async () => {
  const a = await env.openUser('turn-a', { ice: iceFor(PASSWORD), relayOnly: true });
  const b = await env.openUser('turn-b', { ice: iceFor(PASSWORD), relayOnly: true });
  await env.connectCall(a, b, 'audio', 'conv-turn-1');
  const sa = await env.snap(a), sb = await env.snap(b);
  console.log('[turn] A selected pair:', JSON.stringify(sa.selectedPair));
  console.log('[turn] B selected pair:', JSON.stringify(sb.selectedPair));
  assert.equal(sa.selectedPair?.state, 'succeeded');
  assert.equal(sa.selectedPair?.local, 'relay', 'caller selected a relayed local candidate');
  assert.equal(sa.selectedPair?.remote, 'relay', 'caller selected a relayed remote candidate');
  assert.equal(sb.selectedPair?.local, 'relay');
  const energy = await env.inbound(b, 'audio', 'bytesReceived');
  await env.measure(b, 'audio', 2000);
  assert.ok((await env.inbound(b, 'audio', 'bytesReceived')) > energy, 'audio flows through the relay');
  await env.act(a, 'endCall'); await env.act(b, 'endCall');
});

test('wrong TURN credentials: the relay cannot be allocated and the call fails rather than hanging', { timeout: 200_000 }, async () => {
  const a = await env.openUser('turn-bad-a', { ice: iceFor('wrong-password'), relayOnly: true });
  const b = await env.openUser('turn-bad-b', { ice: iceFor('wrong-password'), relayOnly: true });
  await env.act(a, 'startCall', 'turn-bad-b', 'audio', 'conv-turn-bad');
  await env.waitIncoming(b);
  await env.act(b, 'acceptIncoming');
  const sa = await env.waitState(a, ['failed', 'ended', 'declined'], 170_000).catch((e) => ({ state: 'timeout', error: e.message }));
  assert.notEqual(sa.state, 'connected');
  assert.notEqual(sa.state, 'timeout', 'the failed relay path is reported, not left connecting');
  await env.act(a, 'endCall').catch(() => undefined); await env.act(b, 'endCall').catch(() => undefined);
});
