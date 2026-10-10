// Browser page driving the REAL webrtcService (no mocks of WebRTC, media or the service).
import { webrtcCallService, getIceServers } from '../../../src/services/webrtcService';
import { relayControl } from './fakeSupabase';

const params = new URLSearchParams(location.search);
const userId = params.get('u') || 'anon';
const remoteVideo = document.getElementById('remote') as HTMLVideoElement;
const localVideo = document.getElementById('local') as HTMLVideoElement;
const remoteAudio = document.getElementById('remote-audio') as HTMLAudioElement;

let incoming: unknown = null;
const events: string[] = [];
webrtcCallService.subscribeState((state, error) => { events.push(`${state}${error ? `:${error}` : ''}`); });
webrtcCallService.subscribeStreams((local, remote) => {
  localVideo.srcObject = local;
  remoteVideo.srcObject = remote;
  remoteAudio.srcObject = remote;
  if (remote) void remoteVideo.play().catch(() => undefined);
});

webrtcCallService.initUserSignaling(
  userId,
  (call) => { incoming = call; },
  (conversationId) => { if ((incoming as { conversationId?: string })?.conversationId === conversationId) incoming = null; },
);

type Conn = { connectionState?: string; iceConnectionState?: string; getStats(): Promise<RTCStatsReport> };
function pc(): Conn | null { return (webrtcCallService as unknown as { pc: Conn | null }).pc; }

async function mediaSnapshot() {
  const local = webrtcCallService.getLocalStream();
  const remote = webrtcCallService.getRemoteStream();
  const tracks = (s: MediaStream | null) => (s ? s.getTracks().map((t) => ({ kind: t.kind, enabled: t.enabled, readyState: t.readyState, muted: t.muted })) : []);
  let selectedPair: Record<string, unknown> | null = null;
  let inbound: Record<string, unknown>[] = [];
  const connection = pc();
  if (connection) {
    const stats = await connection.getStats();
    const byId = new Map<string, any>();
    stats.forEach((s: any) => byId.set(s.id, s));
    stats.forEach((s: any) => {
      if (s.type === 'transport' && s.selectedCandidatePairId) {
        const pair = byId.get(s.selectedCandidatePairId);
        if (pair) {
          const local = byId.get(pair.localCandidateId), remote = byId.get(pair.remoteCandidateId);
          selectedPair = { state: pair.state, local: local?.candidateType, localProtocol: local?.protocol, remote: remote?.candidateType, bytesSent: pair.bytesSent, bytesReceived: pair.bytesReceived };
        }
      }
      if (s.type === 'inbound-rtp' && !s.isRemote) inbound.push({ kind: s.kind, bytesReceived: s.bytesReceived, packetsReceived: s.packetsReceived, framesDecoded: s.framesDecoded ?? null, totalAudioEnergy: s.totalAudioEnergy ?? null });
    });
  }
  return {
    state: webrtcCallService.getState(),
    error: webrtcCallService.getErrorMessage(),
    pcState: connection?.connectionState ?? null,
    iceState: connection?.iceConnectionState ?? null,
    local: tracks(local),
    remote: tracks(remote),
    audioEnabled: webrtcCallService.isAudioEnabled(),
    videoEnabled: webrtcCallService.isVideoEnabled(),
    selectedPair,
    inbound,
    remoteVideo: { width: remoteVideo.videoWidth, height: remoteVideo.videoHeight, currentTime: remoteVideo.currentTime, paused: remoteVideo.paused },
    events: [...events],
    incoming: incoming ? { ...(incoming as object) } : null,
  };
}

(window as unknown as Record<string, unknown>).__gayze = {
  userId,
  iceServers: getIceServers(),
  snapshot: mediaSnapshot,
  incoming: () => incoming,
  startCall: (peerId: string, callType: 'audio' | 'video', conversationId: string) => webrtcCallService.startCall({
    conversationId, callerId: userId, callerName: `User ${userId}`, targetUserId: peerId, targetUserName: `User ${peerId}`, callType,
  }),
  acceptIncoming: () => {
    const call = incoming as { callId?: string; conversationId: string; callerId: string; callType: 'audio' | 'video'; callerName: string };
    incoming = null;
    return webrtcCallService.acceptCall({ conversationId: call.conversationId, callerId: call.callerId, userId, callType: call.callType, callerName: call.callerName, callId: call.callId });
  },
  declineIncoming: () => {
    const call = incoming as { callId?: string; conversationId: string; callerId: string; callerName: string };
    incoming = null;
    return webrtcCallService.declineCall({ conversationId: call.conversationId, callerId: call.callerId, userId, callerName: call.callerName, callId: call.callId });
  },
  endCall: () => webrtcCallService.endCall(),
  toggleAudio: (force?: boolean) => webrtcCallService.toggleAudio(force),
  toggleVideo: (force?: boolean) => webrtcCallService.toggleVideo(force),
  relay: relayControl,
};
(window as unknown as Record<string, unknown>).__ready = true;
