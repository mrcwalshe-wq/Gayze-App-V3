import assert from 'node:assert/strict';
import { test } from 'node:test';
import { loadModule } from './load-module.mjs';

Object.defineProperty(globalThis, 'navigator', { configurable: true, value: { onLine: true } });
const { WebRTCCallService, getIceServers } = await loadModule('src/services/webrtcService.ts');
function call(caller = true) {
  const service = new WebRTCCallService();
  const sent = [], offers = [], candidates = [], configurations = [];
  const pc = {
    signalingState: 'stable', remoteDescription: null, connectionState: 'disconnected',
    getConfiguration: () => ({}), setConfiguration: (config) => configurations.push(config),
    async createOffer(options) { offers.push(options); return { type: 'offer', sdp: 'a=ice-ufrag:new-local' }; },
    async createAnswer() { return { type: 'answer', sdp: 'a=ice-ufrag:answer' }; },
    async setLocalDescription(sdp) { pc.signalingState = sdp.type === 'offer' ? 'have-local-offer' : 'stable'; },
    async setRemoteDescription(sdp) { pc.remoteDescription = sdp; pc.signalingState = sdp.type === 'offer' ? 'have-remote-offer' : 'stable'; },
    async addIceCandidate(candidate) { candidates.push(candidate); },
    close() { pc.signalingState = 'closed'; },
  };
  service.pc = pc;
  service.activeConversationId = 'room';
  service.localUserId = caller ? 'caller' : 'callee';
  service.activeTargetUserId = caller ? 'callee' : 'caller';
  service.caller = caller;
  service.callChannel = { state: 'joined', async send(packet) { sent.push(packet.payload); return 'ok'; } };
  let loads = 0;
  service.iceCache = { nextRefreshAt: Date.now() + 3600_000, clear() {}, async get() { loads++; return [{ urls: 'turn:provider.example', username: 'temporary', credential: 'test-only' }]; } };
  return { service, pc, sent, offers, candidates, configurations, loads: () => loads };
}

test('caller ICE restart refreshes configuration and delivers a new SDP offer through existing signalling', async () => {
  const t = call();
  try {
    await t.service.restartCallIce();
    assert.equal(t.loads(), 1); assert.equal(t.configurations.length, 1);
    assert.deepEqual(t.offers, [{ iceRestart: true }]);
    assert.equal(t.sent[0].type, 'offer'); assert.equal(t.sent[0].conversationId, 'room');
    assert.equal(t.sent[0].callerId, 'caller'); assert.equal(t.sent[0].sdp.type, 'offer');
    await t.service.handleCallSignal(t.pc, { type: 'answer', sdp: { type: 'answer', sdp: 'a=ice-ufrag:remote' } });
    assert.equal(t.pc.signalingState, 'stable');
    t.service.recovered(); assert.equal(t.service.getState(), 'connected'); assert.equal(t.service.restartTimer, null);
  } finally { t.service.cleanup(); }
});

test('callee requests restart rather than sending a competing offer; caller handles request', async () => {
  const callee = call(false), caller = call();
  try {
    await callee.service.restartCallIce();
    assert.equal(callee.offers.length, 0); assert.equal(callee.sent[0].type, 'ice-restart-request');
    let scheduled = false; caller.service.scheduleRestart = () => { scheduled = true; };
    await caller.service.handleCallSignal(caller.pc, callee.sent[0]); assert(scheduled);
    await caller.service.restartCallIce();
    await callee.service.handleCallSignal(callee.pc, caller.sent[0]);
    assert.equal(callee.sent.at(-1).type, 'answer'); assert.equal(callee.loads(), 1);
    await caller.service.handleCallSignal(caller.pc, callee.sent.at(-1));
    assert.equal(caller.pc.signalingState, 'stable'); assert.equal(callee.pc.signalingState, 'stable');
  } finally { callee.service.cleanup(); caller.service.cleanup(); }
});

test('overlapping restart offers are serialized and stale peer callbacks cannot emit', async () => {
  const t = call();
  try {
    await Promise.all([t.service.sendOffer(true), t.service.sendOffer(true), t.service.sendOffer(true)]);
    assert.equal(t.offers.length, 1); assert.equal(t.sent.length, 1);
    const old = t.pc; t.service.cleanup();
    await t.service.handleCallSignal(old, { type: 'call-accept' });
    assert.equal(t.offers.length, 1);
  } finally { t.service.cleanup(); }
});

test('restart candidates are buffered by ICE username fragment and not added against stale SDP', async () => {
  const t = call(false);
  try {
    t.pc.remoteDescription = { type: 'offer', sdp: 'a=ice-ufrag:old' };
    const candidate = { candidate: 'test-candidate', usernameFragment: 'new-local' };
    await t.service.handleCallSignal(t.pc, { type: 'ice-candidate', candidate });
    assert.equal(t.candidates.length, 0);
    await t.service.handleCallSignal(t.pc, { type: 'offer', conversationId: 'room', sdp: { type: 'offer', sdp: 'a=ice-ufrag:new-local' } });
    assert.deepEqual(t.candidates, [candidate]); assert.equal(t.service.pendingIceCandidates.length, 0);
  } finally { t.service.cleanup(); }
});

