import { webrtcCallService } from './webrtcService';
import { enqueueCallNotification } from './callNotificationService';

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

// Bridge WebRTC call lifecycle events to the durable push-notification system.
// This keeps provider/database notification details outside the WebRTC service.
const bridgeKey = '__gayzeCallNotificationBridgeInstalled__';
type WindowWithGayzeBridge = Window & { [bridgeKey]?: boolean };

if (typeof window !== 'undefined' && !(window as WindowWithGayzeBridge)[bridgeKey]) {
  (window as WindowWithGayzeBridge)[bridgeKey] = true;

  const originalStartCall = webrtcCallService.startCall.bind(webrtcCallService);
  const originalEndCall = webrtcCallService.endCall.bind(webrtcCallService);
  const originalAcceptCall = webrtcCallService.acceptCall.bind(webrtcCallService);
  const originalDeclineCall = webrtcCallService.declineCall.bind(webrtcCallService);
  const activeCall = new Map<string, { callId: string; targetUserId: string; callType: 'audio' | 'video' }>();

  webrtcCallService.startCall = async (params) => {
    const callId = crypto.randomUUID();
    activeCall.set(params.conversationId, {
      callId,
      targetUserId: params.targetUserId,
      callType: params.callType,
    });

    await originalStartCall(params);

    const state = webrtcCallService.getState();
    if (state === 'calling' || state === 'ringing') {
      await enqueueCallNotification({
        conversationId: params.conversationId,
        targetUserId: params.targetUserId,
        callId,
        callType: params.callType,
        kind: 'call',
      });
    } else {
      activeCall.delete(params.conversationId);
    }
  };

  webrtcCallService.acceptCall = async (params) => {
    await originalAcceptCall(params);
    await markCallNotificationReadByConversation(params.conversationId);
  };

  webrtcCallService.declineCall = async (params) => {
    await originalDeclineCall(params);
    await markCallNotificationReadByConversation(params.conversationId);
  };

  async function markCallNotificationReadByConversation(conversationId: string) {
    try {
      const { supabase } = await import('./supabaseClient');
      if (!supabase) return;
      const { error } = await supabase.rpc('gayze_mark_notification_read', {
        p_id: null,
        p_conversation: conversationId,
      });
      if (error) console.warn('[GAYZE] Could not clear call notification:', error.message);
    } catch (error) {
      console.warn('[GAYZE] Could not clear call notification:', error);
    }
  }

  webrtcCallService.endCall = async (explicitState = 'ended') => {
    const conversationId = activeCall.keys().next().value as string | undefined;
    const call = conversationId ? activeCall.get(conversationId) : undefined;

    await originalEndCall(explicitState);

    if (explicitState === 'missed' && conversationId && call) {
      await enqueueCallNotification({
        conversationId,
        targetUserId: call.targetUserId,
        callId: call.callId,
        callType: call.callType,
        kind: 'missed_call',
      });
    }

    if (conversationId) activeCall.delete(conversationId);
  };
}
