import { supabase } from './supabaseClient';
import { IceCredentialCache } from './iceCredentials';
import { RealtimeRecovery, callRecoveryEnvironment, requireRealtimeSession } from './realtimeRecovery';
import { analytics } from './analyticsService';
import { saveCallRecord, markCallAsMissed } from './callHistoryService';
import type { RealtimeChannel } from '@supabase/supabase-js';

export type CallState =
  | 'idle'
  | 'calling'
  | 'ringing'
  | 'connecting'
  | 'connected'
  | 'declined'
  | 'missed'
  | 'ended'
  | 'failed';

export type CallType = 'audio' | 'video';
export type UpgradePhase = 'idle' | 'requesting' | 'incoming' | 'active' | 'declined' | 'failed';

export interface IncomingCall {
  conversationId: string;
  callerId: string;
  callerName: string;
  callType: CallType;
  timestamp: number;
  targetUserId?: string;
  callId?: string;
}

export interface CallSignalPayload {
  type:
    | 'call-request'
    | 'call-ringing'
    | 'call-accept'
    | 'call-decline'
    | 'call-end'
    | 'offer'
    | 'answer'
    | 'ice-candidate'
    | 'ice-candidates'
    | 'ice-restart-request'
    | 'video-request'
    | 'video-accept'
    | 'video-decline'
    | 'renegotiate';
  conversationId: string;
  callerId: string;
  callerName?: string;
  targetUserId?: string;
  callType?: CallType;
  sdp?: RTCSessionDescriptionInit;
  candidate?: RTCIceCandidateInit;
  /** Several candidates in one message, so a burst cannot trip the realtime message-rate limit. */
  candidates?: RTCIceCandidateInit[];
  timestamp: number;
  callId?: string;
}

const LOG_KEY = 'gayze_call_log';
/** The last few dozen call events (states, signals, errors) kept on this device, so a failed call can be diagnosed. No SDP, keys or message content. */
export function callLog(event: string): void {
  try {
    const raw = localStorage.getItem(LOG_KEY);
    const entries: string[] = raw ? JSON.parse(raw) : [];
    entries.push(`${new Date().toISOString().slice(11, 23)} ${event}`);
    localStorage.setItem(LOG_KEY, JSON.stringify(entries.slice(-120)));
  } catch { /* storage unavailable */ }
  queueServerLog(event);
}
/**
 * The same events are also sent to the server (call id, time, the short text above; no SDP, keys, names or messages), so a call that
 * fails on someone's phone can be diagnosed without asking them to copy the log. At most ~200 events per call per person.
 */
let callIdSource: () => string | null = () => null;
export function registerCallLogSource(fn: () => string | null): void { callIdSource = fn; }
const serverQueue: { callId: string; event: string }[] = [];
let serverTimer: ReturnType<typeof setTimeout> | null = null;
function queueServerLog(event: string): void {
  const callId = callIdSource();
  if (!callId || !supabase) return;
  if (serverQueue.length < 60) serverQueue.push({ callId, event: event.slice(0, 160) });
  if (serverTimer) return;
  // Next tick, not 1.5 s later: a phone that is about to be suspended (answered from the lock screen) never reaches a delayed timer.
  serverTimer = setTimeout(async () => {
    serverTimer = null;
    const batch = serverQueue.splice(0, serverQueue.length);
    await Promise.all(batch.map((item) => Promise.resolve(supabase!.rpc('log_call_event', { p_call_id: item.callId, p_event: item.event })).catch(() => undefined)));
  }, 0);
}

export function readCallLog(): string {
  try { return (JSON.parse(localStorage.getItem(LOG_KEY) || '[]') as string[]).join('\n'); } catch { return ''; }
}

export function getIceServers(): RTCIceServer[] {
  // VITE_* is public build output. Overrides may contain STUN URLs only;
  // Cloudflare TURN credentials always come from the authenticated function.
  const defaults = [
    { urls: 'stun:stun.cloudflare.com:3478' },
    { urls: 'stun:stun.l.google.com:19302' },
    { urls: 'stun:stun1.l.google.com:19302' },
    { urls: 'stun:stun2.l.google.com:19302' },
    { urls: 'stun:stun3.l.google.com:19302' },
  ];
  try {
    const parsed = JSON.parse(import.meta.env.VITE_ICE_SERVERS_JSON || '[]');
    if (Array.isArray(parsed)) {
      const urls = parsed.flatMap((entry) => Array.isArray(entry.urls) ? entry.urls : [entry.urls])
        .filter((url): url is string => typeof url === 'string' && /^stuns?:/.test(url));
      if (urls.length) return urls.map((url) => ({ urls: url }));
    }
  } catch { /* Never log a malformed env value which might contain a secret. */ }
  return defaults;
}

export class WebRTCCallService {
  private localStream: MediaStream | null = null;
  private remoteStream: MediaStream | null = null;
  private pc: RTCPeerConnection | null = null;
  private callChannel: RealtimeChannel | null = null;

  private state: CallState = 'idle';
  private errorMessage: string | null = null;
  private currentFacingMode: 'user' | 'environment' = 'user';
  private currentCallType: CallType = 'video';
  private activeConversationId: string | null = null;
  private activeCallId: string | null = null;
  public currentCallId(): string | null { return this.activeCallId; }
  /** The other person ended or declined, learned from the server instead of the live signal. */
  public remoteEnded(state: 'declined' | 'ended'): void { callLog(`call ${state} (learned from the server)`); this.cleanup(); this.setState(state); }
  /**
   * The server says the other person answered, but the live "accept" never reached this phone (it was still ringing here, or the
   * call channel was mid-join). Carry on exactly as if the accept had arrived. Safe to call at any time: it only acts while this
   * phone is the caller and still shows calling / ringing.
   */
  public remoteAnswered(): void {
    const pc = this.pc;
    if (!pc || !this.caller || (this.state !== 'calling' && this.state !== 'ringing')) return;
    callLog('call answered (learned from the server)');
    void this.handleCallSignal(pc, { type: 'call-accept', conversationId: this.activeConversationId ?? '', callerId: this.activeTargetUserId ?? '', timestamp: Date.now() } as CallSignalPayload).catch(() => undefined);
  }
  private activeTargetUserId: string | null = null;
  private ringingTimeoutTimer: number | null = null;
  private pendingIceCandidates: RTCIceCandidateInit[] = [];
  private resolvedIceServers: RTCIceServer[] | null = null;
  
  // Call history tracking
  private callStartTime: number | null = null;
  private callDirection: 'incoming' | 'outgoing' = 'outgoing';
  private callerNameForHistory: string | null = null;
  private targetUserNameForHistory: string | null = null;

