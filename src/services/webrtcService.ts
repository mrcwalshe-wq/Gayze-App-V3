import { supabase } from './supabaseClient';
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
    | 'ice-candidate';
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
  const envIce = import.meta.env.VITE_ICE_SERVERS_JSON as string | undefined;
  if (envIce) {
    try {
      const parsed = JSON.parse(envIce);
      if (Array.isArray(parsed) && parsed.length > 0) return parsed;
    } catch (e) {
      console.warn('[GAYZE WebRTC] Failed to parse VITE_ICE_SERVERS_JSON, falling back to STUN defaults', e);
    }
  }

  const turnUrl = import.meta.env.VITE_TURN_URL as string | undefined;
  const turnUsername = import.meta.env.VITE_TURN_USERNAME as string | undefined;
  const turnCredential = import.meta.env.VITE_TURN_CREDENTIAL as string | undefined;

  const defaultStunServers: RTCIceServer[] = [
    { urls: 'stun:stun.l.google.com:19302' },
    { urls: 'stun:stun1.l.google.com:19302' },
    { urls: 'stun:stun2.l.google.com:19302' },
    { urls: 'stun:stun3.l.google.com:19302' },
  ];

  if (turnUrl) {
    defaultStunServers.push({
      urls: turnUrl,
      username: turnUsername,
      credential: turnCredential,
    });
  }

  return defaultStunServers;
}

class WebRTCCallService {
  private localStream: MediaStream | null = null;
  private remoteStream: MediaStream | null = null;
  private pc: RTCPeerConnection | null = null;
  private callChannel: RealtimeChannel | null = null;
  private userChannel: RealtimeChannel | null = null;

  private state: CallState = 'idle';
  private errorMessage: string | null = null;
  private currentFacingMode: 'user' | 'environment' = 'user';
  private currentCallType: CallType = 'video';
  private activeConversationId: string | null = null;
  private activeTargetUserId: string | null = null;
  private ringingTimeoutTimer: number | null = null;
  private pendingIceCandidates: RTCIceCandidateInit[] = [];

