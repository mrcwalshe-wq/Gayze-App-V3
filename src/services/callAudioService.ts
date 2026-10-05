import { webrtcCallService } from './webrtcService';
import { enqueueCallNotification, type CallNotificationType } from './callNotificationService';

let callAudioContext: AudioContext | null = null;

const getCtor = () => window.AudioContext || (window as typeof window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;

export const getCallAudioContext = (): AudioContext | null => {
  if (typeof window === 'undefined') return null;
  const Ctor = getCtor();
  if (!Ctor) return null;
  if (!callAudioContext || callAudioContext.state === 'closed') callAudioContext = new Ctor();
  return callAudioContext;
};

/** Must be called directly from the user's call/accept tap so iOS/Safari grants audio activation. */
export const primeCallAudio = (): void => {
  const ctx = getCallAudioContext();
  if (!ctx) return;
  void ctx.resume().catch(() => undefined);
};

export const closeCallAudio = (): void => {
  const ctx = callAudioContext;
  callAudioContext = null;
  if (ctx) void ctx.close().catch(() => undefined);
};

// The WebRTC service intentionally remains transport-focused. This bridge adds
// the durable push layer without coupling WebRTC signalling to notification
// provider details. It is installed once when this module is loaded (App and
// EncryptedCallModal both import this module).
const bridgeKey = '__gayzeCallNotificationBridgeInstalled__';
type WindowWithGayzeBridge = Window & { [bridgeKey]?: boolean };

if (typeof window !== 'undefined' && !(window as WindowWithGayzeBridge)[bridgeKey]) {
  (window as WindowWithGayzeBridge)[bridgeKey] = true;

  const originalStartCall = webrtcCallService.startCall.bind(webrtcCallService);
  const originalEndCall = webrtcCallService.endCall.bind(webrtcCallService);

  const callIds = new Map<string, string>();

  webrtcCallService.startCall = async (params) => {
    const callId = crypto.randomUUID();
    callIds.set(params.conversationId, callId);
    await originalStartCall(params);

    const state = webrtcCallService.getState();
    if (state === 'calling' || state === 'ringing') {
      await enqueueCallNotification({
        conversationId: params.conversationId,
        targetUserId: params.targetUserId,
        callId,
        callType: params.callType,
        kind: 'call' as CallNotificationType,
      });
    } else {
      callIds.delete(params.conversationId);
    }
  };

  webrtcCallService.endCall = async (explicitState = 'ended') => {
    const conversationId = webrtcCallService.getActiveConversationId?.() ?? null;
    const targetUserId = webrtcCallService.getActiveTargetUserId?.() ?? null;
    const callId = conversationId ? callIds.get(conversationId) : undefined;

    await originalEndCall(explicitState);

    if (explicitState === 'missed' && conversationId && targetUserId && callId) {
      await enqueueCallNotification({
        conversationId,
        targetUserId,
        callId,
        callType: webrtcCallService.getCurrentCallType?.() ?? 'video',
        kind: 'missed_call' as CallNotificationType,
      });
    }

    if (conversationId) callIds.delete(conversationId);
  };
}