test('failed signal acknowledgement is not reported as delivered and restart attempts are bounded', async () => {
  const t = call();
  try {
    t.service.callChannel.send = async () => 'timed out';
    await assert.rejects(t.service.sendOffer(true), /acknowledged/);
    t.service.restartAttempts = 3;
    await t.service.restartCallIce();
    assert.equal(t.service.getState(), 'failed'); assert.equal(t.pc.signalingState, 'closed');
    assert.equal(t.service.restartTimer, null); assert.equal(t.service.credentialTimer, null);
  } finally { t.service.cleanup(); }
});

test('STUN fallback retains Cloudflare/Google and contains no credentials', () => {
  const servers = getIceServers();
  assert(servers.some((server) => server.urls === 'stun:stun.cloudflare.com:3478'));
  assert(servers.every((server) => !server.username && !server.credential && /^stun:/.test(server.urls)));
});

// Exercise the actual persistence wrapper, not a model of idempotency.
test('ambiguous send uses stable existing messages PK; receipt lookup does not overwrite ciphertext', async () => {
  const stored = new Map(); let writes = 0;
  const backend = {
    auth: {
      async getSession() { return { data: { session: { user: { id: 'user' } } }, error: null }; },
      async getUser() { return { data: { user: { id: 'user' } }, error: null }; },
    },
    from(table) {
      assert.equal(table, 'messages'); let value, filters = {};
      const q = {
        insert(row) { writes++; value = row; return q; }, select() { return q; },
        eq(key, v) { filters[key] = v; return q; },
        async single() {
          if (!stored.has(value.id)) stored.set(value.id, value);
          return { data: null, error: { code: '23505', message: 'ambiguous response' } };
        },
        async maybeSingle() {
          const row = stored.get(filters.id);
          return { data: row && row.conversation_id === filters.conversation_id && row.sender_id === filters.sender_id ? row : null, error: null };
        },
      }; return q;
    },
  };
  const { persistConversationMessage } = await loadModule('src/services/supabaseService.ts', backend);
  const first = await persistConversationMessage('room', 'original-cipher', 'nonce', null, 'stable-id', 'user');
  const retry = await persistConversationMessage('room', 'different-cipher', 'different-nonce', null, 'stable-id', 'user');
  assert.equal(writes, 2); assert.equal(stored.size, 1);
  assert.equal(first.id, retry.id); assert.equal(retry.ciphertext, 'original-cipher');
  await assert.rejects(persistConversationMessage('room', 'cipher', 'nonce', null, 'another-id', 'other-account'), /Authentication/);
});

test('identity bootstrap preserves existing ghost privacy/profile instead of resetting them on sign-in', async () => {
  const profile = { id: 'user', display_name: 'Saved name', privacy_setting: 'ghost', bio: 'Saved bio', identity_public_key: 'old-key' };
  const backend = {
    from(table) {
      assert.equal(table, 'profiles');
      const query = {
        async upsert(_defaults, options) { assert.equal(options.ignoreDuplicates, true); return { error: null }; },
        update(values) { assert.deepEqual(Object.keys(values), ['identity_public_key']); Object.assign(profile, values); return query; },
        select() { return query; }, eq(column, id) { assert.equal(column, 'id'); assert.equal(id, 'user'); return query; },
        async maybeSingle() { return { data: profile, error: null }; },
        then(resolve, reject) { return Promise.resolve({ error: null }).then(resolve, reject); },
      }; return query;
    },
  };
  const { ensureSupabaseProfile } = await loadModule('src/services/supabaseService.ts', backend);
  const result = await ensureSupabaseProfile('user', { displayName: 'Default name', privacySetting: 'fuzzy_500m' }, 'new-key');
  assert.equal(result.privacy_setting, 'ghost'); assert.equal(result.display_name, 'Saved name');
  assert.equal(result.bio, 'Saved bio'); assert.equal(result.identity_public_key, 'new-key');
});

test('one-shot signalling is cleaned on failure/teardown and cannot send after replacement', async () => {
  const channels = [], removed = [];
  const backend = {
    channel() {
      const channel = { sends: 0, subscribe(callback) { channel.status = callback; return channel; }, async send() { channel.sends++; return 'ok'; } };
      channels.push(channel); return channel;
    }, async removeChannel(channel) { removed.push(channel); return 'ok'; },
  };
  const { WebRTCCallService: Service } = await loadModule('src/services/webrtcService.ts', backend);
  const service = new Service();
  const pending = service.sendTransientSignal('target', { type: 'call-request' });
  service.cleanup(); channels[0].status('SUBSCRIBED');
  await assert.rejects(pending, /ended/);
  assert.equal(channels[0].sends, 0); assert.equal(removed.length, 1);
  const failed = service.sendTransientSignal('target', { type: 'call-request' });
  channels[1].status('CHANNEL_ERROR'); await assert.rejects(failed, /unavailable/);
  const success = service.sendTransientSignal('target', { type: 'call-request' });
  channels[2].status('SUBSCRIBED'); channels[2].status('SUBSCRIBED'); await success;
  assert.equal(channels[2].sends, 1); assert.equal(removed.length, 3); service.cleanup();
});

test('a late hangup ACK cannot tear down a replacement call', async () => {
  const t = call(); let acknowledge;
  t.service.callChannel.send = () => new Promise((resolve) => { acknowledge = resolve; });
  const ending = t.service.endCall();
  t.service.cleanup();
  let closed = false;
  const replacement = { ...t.pc, close() { closed = true; } };
  t.service.pc = replacement; t.service.setState('connecting');
  acknowledge('ok'); await ending;
  assert.equal(t.service.pc, replacement); assert.equal(closed, false);
  assert.equal(t.service.getState(), 'connecting'); t.service.cleanup();
});
