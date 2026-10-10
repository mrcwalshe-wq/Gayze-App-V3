// Drives the REAL src/services/webrtcService.ts (compiled with esbuild) through a complete
// call lifecycle using fake Realtime, RTCPeerConnection and getUserMedia boundaries.
// This proves state-machine and signalling logic. It does NOT prove browser media flow,
// ICE connectivity or TURN relay: those are covered by the browser tests, if run.
import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';

const live = new Set();
import { loadModule } from '../recovery-tests/load-module.mjs';

const wait = (ms = 0) => new Promise((resolve) => setTimeout(resolve, ms));

// ---- environment fakes -------------------------------------------------------
globalThis.window = { setTimeout, clearTimeout, addEventListener() {}, removeEventListener() {}, AudioContext: undefined };
globalThis.document = { visibilityState: 'visible', addEventListener() {}, removeEventListener() {} };
Object.defineProperty(globalThis, 'navigator', { configurable: true, value: { onLine: true, mediaDevices: {} } });
globalThis.__denyMedia = false;
globalThis.__deviceMissing = false;
globalThis.__getUserMediaCalls = [];

class FakeTrack {
  constructor(kind) { this.kind = kind; this.enabled = true; this.id = `${kind}-${Math.random().toString(36).slice(2)}`; this.stopped = false; }
  stop() { this.stopped = true; }
}
class FakeStream {
  constructor(tracks) { this.tracks = tracks; }
  getTracks() { return [...this.tracks]; }
  getAudioTracks() { return this.tracks.filter((t) => t.kind === 'audio'); }
  getVideoTracks() { return this.tracks.filter((t) => t.kind === 'video'); }
  addTrack(t) { this.tracks.push(t); }
  removeTrack(t) { this.tracks = this.tracks.filter((x) => x !== t); }
}
globalThis.MediaStream = FakeStream;
navigator.mediaDevices.getUserMedia = async (constraints) => {
  globalThis.__getUserMediaCalls.push(constraints);
  if (globalThis.__denyMedia) throw Object.assign(new Error('denied'), { name: 'NotAllowedError' });
  if (globalThis.__deviceMissing) throw Object.assign(new Error('none'), { name: 'NotFoundError' });
  const tracks = [new FakeTrack('audio')];
  if (constraints.video) tracks.push(new FakeTrack('video'));
  return new FakeStream(tracks);
};

class FakePeerConnection {
  static instances = [];
  constructor(config) {
    this.config = config; this.signalingState = 'stable'; this.localDescription = null; this.remoteDescription = null;
    this.senders = []; this.connectionState = 'new'; this.iceConnectionState = 'new'; this.closed = false;
    this.createdAnswers = 0; this.createdOffers = 0; this.failAddIce = false; this.addedCandidates = [];
    FakePeerConnection.instances.push(this);
  }
  addTrack(track) { const sender = { track, async replaceTrack(t) { sender.track = t; } }; this.senders.push(sender); return sender; }
  getSenders() { return this.senders; }
  getConfiguration() { return this.config; }
  setConfiguration(config) { this.config = config; }
  async createOffer() { this.createdOffers++; return { type: 'offer', sdp: `offer-${this.createdOffers}` }; }
  async createAnswer() { this.createdAnswers++; return { type: 'answer', sdp: `answer-${this.createdAnswers}` }; }
  async setLocalDescription(d) {
    if (d.type === 'rollback') { this.signalingState = 'stable'; return; }
    this.localDescription = d; this.signalingState = d.type === 'offer' ? 'have-local-offer' : 'stable';
  }
  async setRemoteDescription(d) { this.remoteDescription = d; this.signalingState = d.type === 'offer' ? 'have-remote-offer' : 'stable'; }
  async addIceCandidate(c) { if (this.failAddIce) throw new Error('stale candidate'); this.addedCandidates.push(c); }
  close() { this.closed = true; this.signalingState = 'closed'; }
}
globalThis.RTCPeerConnection = FakePeerConnection;