  private credentialTimer: ReturnType<typeof setTimeout> | null = null;
  private restartTimer: ReturnType<typeof setTimeout> | null = null;
  private restartAttempts = 0;
  private offering = false;
  private caller = false;
  private localUserId = '';
  private callRecovery: RealtimeRecovery | null = null;
  private userRecovery: RealtimeRecovery | null = null;
  private callGeneration = 0;
  private transientSignals = new Set<() => void>();
  private audioEnabled = true;
  private videoEnabled = true;
  private iceCache = new IceCredentialCache(async () => {
    if (!supabase) throw new Error('Call service unavailable');
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 10_000);
    try {
      const { data, error } = await supabase.functions.invoke('webrtc-ice-servers', { body: {}, signal: controller.signal });
      if (error) throw new Error('Relay credential request failed');
      return data;
    } finally { clearTimeout(timer); }
  });

  private async loadIceServers(force = false): Promise<RTCIceServer[]> {
    const generation = this.callGeneration;
    let servers: RTCIceServer[];
    try { servers = await this.iceCache.get(force); }
    catch {
      // Preserve STUN fallback, but never cache a failed request permanently.
      servers = getIceServers();
    }
    if (generation !== this.callGeneration) throw new Error('Call ended');
    this.resolvedIceServers = servers;
    this.scheduleCredentialRefresh();
    return servers;
  }

  private scheduleCredentialRefresh() {
    if (this.credentialTimer) clearTimeout(this.credentialTimer);
    if (!this.activeConversationId) return;
    // Legacy responses without TTL are not cached; re-fetch before every
    // negotiation and revalidate every 30s while active. Known expiry refreshes
    // early. An explicit expiresAt/ttl is required for an exact expiry guarantee.
    const delay = this.iceCache.nextRefreshAt > Date.now()
      ? this.iceCache.nextRefreshAt - Date.now() : 30_000;
    this.credentialTimer = setTimeout(() => {
      this.credentialTimer = null;
      const pc = this.pc;
      void this.loadIceServers().then((servers) => {
        if (pc && pc === this.pc && pc.signalingState !== 'closed') pc.setConfiguration({ ...pc.getConfiguration(), iceServers: servers });
      }).catch(() => undefined);
    }, Math.max(1000, Math.min(delay, 2_147_000_000)));
  }

  constructor() {
    if (typeof window !== 'undefined') {
      // Whether the phone put the page to sleep or lost its connection during a call is the first thing to rule in or out.
      const lifecycle = (what: string) => { if (this.state !== 'idle') callLog(what); };
      document.addEventListener('visibilitychange', () => lifecycle(`page ${document.visibilityState} (focus ${document.hasFocus()})`));
      window.addEventListener('blur', () => lifecycle('window lost focus'));
      window.addEventListener('focus', () => lifecycle('window got focus'));
      window.addEventListener('pagehide', (e) => lifecycle(`pagehide persisted=${(e as PageTransitionEvent).persisted}`));
      window.addEventListener('online', () => lifecycle('network online'));
      window.addEventListener('offline', () => lifecycle('network offline'));
      document.addEventListener('freeze', () => lifecycle('page frozen by the phone'));
      document.addEventListener('resume', () => lifecycle('page resumed'));
      window.addEventListener('pagehide', (event) => {
        if (!event.persisted) this.cleanup();
      });
    }
  }

  private createCallId(): string {
    try {
      if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') return crypto.randomUUID();
    } catch { /* use the non-cryptographic fallback below */ }
    return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 14)}`;
  }

  private stateListeners: Set<(state: CallState, error?: string | null) => void> = new Set();
  private streamListeners: Set<(local: MediaStream | null, remote: MediaStream | null) => void> = new Set();

  public getState(): CallState {
    return this.state;
  }

  public getErrorMessage(): string | null {
    return this.errorMessage;
  }

  public getLocalStream(): MediaStream | null {
    return this.localStream;
  }

  public getRemoteStream(): MediaStream | null {
    return this.remoteStream;
  }

  public subscribeState(listener: (state: CallState, error?: string | null) => void): () => void {
    this.stateListeners.add(listener);
    listener(this.state, this.errorMessage);
    return () => this.stateListeners.delete(listener);
  }

  public subscribeStreams(listener: (local: MediaStream | null, remote: MediaStream | null) => void): () => void {
    this.streamListeners.add(listener);
    listener(this.localStream, this.remoteStream);
    return () => this.streamListeners.delete(listener);
  }

  /**
   * A call stuck in "connecting" used to hang for minutes. If it has not connected after 12 s the connection is renegotiated,
   * again after 28 s, and at 50 s it fails with a clear message instead of leaving both people waiting.
   */
  private handledRequests = new Set<string>();
  private localMediaPromise: Promise<MediaStream> | null = null;
  private connectWatchdog: ReturnType<typeof setTimeout>[] = [];
  private armConnectWatchdog() {
    this.clearConnectWatchdog();
    const generation = this.callGeneration;
    const check = (action: () => void) => () => { if (generation === this.callGeneration && this.state === 'connecting') action(); };
    this.connectWatchdog = [
      setTimeout(check(() => this.scheduleRestart(0)), 12_000),
      setTimeout(check(() => this.scheduleRestart(0)), 28_000),
      setTimeout(check(() => {
        this.cleanup();
        this.setState('failed', 'The call could not connect. Check both connections and try again.');
      }), 50_000),
    ];
  }
  private clearConnectWatchdog() { this.connectWatchdog.forEach(clearTimeout); this.connectWatchdog = []; }

  private setState(newState: CallState, error: string | null = null) {
    if (this.state === 'idle' && newState !== 'idle') {
      // Which phone and how the app is running (a Home Screen app and a browser tab behave very differently when a call starts).
      const ua = typeof navigator !== 'undefined' ? navigator.userAgent : '';
      const standalone = typeof window !== 'undefined' && (window.matchMedia?.('(display-mode: standalone)').matches || (navigator as Navigator & { standalone?: boolean }).standalone === true);
      callLog(`environment: ${/iPhone|iPad|iPod/.test(ua) ? 'iOS' : /Android/.test(ua) ? 'Android' : 'desktop'} ${/CriOS/.test(ua) ? 'Chrome' : /FxiOS/.test(ua) ? 'Firefox' : /Safari/.test(ua) ? 'Safari' : 'other'} ${standalone ? 'Home Screen app' : 'browser tab'}`);
    }
    callLog(`state ${this.state} -> ${newState}${error ? ` (${error})` : ''}`);
    if (newState === 'connecting' && this.state !== 'connecting') this.armConnectWatchdog();
    else if (newState !== 'connecting') this.clearConnectWatchdog();
    this.state = newState;
    this.errorMessage = error;
    for (const listener of this.stateListeners) {
      listener(newState, error);
    }
  }

  private notifyStreams() {
    for (const listener of this.streamListeners) {
      listener(this.localStream, this.remoteStream);
    }
  }

  /**
   * Listen for incoming call requests directed to this user
   */
  public initUserSignaling(
    userId: string,
    onIncomingCall: (call: IncomingCall) => void,
    onCallCancelled?: (conversationId: string, callId?: string) => void,
  ): () => void {
    if (!supabase) return () => undefined;

    this.userRecovery?.stop();
    const recovery = new RealtimeRecovery({
      client: supabase, userId, topic: `gayze-user-${userId}`, syncWhileJoining: false,
      channelOptions: { config: { private: true, broadcast: { self: false } } },
      session: (signal) => requireRealtimeSession(supabase!, userId, signal),
      build: (channel, current) => channel.on('broadcast', { event: 'call-signal' }, (envelope: { payload: CallSignalPayload }) => {
        if (!current()) return;
        const signal = envelope.payload;
        if (!signal || signal.targetUserId && signal.targetUserId !== userId) return;
        if (Date.now() - signal.timestamp > 75_000) return;
        if (signal.type === 'call-request') {
          // A user-topic broadcast is only a delivery hint. Verify that both
          // authenticated users belong to this real conversation before
          // showing an incoming call or replying on its signalling topic.
          if (!/^[0-9a-f-]{36}$/i.test(signal.conversationId) || !/^[0-9a-f-]{36}$/i.test(signal.callerId)) return;
          void (async () => {
            const { data: members, error } = await supabase!
              .from('conversation_members')
              .select('user_id')
              .eq('conversation_id', signal.conversationId)
              .in('user_id', [userId, signal.callerId]);
            if (!current() || error || new Set((members || []).map((member: { user_id: string }) => member.user_id)).size !== 2) return;

            // The same ring can reach us twice (the live signal and the server's ringing record, or the signal sent on both
            // channels). A repeat of a call we are already answering, or have already dealt with, is not a second call and
            // must never be answered with "busy": that told the caller their own call was declined.
            const callKey = signal.callId || `${signal.conversationId}:${signal.callerId}:${signal.timestamp}`;
            const sameAsActive = Boolean(
              (signal.callId && signal.callId === this.activeCallId)
              || (signal.conversationId === this.activeConversationId && signal.callerId === this.activeTargetUserId));
            if (sameAsActive || this.handledRequests.has(callKey)) { callLog('ignored a repeat of a call already handled'); return; }
            this.handledRequests.add(callKey);
            if (this.handledRequests.size > 40) this.handledRequests.delete(this.handledRequests.values().next().value as string);

            // If already in a different call, notify caller that we're busy.
            if (this.state === 'calling' || this.state === 'ringing' || this.state === 'connecting' || this.state === 'connected') {
              void this.sendDirectSignal(signal.conversationId, {
                type: 'call-decline',
                conversationId: signal.conversationId,
                callerId: userId,
                targetUserId: signal.callerId,
                callId: signal.callId,
                timestamp: Date.now(),
              }).catch(() => undefined);
              return;
            }

            onIncomingCall({
              conversationId: signal.conversationId,
              callerId: signal.callerId,
              callerName: signal.callerName || 'Gayze member',
              callType: signal.callType || 'video',
              timestamp: signal.timestamp || Date.now(),
              callId: signal.callId || `${signal.conversationId}:${signal.callerId}:${signal.timestamp}`,
            });
            void this.sendDirectSignal(signal.conversationId, {
              type: 'call-ringing', conversationId: signal.conversationId,
              callerId: userId, targetUserId: signal.callerId,
              callId: signal.callId, timestamp: Date.now(),
            }).catch(() => undefined);
          })();
        } else if (signal.type === 'call-end' || signal.type === 'call-decline') {
          onCallCancelled?.(signal.conversationId, signal.callId);
        }
      }),
      reconcile: async () => undefined,
      status: () => undefined,
    });
    this.userRecovery = recovery;
    return () => {
      recovery.stop();
      if (this.userRecovery === recovery) {
        this.userRecovery = null;
        this.cleanup();
        this.setState('idle');
      }
    };
  }

  /**
   * Helper to send broadcast on a conversation channel
   */
  private async sendTransientSignal(topic: string, signal: CallSignalPayload): Promise<void> {
    if (!supabase) throw new Error('Supabase Realtime is required for calling');
    const client = supabase, generation = this.callGeneration;
    const outgoingSignal = { ...signal, callId: signal.callId ?? this.activeCallId ?? undefined };
    const channel = client.channel(topic, { config: { private: true, broadcast: { ack: true } } });
    let cancel = () => {};
    try {
      await new Promise<void>((resolve, reject) => {
        let sent = false, settled = false;
        const finish = (error?: Error) => {
          if (settled) return;
          settled = true; clearTimeout(timer);
          if (error) reject(error); else resolve();
        };
        const timer = setTimeout(() => finish(new Error('Call signal timed out')), 10_000);
        cancel = () => finish(new Error('Call ended'));
        this.transientSignals.add(cancel);
        channel.subscribe((status) => {
          if (settled) return;
          if (generation !== this.callGeneration) { cancel(); return; }
          if (status === 'SUBSCRIBED' && !sent) {
            sent = true;
            void channel.send({ type: 'broadcast', event: 'call-signal', payload: outgoingSignal }, { timeout: 5000 })
              .then((result) => finish(result === 'ok' ? undefined : new Error('Call signal not acknowledged')))
              .catch(() => finish(new Error('Call signal failed')));
          } else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT' || status === 'CLOSED') {
            finish(new Error('Call signalling unavailable'));
          }
        });
      });
    } finally {
      this.transientSignals.delete(cancel);
      void client.removeChannel(channel).catch(() => undefined);
    }
  }

  private async sendDirectSignal(conversationId: string, signal: CallSignalPayload): Promise<void> {
    if (this.callChannel && this.activeConversationId === conversationId) {
      await this.broadcastSignal(signal);
    } else {
      await this.sendTransientSignal(`gayze-call-${conversationId}`, signal);
    }
  }

  /**
   * Initiates an outgoing call
   */
  public async startCall(params: {
    conversationId: string;
    callerId: string;
    callerName: string;
    targetUserId: string;
    targetUserName: string;
    callType: CallType;
    /** Lets the call be recorded on the server under the same id the signals carry. */
    callId?: string;
  }): Promise<void> {
    this.cleanup();
    const generation = this.callGeneration;
    this.activeCallId = params.callId || this.createCallId();
    this.setState('calling');
    this.currentCallType = params.callType;
    this.activeConversationId = params.conversationId;
    this.activeTargetUserId = params.targetUserId;
    this.callStartTime = Date.now();
    this.callDirection = 'outgoing';
    this.callerNameForHistory = params.callerName;
    this.targetUserNameForHistory = params.targetUserName;

    try {
      // Get the microphone/camera now, while the caller's tap is fresh. Nothing is sent anywhere until the other person
      // answers and the connection is negotiated; asking only when they answer is what dropped calls on phones.
      // The ring goes out straight away; the permission prompt can stay open meanwhile. Waiting for it here used to hold the
      // ring back (so the other phone rang late) until the caller tapped Allow. The tracks are attached when they arrive.
      const media = this.acquireLocalMedia(params.callType, generation);
      this.localMediaPromise = media;
      media.catch((err) => {
        if (generation !== this.callGeneration) return;
        callLog(`microphone/camera unavailable: ${err?.name || ''} ${err?.message || err}`);
        this.setState('failed', this.parseMediaError(err));
        this.cleanup();
      });
      await this.loadIceServers();
      if (generation !== this.callGeneration) return;

      // Set up the signalling channel without local media tracks.
      await this.setupCallSignaling(params.conversationId, params.callerId, true);
      if (generation !== this.callGeneration) return;

      // Deliver the ring request before reporting success. Previously this send
      // was fire-and-forget, so a failed personal-channel publish left the caller
      // stuck ringing until timeout with no incoming call on the recipient.
      if (params.targetUserId) {
        await this.sendTransientSignal(`gayze-user-${params.targetUserId}`, {
          type: 'call-request', conversationId: params.conversationId,
          callId: this.activeCallId || undefined,
          callerId: params.callerId, callerName: params.callerName,
          targetUserId: params.targetUserId, callType: params.callType, timestamp: Date.now(),
        });
        if (generation !== this.callGeneration) return;
      }

      // Also broadcast on the conversation channel in case target is already on this screen
      await this.broadcastSignal({
        type: 'call-request',
        conversationId: params.conversationId,
        callId: this.activeCallId || undefined,
        callerId: params.callerId,
        callerName: params.callerName,
        targetUserId: params.targetUserId,
        callType: params.callType,
        timestamp: Date.now(),
      });

      if (generation !== this.callGeneration) return;
      analytics.logEvent('call_started', { type: params.callType });

      // 4. Auto-timeout if no answer within 60 seconds (long enough for a sleeping phone to wake and answer)
      this.ringingTimeoutTimer = window.setTimeout(() => {
        if (this.state === 'calling' || this.state === 'ringing') {
          this.endCall('missed');
        }
      }, 60000);
    } catch (err: any) {
      if (generation !== this.callGeneration) return;
      console.error('[GAYZE WebRTC] startCall failed:', err);
      callLog(`startCall failed: ${err?.name || ''} ${err?.message || err}`);
      const message = this.parseMediaError(err);
      this.setState('failed', message);
      this.cleanup();
    }
  }

  /**
   * Accepts an incoming call
   */
  public async acceptCall(params: {
    conversationId: string;
    callerId: string;
    userId: string;
    callType: CallType;
    callerName?: string;
    callId?: string;
  }): Promise<void> {
    this.cleanup();
    const generation = this.callGeneration;
    this.activeCallId = params.callId || this.createCallId();
    this.setState('connecting');
    this.currentCallType = params.callType;
    this.activeConversationId = params.conversationId;
    this.activeTargetUserId = params.callerId;
    this.callStartTime = Date.now();
    this.callDirection = 'incoming';
    this.callerNameForHistory = params.callerName || 'Unknown';
    this.targetUserNameForHistory = params.userId;

    try {
      // 1+2. Acquire local media and load short-lived TURN credentials together; both are needed before the peer
      // connection exists, and doing them one after the other made answering slower than it had to be.
      await Promise.all([this.acquireLocalMedia(params.callType, generation), this.loadIceServers()]);
      if (generation !== this.callGeneration) return;

      // 3. Join signaling channel
      await this.setupCallSignaling(params.conversationId, params.userId, false);
      if (generation !== this.callGeneration) return;

      // 3. Notify caller that call was accepted
      await this.broadcastSignal({
        type: 'call-accept',
        conversationId: params.conversationId,
        callerId: params.userId,
        targetUserId: params.callerId,
        callType: params.callType,
        timestamp: Date.now(),
      });
      if (generation !== this.callGeneration) return;
      // Answered from the lock screen, this phone can still be waking up: the caller's first offer may go out before it listens. Say
      // "I'm here" again while no offer has arrived; the caller answers every accept with the offer.
      [3000, 7000, 12000, 20000].forEach((delay) => window.setTimeout(() => {
        if (generation !== this.callGeneration || this.state === 'connected') return;
        if (this.pc && this.pc.remoteDescription) return;
        callLog('no offer yet: telling the caller again that the call was answered');
        void this.broadcastSignal({ type: 'call-accept', conversationId: params.conversationId, callerId: params.userId, targetUserId: params.callerId, callType: params.callType, timestamp: Date.now() }).catch(() => undefined);
      }, delay));
      analytics.logEvent('call_started', { type: params.callType, direction: 'incoming' });
    } catch (err: any) {
      if (generation !== this.callGeneration) return;
      console.error('[GAYZE WebRTC] acceptCall failed:', err);
      callLog(`acceptCall failed: ${err?.name || ''} ${err?.message || err}`);
      const message = this.parseMediaError(err);
      this.setState('failed', message);
      this.cleanup();
    }
  }

  /**
   * Declines an incoming call
   */
  public async declineCall(params: {
    conversationId: string;
    callerId: string;
    userId: string;
    callerName?: string;
    callId?: string;
  }): Promise<void> {
    const generation = this.callGeneration;
    try { await this.sendDirectSignal(params.conversationId, {
      type: 'call-decline',
      callId: params.callId,
      conversationId: params.conversationId,
      callerId: params.userId,
      targetUserId: params.callerId,
      timestamp: Date.now(),
    }); } catch { /* Local decline must still complete while offline. */ }
    if (generation !== this.callGeneration) return;
    this.cleanup();
    this.setState('idle');
  }

  /**
   * Set up WebRTC peer connection and attach local tracks
   */
  private setupPeerConnection(conversationId: string, currentUserId: string): RTCPeerConnection {
    if (this.pc) {
      this.pc.close();
      this.pc = null;
    }

    const pc = new RTCPeerConnection({
      iceServers: this.resolvedIceServers || getIceServers(),
      iceCandidatePoolSize: 4,
    });

    // Attach local media tracks
    if (this.localStream) {
      this.localStream.getTracks().forEach((track) => {
        pc.addTrack(track, this.localStream!);
      });
    }

    // Handle remote tracks
    pc.ontrack = (event) => {
      if (this.pc !== pc) return;
      callLog(`remote ${event.track.kind} track arrived`);
      if (event.streams && event.streams[0]) {
        this.remoteStream = event.streams[0];
      } else {
        if (!this.remoteStream) {
          this.remoteStream = new MediaStream();
        }
        this.remoteStream.addTrack(event.track);
      }
      if (this.pc !== pc) return;
      this.notifyStreams();
    };

    // Handle ICE candidates. They are sent in small batches: one message per candidate (a dozen or more per side, all at once)
    // can hit the realtime message-rate limit and be dropped, which leaves the call stuck connecting.
    let outbox: RTCIceCandidateInit[] = [];
    let outboxTimer: ReturnType<typeof setTimeout> | null = null;
    const flush = () => {
      outboxTimer = null;
      if (this.pc !== pc || outbox.length === 0) return;
      const candidates = outbox; outbox = [];
      void this.broadcastSignal({ type: 'ice-candidates', conversationId, callerId: currentUserId, candidates, timestamp: Date.now() })
        .catch(() => this.scheduleRestart());
    };
    const localTypes: Record<string, number> = {};
    pc.onicecandidate = (event) => {
      if (this.pc !== pc) return;
      if (event.candidate) {
        const kind = / typ (\w+)/.exec(event.candidate.candidate || '')?.[1] ?? 'other';
        localTypes[kind] = (localTypes[kind] ?? 0) + 1;
        outbox.push(event.candidate.toJSON());
        if (!outboxTimer) outboxTimer = setTimeout(flush, 200);
      } else {
        callLog(`local routes found: ${Object.entries(localTypes).map(([k, v]) => `${k} ${v}`).join(', ') || 'none'}`);
        if (outboxTimer) { clearTimeout(outboxTimer); flush(); }
      }
    };

    pc.onconnectionstatechange = () => {
      if (this.pc !== pc) return;
      callLog(`peer connection ${pc.connectionState}`);
      if (pc.connectionState === 'connected') this.recovered();
      else if (pc.connectionState === 'failed') {
        this.setState('connecting');
        this.scheduleRestart(500);
      } else if (pc.connectionState === 'disconnected') {
        // Phones blip to "disconnected" for a second or two and recover by themselves. Only show "Securing the line" if it lasts.
        callLog('connection disconnected (waiting to see if it recovers)');
        const generation = this.callGeneration;
        setTimeout(() => {
          if (this.pc === pc && generation === this.callGeneration && pc.connectionState === 'disconnected') { this.setState('connecting'); this.scheduleRestart(1500); }
        }, 3500);
      }
    };
    pc.oniceconnectionstatechange = () => {
      if (this.pc !== pc) return;
      callLog(`ice ${pc.iceConnectionState}`);
      if (pc.iceConnectionState === 'connected' || pc.iceConnectionState === 'completed') this.recovered();
      else if (pc.iceConnectionState === 'failed') this.scheduleRestart(500);
    };

    this.pc = pc;
    return pc;
  }

  /**
   * Set up Realtime signaling channel for WebRTC negotiation
   */
  private async setupCallSignaling(conversationId: string, currentUserId: string, isCaller: boolean): Promise<void> {
    if (!supabase) throw new Error('Supabase Realtime is required for calling');
    this.callRecovery?.stop();
    this.caller = isCaller;
    this.localUserId = currentUserId;
    const pc = this.setupPeerConnection(conversationId, currentUserId);
    let firstJoin = true;
    let signalTail = Promise.resolve();
    await new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error('Call signalling could not connect')), 25_000);
      this.callRecovery = new RealtimeRecovery({
        client: supabase!, userId: currentUserId, topic: `gayze-call-${conversationId}`, syncWhileJoining: false, environment: callRecoveryEnvironment,
        channelOptions: { config: { private: true, broadcast: { self: false, ack: true } } },
        session: (signal) => requireRealtimeSession(supabase!, currentUserId, signal),
        build: (channel, current) => {
          this.callChannel = channel;
          return channel.on('broadcast', { event: 'call-signal' }, (envelope: { payload: CallSignalPayload }) => {
            if (!current() || this.pc !== pc) return;
            const signal = envelope.payload;
            if (!signal || signal.conversationId !== conversationId || signal.callerId === currentUserId) return;
            if (signal.callId && this.activeCallId && signal.callId !== this.activeCallId) {
              if (signal.type !== 'ice-candidates' && signal.type !== 'ice-candidate') callLog(`dropped ${signal.type}: it belongs to a different call`);
              return;
            }
            // Ignore other peers/stale packets. This is defence in depth, not a
            // replacement for server-side Realtime channel authorization.
            if (signal.callerId !== this.activeTargetUserId && signal.callerId !== 'self') {
              if (signal.type !== 'ice-candidates' && signal.type !== 'ice-candidate') callLog(`dropped ${signal.type}: it came from someone other than the other person in this call`);
              return;
            }
            if (signal.type !== 'ice-candidates' && signal.type !== 'ice-candidate') callLog(`got ${signal.type}`);
            signalTail = signalTail.then(async () => {
              if (current() && this.pc === pc) await this.handleCallSignal(pc, signal);
            }).catch((err) => { callLog(`signal ${signal.type} failed: ${err?.name || ''} ${err?.message || err}`); if (current() && this.pc === pc) this.scheduleRestart(); });
          });
        },
        reconcile: async () => {
          if (this.pc !== pc) return;
          clearTimeout(timeout);
          if (firstJoin) { firstJoin = false; resolve(); }
          else if (pc.remoteDescription) {
            // The signalling channel re-checks itself every 30 s and after any blip. That must never tear down a call that is
            // working: restarting the connection every time made "Securing the line" appear on a perfectly good call.
            const healthy = pc.connectionState === 'connected' || pc.iceConnectionState === 'connected' || pc.iceConnectionState === 'completed';
            if (!healthy) this.scheduleRestart(250);
          }
          else if (!isCaller) {
            await this.broadcastSignal({ type: 'call-accept', conversationId, callerId: currentUserId, timestamp: Date.now() });
          }
        },
        status: (state) => {
          if (this.pc !== pc) return;
          callLog(`call channel ${state}`);
          if (state === 'sign-in-required') { clearTimeout(timeout); reject(new Error('Sign in required for calling')); this.cleanup(); this.setState('failed', 'Sign in again to call.'); }
          else if (!firstJoin && state !== 'connected' && pc.connectionState !== 'connected' && pc.iceConnectionState !== 'connected' && pc.iceConnectionState !== 'completed') this.setState('connecting');
        },
      });
    });
  }

  private async handleCallSignal(pc: RTCPeerConnection, signal: CallSignalPayload) {
    if (this.pc !== pc) return;
    switch (signal.type) {
      case 'call-ringing':
        if (this.state === 'calling') this.setState('ringing');
        break;
      case 'call-accept':
        if (this.caller) {
          if (this.ringingTimeoutTimer) clearTimeout(this.ringingTimeoutTimer);
          this.ringingTimeoutTimer = null;
          this.setState('connecting');

          // A caller must not capture audio/video while the recipient is still
          // being rung. Acquire media only after their explicit acceptance.
          if (!this.localStream) {
            const generation = this.callGeneration;
            await (this.localMediaPromise ?? this.acquireLocalMedia(this.currentCallType, generation));
            if (this.pc !== pc || generation !== this.callGeneration) return;
          }

          // The peer connection was created for signalling before acceptance,
          // so attach the newly-authorised tracks now, exactly once.
          if (this.localStream) {
            const attachedTrackIds = new Set(
              pc.getSenders().map((sender) => sender.track?.id).filter(Boolean),
            );
            this.localStream.getTracks().forEach((track) => {
              if (!attachedTrackIds.has(track.id)) pc.addTrack(track, this.localStream!);
            });
          }

          if (!pc.remoteDescription) await this.sendOffer(false);
        }
        break;
      case 'ice-restart-request':
        if (this.caller) this.scheduleRestart(250);
        break;
      case 'renegotiate':
        if (this.caller) await this.sendOffer(false, true);
        break;
      case 'video-request':
        if (this.state !== 'connected' || this.currentCallType === 'video') break;
        if (this.upgrade === 'requesting') { await this.answerVideoUpgrade(true).catch(() => undefined); break; } // both asked at once
        this.setUpgrade('incoming');
        break;
      case 'video-accept':
        if (this.upgrade !== 'requesting') break;
        try {
          await this.attachCamera(this.pendingCamera);
          this.pendingCamera = null;
          this.clearUpgradeTimer();
          this.setUpgrade('active');
          await this.renegotiate();
        } catch (error) {
          callLog(`video upgrade failed: ${(error as Error)?.name || ''} ${(error as Error)?.message || ''}`);
          this.dropPendingCamera();
          this.setUpgrade('failed');
        }
        break;
      case 'video-decline':
        if (this.upgrade === 'requesting') { this.dropPendingCamera(); this.clearUpgradeTimer(); this.setUpgrade('declined'); }
        break;
      case 'offer':
        if (!this.caller && signal.sdp) {
          if (this.state !== 'connected') this.setState('connecting'); // a video upgrade renegotiates a live call; it does not "reconnect"

          // Refresh our relay credentials too before answering an ICE restart.
          const servers = await this.loadIceServers();
          if (this.pc !== pc) return;
          pc.setConfiguration({ ...pc.getConfiguration(), iceServers: servers });
          await pc.setRemoteDescription(signal.sdp);
          await this.flushCandidates(pc);
          const answer = await pc.createAnswer();
          if (this.pc !== pc) return;
          await pc.setLocalDescription(answer);
          await this.gatheringDone(pc);
          if (this.pc !== pc) return;
          await this.broadcastSignal({ type: 'answer', conversationId: signal.conversationId, callerId: this.localUserId, sdp: this.plainDescription(pc, answer), timestamp: Date.now() });
        }
        break;
      case 'answer':
        if (this.caller && signal.sdp && pc.signalingState === 'have-local-offer') {
          await pc.setRemoteDescription(signal.sdp);
          await this.flushCandidates(pc);
        }
        break;
      case 'ice-candidates': {
        const remoteTypes: Record<string, number> = {};
        for (const c of (signal.candidates ?? []).slice(0, 64)) { const k = / typ (\w+)/.exec(c.candidate || '')?.[1] ?? 'other'; remoteTypes[k] = (remoteTypes[k] ?? 0) + 1; }
        callLog(`remote routes received: ${Object.entries(remoteTypes).map(([k, v]) => `${k} ${v}`).join(', ') || 'none'}`);
        for (const candidate of (signal.candidates ?? []).slice(0, 64)) {
          if (this.candidateMatches(pc, candidate)) await pc.addIceCandidate(candidate).catch(() => undefined);
          else this.pendingIceCandidates = [...this.pendingIceCandidates, candidate].slice(-128);
        }
        break;
      }
      case 'ice-candidate':
        if (signal.candidate) {
          if (this.candidateMatches(pc, signal.candidate)) await pc.addIceCandidate(signal.candidate);
          else this.pendingIceCandidates = [...this.pendingIceCandidates, signal.candidate].slice(-128);
        }
        break;
      case 'call-decline': this.cleanup(); this.setState('declined'); break;
      case 'call-end': this.cleanup(); this.setState('ended'); break;
    }
  }

  private candidateMatches(pc: RTCPeerConnection, candidate: RTCIceCandidateInit) {
    return Boolean(pc.remoteDescription && (!candidate.usernameFragment || pc.remoteDescription.sdp?.includes(`a=ice-ufrag:${candidate.usernameFragment}`)));
  }
  private async flushCandidates(pc: RTCPeerConnection) {
    const ready = this.pendingIceCandidates.filter((candidate) => this.candidateMatches(pc, candidate));
    this.pendingIceCandidates = this.pendingIceCandidates.filter((candidate) => !ready.includes(candidate));
    for (const candidate of ready) { if (this.pc === pc) await pc.addIceCandidate(candidate); }
  }
  private recovered() {
    this.restartAttempts = 0;
    if (this.restartTimer) clearTimeout(this.restartTimer);
    this.restartTimer = null;
    this.setState('connected');
  }
  private scheduleRestart(delay = 1000) {
    if (!this.pc || this.restartTimer) return;
    this.restartTimer = setTimeout(() => { this.restartTimer = null; void this.restartCallIce(); }, delay);
  }
  private async restartCallIce() {
    const pc = this.pc;
    if (!pc || !this.activeConversationId) return;
    if (this.callChannel?.state !== 'joined' || (typeof navigator !== 'undefined' && !navigator.onLine)) {
      // Recovery of the existing Supabase signalling channel owns this wait.
      this.scheduleRestart(3000);
      return;
    }
    if (++this.restartAttempts > 3) { this.cleanup(); this.setState('failed', 'The call could not reconnect. Please call again.'); return; }
    this.setState('connecting');
    try {
      if (this.caller) await this.sendOffer(true);
      else await this.broadcastSignal({ type: 'ice-restart-request', conversationId: this.activeConversationId, callerId: this.localUserId, timestamp: Date.now() });
    } catch { /* Bounded retry below; no credentials/SDP logged. */ }
    if (pc === this.pc) this.scheduleRestart(12_000);
  }
  private async sendOffer(restart: boolean, renegotiation = false) {
    const pc = this.pc;
    const conversationId = this.activeConversationId;
    if (!pc || !conversationId || this.offering || !this.caller) return;
    this.offering = true;
    try {
      const servers = await this.loadIceServers(restart);
      if (this.pc !== pc) return;
      pc.setConfiguration({ ...pc.getConfiguration(), iceServers: servers });
      if (pc.signalingState === 'have-local-offer' && restart) await pc.setLocalDescription({ type: 'rollback' });
      if (pc.signalingState !== 'stable') return;
      // createOffer({iceRestart:true}) performs the restart AND gives us the SDP
      // to deliver. A bare restartIce() without renegotiation cannot do that.
      const offer = await pc.createOffer({ iceRestart: restart });
      if (this.pc !== pc) return;
      await pc.setLocalDescription(offer);
      await this.gatheringDone(pc);
      if (this.pc !== pc) return;
      await this.broadcastSignal({ type: 'offer', conversationId, callerId: this.localUserId, sdp: this.plainDescription(pc, offer), timestamp: Date.now() });
      if (!restart && !renegotiation) this.scheduleRestart(12_000); // lost initial SDP/answer also recovers
      // The other phone may not have been listening yet (it was still waking, or its signalling channel was mid-join), so the
      // offer is delivered to nobody and the call sits on "Securing the line". Say it again, same offer, until an answer arrives.
      if (!restart) {
        const generation = this.callGeneration;
        [2500, 6000, 10000, 15000, 22000, 30000, 40000].forEach((delay) => setTimeout(() => {
          if (this.pc !== pc || generation !== this.callGeneration || pc.signalingState !== 'have-local-offer' || !pc.localDescription) return;
          callLog('no answer yet: sending the offer again');
          void this.broadcastSignal({ type: 'offer', conversationId, callerId: this.localUserId, sdp: this.plainDescription(pc, pc.localDescription), timestamp: Date.now() }).catch(() => undefined);
        }, delay));
      }
    } finally { if (this.pc === pc) this.offering = false; }
  }
  /**
   * Wait (briefly, 1.2 s) for the phone to finish finding its network routes, so the offer or answer carries them all and does not
   * depend on every separate candidate message arriving. If gathering is slow, send what there is and let the rest follow.
   */
  private async gatheringDone(pc: RTCPeerConnection, ms = 1200): Promise<void> {
    if (pc.iceGatheringState === 'complete' || typeof pc.addEventListener !== 'function') return;
    await new Promise<void>((resolve) => {
      const done = () => { clearTimeout(timer); pc.removeEventListener('icegatheringstatechange', onChange); resolve(); };
      const onChange = () => { if (pc.iceGatheringState === 'complete') done(); };
      const timer = setTimeout(done, ms);
      pc.addEventListener('icegatheringstatechange', onChange);
    });
  }

  /** The local description as a plain {type, sdp} object, now including every candidate found so far. */
  private plainDescription(pc: RTCPeerConnection, fallback: RTCSessionDescriptionInit): RTCSessionDescriptionInit {
    const d = pc.localDescription;
    return d ? { type: d.type, sdp: d.sdp } : fallback;
  }

  private async broadcastSignal(signal: CallSignalPayload): Promise<void> {
    if (!this.callChannel || this.callChannel.state !== 'joined') throw new Error('Call signalling reconnecting');
    const outgoingSignal = { ...signal, callId: signal.callId ?? this.activeCallId ?? undefined };
    if (signal.type !== 'ice-candidates' && signal.type !== 'ice-candidate') callLog(`send ${signal.type}`);
    const result = await this.callChannel.send({ type: 'broadcast', event: 'call-signal', payload: outgoingSignal }, { timeout: 5000 });
    if (result !== 'ok') throw new Error('Call signal was not acknowledged');
  }

  /**
   * Acquire camera and microphone media streams
   */
  private mediaConstraints(callType: CallType): MediaStreamConstraints {
    return {
      audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
      video:
        callType === 'video'
          ? { facingMode: this.currentFacingMode, width: { ideal: 1280, max: 1920 }, height: { ideal: 720, max: 1080 } }
          : false,
    };
  }

  /**
   * Ask for the camera/microphone straight from the tap that starts or answers the call. Browsers (iPhones especially) only
   * allow, or only remember, that permission when it is asked for inside a tap: asking later, after a network round trip or
   * when the other person answers, is refused or never seen, and the call drops.
   */
  private prewarmed: { type: CallType; promise: Promise<MediaStream>; at: number } | null = null;
  public prewarmMedia(callType: CallType): void {
    if (this.prewarmed && this.prewarmed.type === callType && Date.now() - this.prewarmed.at < 60_000) return;
    if (!navigator.mediaDevices?.getUserMedia) return;
    this.discardPrewarmedMedia();
    const promise = navigator.mediaDevices.getUserMedia(this.mediaConstraints(callType));
    const entry = { type: callType, promise, at: Date.now() };
    this.prewarmed = entry;
    promise.catch(() => { if (this.prewarmed === entry) this.prewarmed = null; });
  }
  public discardPrewarmedMedia(): void {
    const old = this.prewarmed;
    this.prewarmed = null;
    void old?.promise.then((stream) => stream.getTracks().forEach((track) => track.stop()), () => undefined);
  }

  private async acquireLocalMedia(callType: CallType, generation = this.callGeneration): Promise<MediaStream> {
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      throw new Error('Your browser or device does not support real-time audio/video calls.');
    }

    const early = this.prewarmed && this.prewarmed.type === callType && Date.now() - this.prewarmed.at < 60_000 ? this.prewarmed : null;
    this.prewarmed = null;
    const stream = early
      ? await early.promise.catch(() => navigator.mediaDevices.getUserMedia(this.mediaConstraints(callType)))
      : await navigator.mediaDevices.getUserMedia(this.mediaConstraints(callType));
    if (generation !== this.callGeneration) { stream.getTracks().forEach((track) => track.stop()); throw new Error('Call ended'); }
    callLog(`got ${stream.getAudioTracks().length ? 'microphone' : 'no microphone'}${stream.getVideoTracks().length ? ' and camera' : ''}`);
    stream.getAudioTracks().forEach((track) => { track.enabled = this.audioEnabled; });
    stream.getVideoTracks().forEach((track) => { track.enabled = this.videoEnabled; });
    this.localStream = stream;
    this.notifyStreams();
    return stream;
  }

  /**
   * Audio mute/unmute
   */
  public toggleAudio(forceEnabled?: boolean): boolean {
    const audioTrack = this.localStream?.getAudioTracks()[0];
    const currentEnabled = audioTrack ? audioTrack.enabled : this.audioEnabled;
    const newEnabled = forceEnabled !== undefined ? forceEnabled : !currentEnabled;
    this.audioEnabled = newEnabled;
    if (audioTrack) audioTrack.enabled = newEnabled;
    return newEnabled;
  }

  /**
   * Camera on/off
   */
  public toggleVideo(forceEnabled?: boolean): boolean {
    const videoTrack = this.localStream?.getVideoTracks()[0];
    const currentEnabled = videoTrack ? videoTrack.enabled : this.videoEnabled;
    const newEnabled = forceEnabled !== undefined ? forceEnabled : !currentEnabled;
    this.videoEnabled = newEnabled;
    if (videoTrack) videoTrack.enabled = newEnabled;
    return newEnabled;
  }

  /**
   * Flip between front and rear cameras on mobile
   */
  public async flipCamera(): Promise<void> {
    if (this.currentCallType !== 'video' || !this.localStream) return;

    const nextMode = this.currentFacingMode === 'user' ? 'environment' : 'user';
    try {
      // Same size hints as the first camera, so the picture the other person sees keeps its shape.
      const newStream = await navigator.mediaDevices.getUserMedia({
        audio: false,
        video: { facingMode: { ideal: nextMode }, width: { ideal: 1280, max: 1920 }, height: { ideal: 720, max: 1080 } },
      });
      const newVideoTrack = newStream.getVideoTracks()[0];
      if (!newVideoTrack || !this.localStream) { newStream.getTracks().forEach((t) => t.stop()); return; }
      newVideoTrack.enabled = this.videoEnabled;

      // Swap on the live connection first, then retire the old camera: the other person never sees a gap or a renegotiation.
      const videoSender = this.pc?.getSenders().find((sender) => sender.track?.kind === 'video');
      if (videoSender) await videoSender.replaceTrack(newVideoTrack);
      const oldTrack = this.localStream.getVideoTracks()[0];
      if (oldTrack) { this.localStream.removeTrack(oldTrack); oldTrack.stop(); }
      this.localStream.addTrack(newVideoTrack);
      this.currentFacingMode = nextMode;
      this.notifyStreams();
    } catch (err) {
      console.warn('[GAYZE WebRTC] Camera flip not supported or denied', err);
    }
  }

  /**
   * End the call and cleanly stop all tracks and close connections
   */
  public async endCall(explicitState: CallState = 'ended'): Promise<void> {
    callLog(`endCall requested here (${explicitState}) while ${this.state}`);
    const generation = this.callGeneration, callerId = this.localUserId;
    const conversationId = this.activeConversationId;
    const callId = this.activeCallId;
    const targetUserId = this.activeTargetUserId;
    const wasRinging = this.state === 'calling' || this.state === 'ringing';

    if (this.callChannel && conversationId) {
      try {
        await this.broadcastSignal({
          type: 'call-end',
          conversationId,
          callerId: this.localUserId,
          timestamp: Date.now(),
        });
      } catch (e) {
        console.warn('[GAYZE WebRTC] Error sending call-end signal', e);
      }
    }

    // Save call record to history
    const callEndTime = Date.now();
    const durationSeconds = this.callStartTime ? Math.floor((callEndTime - this.callStartTime) / 1000) : 0;
    const isMissed = explicitState === 'missed' || explicitState === 'declined' || (wasRinging && explicitState === 'ended');
    
    if (conversationId && callerId && this.callStartTime) {
      const callRecord = {
        conversationId,
        callerId,
        callerName: this.callerNameForHistory || 'Unknown',
        targetUserId: targetUserId || '',
        targetUserName: this.targetUserNameForHistory || 'Unknown',
        callType: this.currentCallType,
        state: explicitState,
        startedAt: this.callStartTime,
        endedAt: callEndTime,
        durationSeconds: durationSeconds > 0 ? durationSeconds : undefined,
        direction: this.callDirection,
        isMissed,
        isRead: !isMissed, // Auto-mark as read if not missed
      };
      
      // Save call record in background
      void saveCallRecord(callRecord).catch(() => {
        console.warn('[GAYZE WebRTC] Failed to save call record');
      });
    }

    if (generation !== this.callGeneration) return;
    this.cleanup();
    this.setState(explicitState);
    // Send the ringing cancellation after local teardown, so closing media is
    // immediate and a subsequent call/account teardown can cancel this one-shot.
    if (targetUserId && conversationId && wasRinging) {
      void this.sendTransientSignal(`gayze-user-${targetUserId}`, {
        type: 'call-end', conversationId, callerId, targetUserId, callId: callId || undefined, timestamp: Date.now(),
      }).catch(() => undefined);
    }

    // Reset call tracking for next call
    this.callStartTime = null;
    this.callerNameForHistory = null;
    this.targetUserNameForHistory = null;

    analytics.logEvent('call_completed', { outcome: explicitState });
  }

  /**
   * Complete teardown of all media and network resources
   */
  public cleanup() {
    ++this.callGeneration;
    this.clearConnectWatchdog();
    this.transientSignals.forEach((cancel) => cancel());
    this.transientSignals.clear();
    this.iceCache.clear();
    this.resolvedIceServers = null;
    if (this.credentialTimer) clearTimeout(this.credentialTimer);
    if (this.restartTimer) clearTimeout(this.restartTimer);
    this.credentialTimer = null;
    this.restartTimer = null;
    this.restartAttempts = 0;
    this.offering = false;
    this.localMediaPromise = null;
    this.callRecovery?.stop();
    this.callRecovery = null;
    this.callChannel = null;
    this.pendingIceCandidates = [];
    this.activeTargetUserId = null;
    this.activeCallId = null;
    this.audioEnabled = true;
    this.videoEnabled = true;
    this.callStartTime = null;
    this.callerNameForHistory = null;
    this.targetUserNameForHistory = null;

    if (this.ringingTimeoutTimer) {
      clearTimeout(this.ringingTimeoutTimer);
      this.ringingTimeoutTimer = null;
    }

    // 1. Stop all tracks in local stream so camera/mic hardware LEDs turn off immediately
    if (this.localStream) {
      this.localStream.getTracks().forEach((track) => {
        try {
          track.stop();
        } catch (e) {
          console.warn('[GAYZE WebRTC] Track stop exception:', e);
        }
      });
      this.localStream = null;
    }

    // 2. Stop all tracks in remote stream
    if (this.remoteStream) {
      this.remoteStream.getTracks().forEach((track) => {
        try {
          track.stop();
        } catch (e) {
          console.warn('[GAYZE WebRTC] Remote track stop exception:', e);
        }
      });
      this.remoteStream = null;
    }

    // 3. Close RTCPeerConnection
    if (this.pc) {
      const pc = this.pc;
      this.pc = null;
      try {
        pc.close();
      } catch (e) {
        console.warn('[GAYZE WebRTC] PeerConnection close exception:', e);
      }
      this.pc = null;
    }

    this.activeConversationId = null;
    this.dropPendingCamera();
    this.clearUpgradeTimer();
    if (this.upgrade !== 'idle') { this.upgrade = 'idle'; for (const l of this.upgradeListeners) l('idle', this.currentCallType); }
    this.notifyStreams();
  }

  // ---- Switching an audio call to video ----
  private upgrade: UpgradePhase = 'idle';
  private upgradeListeners = new Set<(phase: UpgradePhase, callType: CallType) => void>();
  private pendingCamera: Promise<MediaStream> | null = null;
  private upgradeTimer: ReturnType<typeof setTimeout> | null = null;
  public subscribeUpgrade(listener: (phase: UpgradePhase, callType: CallType) => void): () => void {
    this.upgradeListeners.add(listener);
    listener(this.upgrade, this.currentCallType);
    return () => this.upgradeListeners.delete(listener);
  }
  private setUpgrade(phase: UpgradePhase) {
    this.upgrade = phase;
    callLog(`video upgrade: ${phase}`);
    for (const listener of this.upgradeListeners) listener(phase, this.currentCallType);
    if (phase === 'declined' || phase === 'failed') setTimeout(() => { if (this.upgrade === phase) this.setUpgrade('idle'); }, 4000);
  }
  private clearUpgradeTimer() { if (this.upgradeTimer) clearTimeout(this.upgradeTimer); this.upgradeTimer = null; }
  private dropPendingCamera() {
    const pending = this.pendingCamera; this.pendingCamera = null;
    void pending?.then((stream) => stream.getTracks().forEach((track) => track.stop()), () => undefined);
  }
  private cameraConstraints(): MediaStreamConstraints {
    return { audio: false, video: { facingMode: this.currentFacingMode, width: { ideal: 1280, max: 1920 }, height: { ideal: 720, max: 1080 } } };
  }
  /** Add the camera to the live call. The camera is requested straight from the tap, never later. */
  private async attachCamera(pending: Promise<MediaStream> | null): Promise<void> {
    const pc = this.pc;
    if (!pc) throw new Error('No call');
    if (this.localStream?.getVideoTracks().length) return;
    const camera = await (pending ?? navigator.mediaDevices.getUserMedia(this.cameraConstraints()));
    const track = camera.getVideoTracks()[0];
    if (!track || this.pc !== pc) { camera.getTracks().forEach((t) => t.stop()); throw new Error('Call ended'); }
    this.videoEnabled = true;
    track.enabled = true;
    if (!this.localStream) this.localStream = new MediaStream();
    this.localStream.addTrack(track);
    pc.addTrack(track, this.localStream);
    this.currentCallType = 'video';
    this.notifyStreams();
  }
  private async renegotiate() {
    if (this.caller) await this.sendOffer(false, true);
    else if (this.activeConversationId) await this.broadcastSignal({ type: 'renegotiate', conversationId: this.activeConversationId, callerId: this.localUserId, timestamp: Date.now() });
  }
  /** Ask the other person to switch to video. Call this from a tap: the camera permission is requested here. */
  public requestVideoUpgrade(): void {
    if (this.state !== 'connected' || this.currentCallType === 'video' || !this.activeConversationId) return;
    if (this.upgrade === 'requesting' || this.upgrade === 'incoming') return;
    if (!navigator.mediaDevices?.getUserMedia) { this.setUpgrade('failed'); return; }
    this.dropPendingCamera();
    this.pendingCamera = navigator.mediaDevices.getUserMedia(this.cameraConstraints());
    this.pendingCamera.catch(() => { this.pendingCamera = null; if (this.upgrade === 'requesting') { this.clearUpgradeTimer(); this.setUpgrade('failed'); } });
    this.setUpgrade('requesting');
    this.clearUpgradeTimer();
    this.upgradeTimer = setTimeout(() => { if (this.upgrade === 'requesting') { this.dropPendingCamera(); this.setUpgrade('declined'); } }, 30_000);
    void this.broadcastSignal({ type: 'video-request', conversationId: this.activeConversationId, callerId: this.localUserId, timestamp: Date.now() })
      .catch(() => { this.dropPendingCamera(); this.clearUpgradeTimer(); this.setUpgrade('failed'); });
  }
  public cancelVideoUpgrade(): void {
    if (this.upgrade !== 'requesting') return;
    this.dropPendingCamera(); this.clearUpgradeTimer(); this.setUpgrade('idle');
  }
  /** Answer the other person's request to switch to video (from a tap). */
  public async answerVideoUpgrade(accept: boolean): Promise<void> {
    const conversationId = this.activeConversationId;
    if (!conversationId || (this.upgrade !== 'incoming' && this.upgrade !== 'requesting')) return;
    if (!accept) {
      this.setUpgrade('idle');
      await this.broadcastSignal({ type: 'video-decline', conversationId, callerId: this.localUserId, timestamp: Date.now() }).catch(() => undefined);
      return;
    }
    try {
      const pending = this.pendingCamera; this.pendingCamera = null; this.clearUpgradeTimer();
      await this.attachCamera(pending);
      this.setUpgrade('active');
      await this.broadcastSignal({ type: 'video-accept', conversationId, callerId: this.localUserId, timestamp: Date.now() });
    } catch (error) {
      callLog(`video upgrade failed: ${(error as Error)?.name || ''} ${(error as Error)?.message || ''}`);
      this.setUpgrade('failed');
      await this.broadcastSignal({ type: 'video-decline', conversationId, callerId: this.localUserId, timestamp: Date.now() }).catch(() => undefined);
    }
  }

  private parseMediaError(err: any): string {
    if (!err) return 'Call connection failed.';
    const name = err.name || '';
    if (name === 'NotAllowedError' || name === 'PermissionDeniedError') {
      return 'Camera or microphone permission was denied. Please allow access in browser settings.';
    }
    if (name === 'NotFoundError' || name === 'DevicesNotFoundError') {
      return 'No camera or microphone was detected on this device.';
    }
    if (name === 'NotReadableError' || name === 'TrackStartError') {
      return 'Your camera or microphone is already in use by another application.';
    }
    return err.message || 'Media connection failed.';
  }
}

export const webrtcCallService = new WebRTCCallService();
registerCallLogSource(() => webrtcCallService.currentCallId());