  constructor() {
    if (typeof window !== 'undefined') {
      window.addEventListener('beforeunload', () => {
        this.cleanup();
      });
      window.addEventListener('pagehide', () => {
        this.cleanup();
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

    if (this.userChannel) {
      void supabase.removeChannel(this.userChannel);
      this.userChannel = null;
    }

    const channelName = `gayze-user-${userId}`;
    const channel = supabase.channel(channelName, {
      config: { broadcast: { self: false } },
    });

    channel
      .on('broadcast', { event: 'call-signal' }, (envelope: { payload: CallSignalPayload }) => {
        const signal = envelope.payload;
        if (signal.type === 'call-request') {
          // If already in a call, notify caller that we're busy
          if (this.state !== 'idle') {
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
      })
      .subscribe();

    this.userChannel = channel;

    return () => {
      if (this.userChannel && supabase) {
        void supabase.removeChannel(this.userChannel);
        this.userChannel = null;
      }
    };
  }

  /**
   * Helper to send broadcast on a conversation channel
   */
  private async sendDirectSignal(conversationId: string, signal: CallSignalPayload): Promise<void> {
    if (!supabase) return;
    const client = supabase;
    if (this.callChannel && this.activeConversationId === conversationId) {
      await this.callChannel.send({
        type: 'broadcast',
        event: 'call-signal',
        payload: signal,
      });
      return;
    }

    // Temporary channel send if callChannel not yet joined
    const temp = client.channel(`gayze-call-${conversationId}`);
    temp.subscribe(async (status) => {
      if (status === 'SUBSCRIBED') {
        await temp.send({
          type: 'broadcast',
          event: 'call-signal',
          payload: signal,
        });
        void client.removeChannel(temp);
      }
    });
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
    this.setState('calling');
    this.currentCallType = params.callType;
    this.activeConversationId = params.conversationId;
    this.activeTargetUserId = params.targetUserId;

    try {
      // 1. Acquire local media stream first to verify permissions
      await this.acquireLocalMedia(params.callType);

      // 2. Set up signaling channel for conversation
      await this.setupCallSignaling(params.conversationId, params.callerId, true);

      // 3. Send call-request to target user's personal channel
      if (supabase && params.targetUserId) {
        const client = supabase;
        const userTargetChannel = client.channel(`gayze-user-${params.targetUserId}`);
        userTargetChannel.subscribe(async (status) => {
          if (status === 'SUBSCRIBED') {
            await userTargetChannel.send({
              type: 'broadcast',
              event: 'call-signal',
              payload: {
                type: 'call-request',
                conversationId: params.conversationId,
                callerId: params.callerId,
                callerName: params.callerName,
                targetUserId: params.targetUserId,
                callType: params.callType,
                timestamp: Date.now(),
              },
            });
            void client.removeChannel(userTargetChannel);
          }
        });
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

      // 4. Auto-timeout if no answer within 35 seconds
      this.ringingTimeoutTimer = window.setTimeout(() => {
        if (this.state === 'calling' || this.state === 'ringing') {
          this.endCall('missed');
        }
      }, 35000);
    } catch (err: any) {
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
    this.setState('connecting');
    this.currentCallType = params.callType;
    this.activeConversationId = params.conversationId;

    try {
      // 1. Acquire local media
      await this.acquireLocalMedia(params.callType);

      // 2. Join signaling channel
      await this.setupCallSignaling(params.conversationId, params.userId, false);

      // 3. Notify caller that call was accepted
      await this.broadcastSignal({
        type: 'call-accept',
        conversationId: params.conversationId,
        callerId: params.userId,
        targetUserId: params.callerId,
        callType: params.callType,
        timestamp: Date.now(),
      });
    } catch (err: any) {
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
    await this.sendDirectSignal(params.conversationId, {
      type: 'call-decline',
      conversationId: params.conversationId,
      callerId: params.userId,
      targetUserId: params.callerId,
      timestamp: Date.now(),
    });
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
      iceServers: getIceServers(),
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
      if (event.streams && event.streams[0]) {
        this.remoteStream = event.streams[0];
      } else {
        if (!this.remoteStream) {
          this.remoteStream = new MediaStream();
        }
        this.remoteStream.addTrack(event.track);
      }
      this.notifyStreams();
      this.setState('connected');
    };

    // Handle ICE candidates
    pc.onicecandidate = (event) => {
      if (event.candidate) {
        void this.broadcastSignal({
          type: 'ice-candidate',
          conversationId,
          callerId: currentUserId,
          candidate: event.candidate.toJSON(),
          timestamp: Date.now(),
        });
      }
    };

    // Connection state changes
    pc.onconnectionstatechange = () => {
      switch (pc.connectionState) {
        case 'connected':
          this.setState('connected');
          break;
        case 'disconnected':
        case 'failed':
          this.setState('failed', 'WebRTC connection interrupted');
          break;
        case 'closed':
          if (this.state !== 'ended' && this.state !== 'declined') {
            this.setState('ended');
          }
          break;
      }
    };

    pc.oniceconnectionstatechange = () => {
      if (pc.iceConnectionState === 'connected' || pc.iceConnectionState === 'completed') {
        this.setState('connected');
      } else if (pc.iceConnectionState === 'failed') {
        console.warn('[GAYZE WebRTC] ICE connection failed, attempting restart');
        pc.restartIce();
      }
    };

    this.pc = pc;
    return pc;
  }

  /**
   * Set up Realtime signaling channel for WebRTC negotiation
   */
  private async setupCallSignaling(conversationId: string, currentUserId: string, isCaller: boolean): Promise<void> {
    if (!supabase) throw new Error('Supabase Realtime is required for calling');

    if (this.callChannel) {
      void supabase.removeChannel(this.callChannel);
      this.callChannel = null;
    }

    const pc = this.setupPeerConnection(conversationId, currentUserId);
    const channelName = `gayze-call-${conversationId}`;
    const channel = supabase.channel(channelName, {
      config: { broadcast: { self: false } },
    });

    channel.on('broadcast', { event: 'call-signal' }, async (envelope: { payload: CallSignalPayload }) => {
      const signal = envelope.payload;
      if (signal.conversationId !== conversationId) return;

      try {
        switch (signal.type) {
          case 'call-ringing':
            if (this.state === 'calling') {
              this.setState('ringing');
            }
            break;

          case 'call-accept':
            if (isCaller) {
              if (this.ringingTimeoutTimer) {
                clearTimeout(this.ringingTimeoutTimer);
                this.ringingTimeoutTimer = null;
              }
              this.setState('connecting');
              // Create and send SDP offer
              const offer = await pc.createOffer({
                offerToReceiveAudio: true,
                offerToReceiveVideo: this.currentCallType === 'video',
              });
              await pc.setLocalDescription(offer);
              await this.broadcastSignal({
                type: 'offer',
                conversationId,
                callerId: currentUserId,
                sdp: offer,
                timestamp: Date.now(),
              });
            }
            break;

          case 'offer':
            if (!isCaller && signal.sdp) {
              this.setState('connecting');
              await pc.setRemoteDescription(new RTCSessionDescription(signal.sdp));
              if (this.pendingIceCandidates.length > 0) {
                for (const cand of this.pendingIceCandidates) {
                  try {
                    await pc.addIceCandidate(new RTCIceCandidate(cand));
                  } catch (e) {
                    console.warn('[GAYZE WebRTC] Error adding buffered ICE candidate', e);
                  }
                }
                this.pendingIceCandidates = [];
              }
              const answer = await pc.createAnswer();
              await pc.setLocalDescription(answer);
              await this.broadcastSignal({
                type: 'answer',
                conversationId,
                callerId: currentUserId,
                sdp: answer,
                timestamp: Date.now(),
              });
            }
            break;

          case 'answer':
            if (isCaller && signal.sdp) {
              await pc.setRemoteDescription(new RTCSessionDescription(signal.sdp));
              if (this.pendingIceCandidates.length > 0) {
                for (const cand of this.pendingIceCandidates) {
                  try {
                    await pc.addIceCandidate(new RTCIceCandidate(cand));
                  } catch (e) {
                    console.warn('[GAYZE WebRTC] Error adding buffered ICE candidate', e);
                  }
                }
                this.pendingIceCandidates = [];
              }
            }
            break;

          case 'ice-candidate':
            if (signal.candidate) {
              if (pc.remoteDescription && pc.remoteDescription.type) {
                try {
                  await pc.addIceCandidate(new RTCIceCandidate(signal.candidate));
                } catch (e) {
                  console.warn('[GAYZE WebRTC] Error adding ICE candidate', e);
                }
              } else {
                this.pendingIceCandidates.push(signal.candidate);
              }
            }
            break;

          case 'call-decline':
            this.setState('declined');
            this.cleanup();
            break;

          case 'call-end':
            this.setState('ended');
            this.cleanup();
            break;
        }
      } catch (err: any) {
        console.error('[GAYZE WebRTC] Signaling dispatch error:', err);
      }
    });

    await new Promise<void>((resolve) => {
      channel.subscribe((status) => {
        if (status === 'SUBSCRIBED') {
          resolve();
        }
      });
    });

    this.callChannel = channel;
  }

  private async broadcastSignal(signal: CallSignalPayload): Promise<void> {
    if (!this.callChannel) return;
    await this.callChannel.send({
      type: 'broadcast',
      event: 'call-signal',
      payload: signal,
    });
  }

  /**
   * Acquire camera and microphone media streams
   */
  private async acquireLocalMedia(callType: CallType): Promise<MediaStream> {
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
    if (this.callChannel && this.activeConversationId) {
      try {
        await this.broadcastSignal({
          type: 'call-end',
          conversationId: this.activeConversationId,
          callerId: 'self',
          timestamp: Date.now(),
        });
      } catch (e) {
        console.warn('[GAYZE WebRTC] Error sending call-end signal', e);
      }
    }

    // If caller cancels before callee answered, also send call-end to target user channel
    if (supabase && this.activeTargetUserId && this.activeConversationId && (this.state === 'calling' || this.state === 'ringing')) {
      const client = supabase;
      const targetUserChan = client.channel(`gayze-user-${this.activeTargetUserId}`);
      targetUserChan.subscribe(async (status) => {
        if (status === 'SUBSCRIBED') {
          await targetUserChan.send({
            type: 'broadcast',
            event: 'call-signal',
            payload: {
              type: 'call-end',
              conversationId: this.activeConversationId!,
              callerId: 'self',
              timestamp: Date.now(),
            },
          });
          void client.removeChannel(targetUserChan);
        }
      });
    }

    this.cleanup();
    this.setState(explicitState);
  }

  /**
   * Complete teardown of all media and network resources
   */
  public cleanup() {
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
      try {
        this.pc.close();
      } catch (e) {
        console.warn('[GAYZE WebRTC] PeerConnection close exception:', e);
      }
      this.pc = null;
    }

    // 4. Remove signaling channel
    if (this.callChannel && supabase) {
      void supabase.removeChannel(this.callChannel);
      this.callChannel = null;
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