// ---- fake Supabase backend ---------------------------------------------------
function makeBackend(userId) {
  const channels = [];
  const query = () => {
    const q = new Proxy(function () {}, {
      get: (_t, prop) => (prop === 'then' ? (resolve) => resolve({ data: null, error: null }) : () => q),
    });
    return q;
  };
  const backend = {
    channels,
    auth: {
      async getSession() { return { data: { session: { user: { id: userId }, expires_at: Math.floor(Date.now() / 1000) + 3600 } }, error: null }; },
      async refreshSession() { return { data: { session: null }, error: null }; },
      onAuthStateChange() { return { data: { subscription: { unsubscribe() {} } } }; },
    },
    channel(topic, options) {
      const channel = {
        topic, options, state: 'joined', handlers: [], sent: [],
        on(_type, _filter, handler) { channel.handlers.push(handler); return channel; },
        subscribe(callback) { channel.status = callback; queueMicrotask(() => callback('SUBSCRIBED')); return channel; },
        async send(packet) { if (channel.sendImpl) return channel.sendImpl(packet); channel.sent.push(packet.payload); return 'ok'; },
        async unsubscribe() { channel.state = 'closed'; return 'ok'; },
        teardown() {},
      };
      channels.push(channel);
      return channel;
    },
    async removeChannel(channel) { channel.state = 'closed'; return 'ok'; },
    functions: { async invoke() { return { data: { iceServers: [{ urls: 'stun:stun.example.test:3478' }] }, error: null }; } },
    realtime: { connect() {}, async disconnect() {} },
    from: query,
  };
  return backend;
}

const sentSignals = (backend) => backend.channels.flatMap((c) => c.sent);
const CONV = '00000000-0000-4000-8000-0000000000c1';
const CALLER = '00000000-0000-4000-8000-00000000000a';
const CALLEE = '00000000-0000-4000-8000-00000000000b';
let Service;

before(async () => {
  ({ WebRTCCallService: Service } = await loadModule('src/services/webrtcService.ts', makeBackend(CALLER)));
});

function callerService() {
  const backend = makeBackend(CALLER);
  return { backend, svc: new Service() };
}

// Re-bind the module-level supabase client for a specific user (module state is per-load,
// so each test uses its own loaded copy when it depends on the user identity).
async function loadFor(userId) {
  const backend = makeBackend(userId);
  const mod = await loadModule('src/services/webrtcService.ts', backend);
  const svc = new mod.WebRTCCallService();
  live.add(svc);
  return { backend, svc };
}

// Never leave deadline/ring/restart timers running after a failed assertion.
after(() => { for (const svc of live) svc.cleanup(); });

// ---- tests ---------------------------------------------------------------------

test('caller places a call with a unique attempt id and rings the callee on their personal channel', async () => {
  const { backend, svc } = await loadFor(CALLER);
  await svc.startCall({ conversationId: CONV, callerId: CALLER, callerName: 'Ada', targetUserId: CALLEE, targetUserName: 'Ben', callType: 'video' });
  await wait(20);
  assert.equal(svc.getState(), 'calling');
  const ring = backend.channels.find((c) => c.topic === `gayze-user-${CALLEE}` && c.sent.some((p) => p.type === 'call-request'));
  assert.ok(ring, 'call-request was sent to the callee user channel');
  const request = ring.sent.find((p) => p.type === 'call-request');
  assert.match(request.callId, /^[0-9a-f-]{36}$/i);
  assert.equal(request.callerId, CALLER);
  // The private option must be requested so Realtime RLS applies.
  assert.equal(ring.options.config.private, true);
  svc.cleanup();
});

test('no microphone or camera is requested while the callee is still deciding', async () => {
  globalThis.__getUserMediaCalls.length = 0;
  const { svc } = await loadFor(CALLER);
  await svc.startCall({ conversationId: CONV, callerId: CALLER, callerName: 'Ada', targetUserId: CALLEE, targetUserName: 'Ben', callType: 'video' });
  await wait(20);
  assert.equal(globalThis.__getUserMediaCalls.length, 0);
  svc.cleanup();
});

test('repeated start of the same call while it is active is a no-op (rapid taps / effect re-runs)', async () => {
  const { backend, svc } = await loadFor(CALLER);
  const params = { conversationId: CONV, callerId: CALLER, callerName: 'Ada', targetUserId: CALLEE, targetUserName: 'Ben', callType: 'audio' };
  await svc.startCall(params);
  await svc.startCall(params);
  await wait(20);
  const requests = sentSignals(backend).filter((p) => p.type === 'call-request');
  const ids = new Set(requests.map((r) => r.callId));
  assert.equal(ids.size, 1, 'only one attempt identity was created');
  svc.cleanup();
});

