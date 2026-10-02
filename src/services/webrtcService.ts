import { supabase } from './supabaseClient';
import { IceCredentialCache } from './iceCredentials';
import { RealtimeRecovery, requireRealtimeSession } from './realtimeRecovery';
import { analytics } from './analyticsService';
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

export interface IncomingCall {
  conversationId: string;
  callerId: string;
  callerName: string;
  callType: CallType;
  timestamp: number;
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
    | 'ice-restart-request';
  conversationId: string;
  callerId: string;
  callerName?: string;
  targetUserId?: string;
  callType?: CallType;
  sdp?: RTCSessionDescriptionInit;
  candidate?: RTCIceCandidateInit;
  timestamp: number;
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
  private activeTargetUserId: string | null = null;
  private ringingTimeoutTimer: number | null = null;
  private pendingIceCandidates: RTCIceCandidateInit[] = [];
  private resolvedIceServers: RTCIceServer[] | null = null;

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
      window.addEventListener('pagehide', (event) => {
        if (!event.persisted) this.cleanup();
      });
    }
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

  private setState(newState: CallState, error: string | null = null) {
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
    onCallCancelled?: (conversationId: string) => void,
  ): () => void {
    if (!supabase) return () => undefined;

    this.userRecovery?.stop();
    const recovery = new RealtimeRecovery({
      client: supabase, userId, topic: `gayze-user-${userId}`, syncWhileJoining: false,
      channelOptions: { config: { broadcast: { self: false } } },
      session: (signal) => requireRealtimeSession(supabase!, userId, signal),
      build: (channel, current) => channel.on('broadcast', { event: 'call-signal' }, (envelope: { payload: CallSignalPayload }) => {
        if (!current()) return;
        const signal = envelope.payload;
        if (!signal || signal.targetUserId && signal.targetUserId !== userId) return;
        if (Date.now() - signal.timestamp > 45_000) return;
        if (signal.type === 'call-request') {
          // If already in a call, notify caller that we're busy
          if (this.state === 'calling' || this.state === 'ringing' || this.state === 'connecting' || this.state === 'connected') {
            void this.sendDirectSignal(signal.conversationId, {
              type: 'call-decline',
              conversationId: signal.conversationId,
              callerId: userId,
              targetUserId: signal.callerId,
              timestamp: Date.now(),
            });
            return;
          }

          onIncomingCall({
            conversationId: signal.conversationId,
            callerId: signal.callerId,
            callerName: signal.callerName || 'Gayze member',
            callType: signal.callType || 'video',
            timestamp: signal.timestamp || Date.now(),
          });
        } else if (signal.type === 'call-end' || signal.type === 'call-decline') {
          onCallCancelled?.(signal.conversationId);
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
    if (!supabase) return;
    const client = supabase, generation = this.callGeneration;
    const channel = client.channel(topic, { config: { broadcast: { ack: true } } });
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
            void channel.send({ type: 'broadcast', event: 'call-signal', payload: signal }, { timeout: 5000 })
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
  }): Promise<void> {
    this.cleanup();
    const generation = this.callGeneration;
    this.setState('calling');
    this.currentCallType = params.callType;
    this.activeConversationId = params.conversationId;
    this.activeTargetUserId = params.targetUserId;

    try {
      // 1. Acquire local media stream first to verify permissions
      await this.acquireLocalMedia(params.callType, generation);
      if (generation !== this.callGeneration) return;

      // 2. Load short-lived TURN credentials before creating the peer connection
      await this.loadIceServers();
      if (generation !== this.callGeneration) return;

      // 3. Set up signaling channel for conversation
      await this.setupCallSignaling(params.conversationId, params.callerId, true);
      if (generation !== this.callGeneration) return;

      // 3. Send call-request to target user's personal channel
      if (params.targetUserId) {
        void this.sendTransientSignal(`gayze-user-${params.targetUserId}`, {
          type: 'call-request', conversationId: params.conversationId,
          callerId: params.callerId, callerName: params.callerName,
          targetUserId: params.targetUserId, callType: params.callType, timestamp: Date.now(),
        }).catch(() => undefined);
      }

      // Also broadcast on the conversation channel in case target is already on this screen
      await this.broadcastSignal({
        type: 'call-request',
        conversationId: params.conversationId,
        callerId: params.callerId,
        callerName: params.callerName,
        targetUserId: params.targetUserId,
        callType: params.callType,
        timestamp: Date.now(),
      });

      if (generation !== this.callGeneration) return;
      analytics.logEvent('call_started', { type: params.callType });

      // 4. Auto-timeout if no answer within 35 seconds
      this.ringingTimeoutTimer = window.setTimeout(() => {
        if (this.state === 'calling' || this.state === 'ringing') {
          this.endCall('missed');
        }
      }, 35000);
    } catch (err: any) {
      if (generation !== this.callGeneration) return;
      console.error('[GAYZE WebRTC] startCall failed:', err);
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
  }): Promise<void> {
    this.cleanup();
    const generation = this.callGeneration;
    this.setState('connecting');
    this.currentCallType = params.callType;
    this.activeConversationId = params.conversationId;
    this.activeTargetUserId = params.callerId;

    try {
      // 1. Acquire local media
      await this.acquireLocalMedia(params.callType, generation);
      if (generation !== this.callGeneration) return;

      // 2. Load short-lived TURN credentials before creating the peer connection
      await this.loadIceServers();
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
      analytics.logEvent('call_started', { type: params.callType, direction: 'incoming' });
    } catch (err: any) {
      if (generation !== this.callGeneration) return;
      console.error('[GAYZE WebRTC] acceptCall failed:', err);
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
  }): Promise<void> {
    const generation = this.callGeneration;
    try { await this.sendDirectSignal(params.conversationId, {
      type: 'call-decline',
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

    // Handle ICE candidates
    pc.onicecandidate = (event) => {
      if (this.pc === pc && event.candidate) {
        void this.broadcastSignal({
          type: 'ice-candidate',
          conversationId,
          callerId: currentUserId,
          candidate: event.candidate.toJSON(),
          timestamp: Date.now(),
        }).catch(() => this.scheduleRestart());
      }
    };

    pc.onconnectionstatechange = () => {
      if (this.pc !== pc) return;
      if (pc.connectionState === 'connected') this.recovered();
      else if (pc.connectionState === 'disconnected' || pc.connectionState === 'failed') {
        this.setState('connecting');
        this.scheduleRestart(pc.connectionState === 'disconnected' ? 5000 : 500);
      }
    };
    pc.oniceconnectionstatechange = () => {
      if (this.pc !== pc) return;
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
        client: supabase!, userId: currentUserId, topic: `gayze-call-${conversationId}`, syncWhileJoining: false,
        channelOptions: { config: { broadcast: { self: false, ack: true } } },
        session: (signal) => requireRealtimeSession(supabase!, currentUserId, signal),
        build: (channel, current) => {
          this.callChannel = channel;
          return channel.on('broadcast', { event: 'call-signal' }, (envelope: { payload: CallSignalPayload }) => {
            if (!current() || this.pc !== pc) return;
            const signal = envelope.payload;
            if (!signal || signal.conversationId !== conversationId || signal.callerId === currentUserId) return;
            // Ignore other peers/stale packets. This is defence in depth, not a
            // replacement for server-side Realtime channel authorization.
            if (signal.callerId !== this.activeTargetUserId && signal.callerId !== 'self') return;
            signalTail = signalTail.then(async () => {
              if (current() && this.pc === pc) await this.handleCallSignal(pc, signal);
            }).catch(() => { if (current() && this.pc === pc) this.scheduleRestart(); });
          });
        },
        reconcile: async () => {
          if (this.pc !== pc) return;
          clearTimeout(timeout);
          if (firstJoin) { firstJoin = false; resolve(); }
          else if (pc.remoteDescription) this.scheduleRestart(250);
          else if (!isCaller) {
            await this.broadcastSignal({ type: 'call-accept', conversationId, callerId: currentUserId, timestamp: Date.now() });
          }
        },
        status: (state) => {
          if (this.pc !== pc) return;
          if (state === 'sign-in-required') { clearTimeout(timeout); reject(new Error('Sign in required for calling')); this.cleanup(); this.setState('failed', 'Sign in again to call.'); }
          else if (!firstJoin && state !== 'connected') this.setState('connecting');
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
          if (!pc.remoteDescription) await this.sendOffer(false);
        }
        break;
      case 'ice-restart-request':
        if (this.caller) this.scheduleRestart(250);
        break;
      case 'offer':
        if (!this.caller && signal.sdp) {
          this.setState('connecting');
          // Refresh our relay credentials too before answering an ICE restart.
          const servers = await this.loadIceServers();
          if (this.pc !== pc) return;
          pc.setConfiguration({ ...pc.getConfiguration(), iceServers: servers });
          await pc.setRemoteDescription(signal.sdp);
          await this.flushCandidates(pc);
          const answer = await pc.createAnswer();
          if (this.pc !== pc) return;
          await pc.setLocalDescription(answer);
          await this.broadcastSignal({ type: 'answer', conversationId: signal.conversationId, callerId: this.localUserId, sdp: answer, timestamp: Date.now() });
        }
        break;
      case 'answer':
        if (this.caller && signal.sdp && pc.signalingState === 'have-local-offer') {
          await pc.setRemoteDescription(signal.sdp);
          await this.flushCandidates(pc);
        }
        break;
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
  private async sendOffer(restart: boolean) {
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
      await this.broadcastSignal({ type: 'offer', conversationId, callerId: this.localUserId, sdp: offer, timestamp: Date.now() });
      if (!restart) this.scheduleRestart(12_000); // lost initial SDP/answer also recovers
    } finally { if (this.pc === pc) this.offering = false; }
  }
  private async broadcastSignal(signal: CallSignalPayload): Promise<void> {
    if (!this.callChannel || this.callChannel.state !== 'joined') throw new Error('Call signalling reconnecting');
    const result = await this.callChannel.send({ type: 'broadcast', event: 'call-signal', payload: signal }, { timeout: 5000 });
    if (result !== 'ok') throw new Error('Call signal was not acknowledged');
  }

  /**
   * Acquire camera and microphone media streams
   */
  private async acquireLocalMedia(callType: CallType, generation = this.callGeneration): Promise<MediaStream> {
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      throw new Error('Your browser or device does not support real-time audio/video calls.');
    }

    const constraints: MediaStreamConstraints = {
      audio: {
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true,
      },
      video:
        callType === 'video'
          ? {
              facingMode: this.currentFacingMode,
              width: { ideal: 1280, max: 1920 },
              height: { ideal: 720, max: 1080 },
            }
          : false,
    };

    const stream = await navigator.mediaDevices.getUserMedia(constraints);
    if (generation !== this.callGeneration) { stream.getTracks().forEach((track) => track.stop()); throw new Error('Call ended'); }
    this.localStream = stream;
    this.notifyStreams();
    return stream;
  }

  /**
   * Audio mute/unmute
   */
  public toggleAudio(forceEnabled?: boolean): boolean {
    if (!this.localStream) return false;
    const audioTrack = this.localStream.getAudioTracks()[0];
    if (!audioTrack) return false;

    const newEnabled = forceEnabled !== undefined ? forceEnabled : !audioTrack.enabled;
    audioTrack.enabled = newEnabled;
    return newEnabled;
  }

  /**
   * Camera on/off
   */
  public toggleVideo(forceEnabled?: boolean): boolean {
    if (!this.localStream) return false;
    const videoTrack = this.localStream.getVideoTracks()[0];
    if (!videoTrack) return false;

    const newEnabled = forceEnabled !== undefined ? forceEnabled : !videoTrack.enabled;
    videoTrack.enabled = newEnabled;
    return newEnabled;
  }

  /**
   * Flip between front and rear cameras on mobile
   */
  public async flipCamera(): Promise<void> {
    if (this.currentCallType !== 'video' || !this.localStream) return;

    const nextMode = this.currentFacingMode === 'user' ? 'environment' : 'user';
    try {
      const newStream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: nextMode },
      });
      const newVideoTrack = newStream.getVideoTracks()[0];
      if (!newVideoTrack) return;

      const oldTrack = this.localStream.getVideoTracks()[0];
      if (oldTrack) {
        oldTrack.stop();
        this.localStream.removeTrack(oldTrack);
      }

      this.localStream.addTrack(newVideoTrack);
      this.currentFacingMode = nextMode;

      // Replace track on peer connection
      if (this.pc) {
        const senders = this.pc.getSenders();
        const videoSender = senders.find((s) => s.track?.kind === 'video');
        if (videoSender) {
          await videoSender.replaceTrack(newVideoTrack);
        }
      }

      this.notifyStreams();
    } catch (err) {
      console.warn('[GAYZE WebRTC] Camera flip not supported or denied', err);
    }
  }

  /**
   * End the call and cleanly stop all tracks and close connections
   */
  public async endCall(explicitState: CallState = 'ended'): Promise<void> {
    const generation = this.callGeneration, callerId = this.localUserId;
    const conversationId = this.activeConversationId;
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

    if (generation !== this.callGeneration) return;
    this.cleanup();
    this.setState(explicitState);
    // Send the ringing cancellation after local teardown, so closing media is
    // immediate and a subsequent call/account teardown can cancel this one-shot.
    if (targetUserId && conversationId && wasRinging) {
      void this.sendTransientSignal(`gayze-user-${targetUserId}`, {
        type: 'call-end', conversationId, callerId, timestamp: Date.now(),
      }).catch(() => undefined);
    }

    analytics.logEvent('call_completed', { outcome: explicitState });
  }

  /**
   * Complete teardown of all media and network resources
   */
  public cleanup() {
    ++this.callGeneration;
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
    this.callRecovery?.stop();
    this.callRecovery = null;
    this.callChannel = null;
    this.pendingIceCandidates = [];
    this.activeTargetUserId = null;

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
    this.notifyStreams();
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