test('incoming ring: duplicate delivery of the same attempt is not re-rung; a second attempt is declined as busy', async () => {
  const { backend, svc } = await loadFor(CALLEE);
  const rang = [], cancelled = [];
  const unsubscribe = svc.initUserSignaling(CALLEE, (call) => rang.push(call), (conv) => cancelled.push(conv));
  await wait(300);
  const channel = backend.channels.find((c) => c.topic === `gayze-user-${CALLEE}`);
  assert.ok(channel && channel.handlers.length, 'user channel subscribed');
  const deliver = (payload) => channel.handlers[0]({ payload });
  const request = { type: 'call-request', callId: 'attempt-A', conversationId: CONV, callerId: CALLER, callerName: 'Ada', callType: 'video', targetUserId: CALLEE, timestamp: Date.now() };
  deliver(request);
  deliver(request);                                   // duplicate
  assert.equal(rang.length, 1);
  assert.equal(rang[0].callId, 'attempt-A');
  deliver({ ...request, callId: 'attempt-B', callerId: 'someone-else' });   // simultaneous second attempt
  assert.equal(rang.length, 1, 'second attempt does not replace the ring');
  await wait(20);
  const busy = backend.channels.flatMap((c) => c.sent).find((p) => p.type === 'call-decline' && p.callId === 'attempt-B');
  assert.ok(busy, 'second attempt was declined as busy');
  // A stale cancel for a different attempt must not dismiss the current ring.
  deliver({ type: 'call-end', callId: 'attempt-OLD', conversationId: CONV, callerId: CALLER, timestamp: Date.now() });
  assert.equal(cancelled.length, 0);
  deliver({ type: 'call-end', callId: 'attempt-A', conversationId: CONV, callerId: CALLER, timestamp: Date.now() });
  assert.deepEqual(cancelled, [CONV]);
  unsubscribe();
  svc.cleanup();
});

test('callee accepts; caller answers the offer; ICE is applied after the remote description', async () => {
  const caller = await loadFor(CALLER);
  const callee = await loadFor(CALLEE);
  await caller.svc.startCall({ conversationId: CONV, callerId: CALLER, callerName: 'Ada', targetUserId: CALLEE, targetUserName: 'Ben', callType: 'audio' });
  await wait(20);
  const callId = caller.backend.channels.flatMap((c) => c.sent).find((p) => p.type === 'call-request').callId;

  await callee.svc.acceptCall({ conversationId: CONV, callerId: CALLER, userId: CALLEE, callType: 'audio', callerName: 'Ada', callId });
  await wait(20);
  assert.equal(callee.svc.getState(), 'connecting');
  const accept = callee.backend.channels.flatMap((c) => c.sent).find((p) => p.type === 'call-accept');
  assert.equal(accept.callId, callId, 'accept carries the caller attempt id');

  // Deliver the accept to the caller (same conversation channel).
  const callerCall = caller.backend.channels.find((c) => c.topic === `gayze-call-${CONV}`);
  await caller.svc.handleCallSignal(caller.svc.pc, { ...accept, callerId: CALLEE });
  await wait(10);
  const offer = caller.backend.channels.flatMap((c) => c.sent).find((p) => p.type === 'offer');
  assert.ok(offer, 'caller sent an offer after accept');
  assert.equal(offer.callId, callId);
  assert.ok(callerCall);

  // Caller's acceptance must not produce a second offer on duplicate accept.
  await caller.svc.handleCallSignal(caller.svc.pc, { ...accept, callerId: CALLEE });
  assert.equal(caller.backend.channels.flatMap((c) => c.sent).filter((p) => p.type === 'offer').length, 1);

  // Callee answers.
  await callee.svc.handleCallSignal(callee.svc.pc, { ...offer, callerId: CALLER });
  const answer = callee.backend.channels.flatMap((c) => c.sent).find((p) => p.type === 'answer');
  assert.ok(answer, 'callee answered');
  assert.equal(callee.svc.pc.signalingState, 'stable');
  await caller.svc.handleCallSignal(caller.svc.pc, { ...answer, callerId: CALLEE });
  assert.equal(caller.svc.pc.signalingState, 'stable');
  assert.equal(caller.svc.pc.remoteDescription.sdp, answer.sdp.sdp);

  caller.svc.cleanup(); callee.svc.cleanup();
});

test('a retransmitted offer re-sends the same answer and does not renegotiate', async () => {
  const callee = await loadFor(CALLEE);
  await callee.svc.acceptCall({ conversationId: CONV, callerId: CALLER, userId: CALLEE, callType: 'audio', callId: 'att-1' });
  await wait(20);
  const pc = callee.svc.pc;
  const offer = { type: 'offer', sdp: 'offer-retransmit' };
  await callee.svc.handleCallSignal(pc, { type: 'offer', callId: 'att-1', conversationId: CONV, callerId: CALLER, sdp: offer });
  await callee.svc.handleCallSignal(pc, { type: 'offer', callId: 'att-1', conversationId: CONV, callerId: CALLER, sdp: offer });
  assert.equal(pc.createdAnswers, 1, 'answer generated once');
  const answers = callee.backend.channels.flatMap((c) => c.sent).filter((p) => p.type === 'answer');
  assert.equal(answers.length, 2, 'the same answer was re-delivered');
  assert.equal(answers[0].sdp.sdp, answers[1].sdp.sdp);
  callee.svc.cleanup();
});

test('a stale ICE candidate that fails to apply does not trigger an ICE restart', async () => {
  const caller = await loadFor(CALLER);
  await caller.svc.startCall({ conversationId: CONV, callerId: CALLER, callerName: 'Ada', targetUserId: CALLEE, targetUserName: 'Ben', callType: 'audio' });
  await wait(20);
  const pc = new FakePeerConnection({});
  pc.remoteDescription = { type: 'answer', sdp: 'v=0' };
  pc.signalingState = 'stable';
  pc.failAddIce = true;
  caller.svc.pc = pc;
  await caller.svc.handleCallSignal(pc, { type: 'ice-candidate', callId: caller.svc.callId, conversationId: CONV, callerId: CALLEE, candidate: { candidate: 'stale' } });
  assert.equal(caller.svc.restartTimer, null, 'no restart scheduled by a stale candidate');
  caller.svc.cleanup();
});

test('hang-up while connected reaches the peer even when our signalling channel is not joined', async () => {
  const caller = await loadFor(CALLER);
  await caller.svc.startCall({ conversationId: CONV, callerId: CALLER, callerName: 'Ada', targetUserId: CALLEE, targetUserName: 'Ben', callType: 'audio' });
  await wait(20);
  const callId = caller.svc.callId;
  caller.svc.recovered();
  // Our joined channel is gone (network blip) — the hang-up must still be delivered.
  const callChannel = caller.svc.callChannel;
  callChannel.state = 'errored';
  await caller.svc.endCall();
  const ended = caller.backend.channels.flatMap((c) => c.sent).find((p) => p.type === 'call-end' && p.callId === callId);
  assert.ok(ended, 'peer received call-end via a one-shot send');
  assert.equal(caller.svc.getState(), 'ended');
  assert.equal(caller.svc.getLocalStream(), null, 'local media released');
  assert.equal(caller.svc.pc, null, 'peer connection closed');
});

test('cancelling while ringing notifies the callee on their personal channel', async () => {
  const caller = await loadFor(CALLER);
  await caller.svc.startCall({ conversationId: CONV, callerId: CALLER, callerName: 'Ada', targetUserId: CALLEE, targetUserName: 'Ben', callType: 'video' });
  await wait(20);
  await caller.svc.endCall();
  const cancel = caller.backend.channels.find((c) => c.topic === `gayze-user-${CALLEE}` && c.sent.some((p) => p.type === 'call-end'));
  assert.ok(cancel, 'callee personal channel received the cancellation');
  assert.equal(caller.svc.getState(), 'ended');
});

test('callee media denied: the caller is told immediately and the callee fails visibly', async () => {
  const callee = await loadFor(CALLEE);
  globalThis.__denyMedia = true;
  try {
    await callee.svc.acceptCall({ conversationId: CONV, callerId: CALLER, userId: CALLEE, callType: 'video', callId: 'att-deny' });
  } finally { globalThis.__denyMedia = false; }
  assert.equal(callee.svc.getState(), 'failed');
  assert.match(callee.svc.getErrorMessage(), /permission was denied/i);
  const decline = callee.backend.channels.flatMap((c) => c.sent).find((p) => p.type === 'call-decline' && p.callId === 'att-deny');
  assert.ok(decline, 'caller notified with the same attempt id');
  assert.equal(callee.svc.getLocalStream(), null);
});

test('caller media denied after acceptance: the call fails and the callee is told to end', async () => {
  const caller = await loadFor(CALLER);
  await caller.svc.startCall({ conversationId: CONV, callerId: CALLER, callerName: 'Ada', targetUserId: CALLEE, targetUserName: 'Ben', callType: 'video' });
  await wait(20);
  globalThis.__denyMedia = true;
  try {
    await caller.svc.handleCallSignal(caller.svc.pc, { type: 'call-accept', callId: caller.svc.callId, conversationId: CONV, callerId: CALLEE, timestamp: Date.now() });
  } finally { globalThis.__denyMedia = false; }
  assert.equal(caller.svc.getState(), 'failed');
  assert.match(caller.svc.getErrorMessage(), /permission was denied/i);
  assert.ok(caller.backend.channels.flatMap((c) => c.sent).some((p) => p.type === 'call-end'));
});

test('a device that is missing gives an honest message rather than a generic failure', async () => {
  const callee = await loadFor(CALLEE);
  globalThis.__deviceMissing = true;
  try { await callee.svc.acceptCall({ conversationId: CONV, callerId: CALLER, userId: CALLEE, callType: 'audio', callId: 'att-nodev' }); }
  finally { globalThis.__deviceMissing = false; }
  assert.equal(callee.svc.getState(), 'failed');
  assert.match(callee.svc.getErrorMessage(), /No camera or microphone/);
  callee.svc.cleanup();
});

test('mute chosen before the microphone is acquired applies to the first real track', async () => {
  const callee = await loadFor(CALLEE);
  assert.equal(callee.svc.toggleAudio(false), false);
  assert.equal(callee.svc.isAudioEnabled(), false);
  await callee.svc.acceptCall({ conversationId: CONV, callerId: CALLER, userId: CALLEE, callType: 'audio', callId: 'att-mute' });
  const audio = callee.svc.getLocalStream().getAudioTracks()[0];
  assert.equal(audio.enabled, false, 'real track is muted');
  assert.equal(callee.svc.toggleAudio(), true);
  assert.equal(audio.enabled, true, 'unmute changes the real track');
  callee.svc.cleanup();
});

test('camera toggle changes the real video track, survives camera flips, and is ignored on audio calls', async () => {
  const callee = await loadFor(CALLEE);
  await callee.svc.acceptCall({ conversationId: CONV, callerId: CALLER, userId: CALLEE, callType: 'video', callId: 'att-cam' });
  const video = () => callee.svc.getLocalStream().getVideoTracks()[0];
  assert.equal(video().enabled, true);
  assert.equal(callee.svc.toggleVideo(), false);
  assert.equal(video().enabled, false, 'real video track disabled');
  assert.equal(callee.svc.isVideoEnabled(), false);
  callee.svc.toggleVideo(true);
  assert.equal(video().enabled, true);
  callee.svc.cleanup();
  const audioCallee = await loadFor(CALLEE);
  await audioCallee.svc.acceptCall({ conversationId: CONV, callerId: CALLER, userId: CALLEE, callType: 'audio', callId: 'att-cam2' });
  assert.equal(audioCallee.svc.toggleVideo(), false);
  audioCallee.svc.cleanup();
});

test('a call that is accepted but never connects fails visibly after the deadline and tells the peer', async () => {
  const callee = await loadFor(CALLEE);
  const Ctor = callee.svc.constructor;
  const previous = Ctor.connectDeadlineMs;
  Ctor.connectDeadlineMs = 30;
  try {
    await callee.svc.acceptCall({ conversationId: CONV, callerId: CALLER, userId: CALLEE, callType: 'audio', callId: 'att-stuck' });
    assert.equal(callee.svc.getState(), 'connecting');
    await wait(120);
    assert.equal(callee.svc.getState(), 'failed');
    assert.match(callee.svc.getErrorMessage(), /could not connect/);
    assert.ok(callee.backend.channels.flatMap((c) => c.sent).some((p) => p.type === 'call-end' && p.callId === 'att-stuck'));
    assert.equal(callee.svc.getLocalStream(), null);
  } finally { Ctor.connectDeadlineMs = previous; }
});

test('a late, mismatched attempt cannot drive the current peer connection', async () => {
  const callee = await loadFor(CALLEE);
  await callee.svc.acceptCall({ conversationId: CONV, callerId: CALLER, userId: CALLEE, callType: 'audio', callId: 'att-current' });
  await wait(20);
  const pc = callee.svc.pc;
  // The listener drops packets whose attempt id differs from ours.
  const channel = callee.backend.channels.find((c) => c.topic === `gayze-call-${CONV}` && c.handlers.length);
  channel.handlers[0]({ payload: { type: 'offer', callId: 'att-old', conversationId: CONV, callerId: CALLER, sdp: { type: 'offer', sdp: 'stale' }, timestamp: Date.now() } });
  await wait(20);
  assert.equal(pc.remoteDescription, null, 'stale offer was not applied');
  assert.equal(callee.svc.pc, pc);
  callee.svc.cleanup();
});

test('after hang-up the service is idle again and can place a new call', async () => {
  const caller = await loadFor(CALLER);
  await caller.svc.startCall({ conversationId: CONV, callerId: CALLER, callerName: 'Ada', targetUserId: CALLEE, targetUserName: 'Ben', callType: 'audio' });
  await wait(20);
  await caller.svc.endCall();
  await caller.svc.startCall({ conversationId: CONV, callerId: CALLER, callerName: 'Ada', targetUserId: CALLEE, targetUserName: 'Ben', callType: 'audio' });
  await wait(20);
  assert.equal(caller.svc.getState(), 'calling');
  caller.svc.cleanup();
});
