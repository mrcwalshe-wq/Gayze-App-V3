import { webrtcCallService } from './webrtcService';
import { enqueueCallNotification } from './callNotificationService';
import { endCallSession, startCallSession } from './callSessions';

import { unlockCallSounds } from './callSounds';

/**
 * Call sounds no longer use Web Audio (see callSounds.ts). These names stay because the call screens call them; they now
 * hand out no audio context, so nothing in a call can leave one open next to the microphone.
 */
export const getCallAudioContext = (): AudioContext | null => null;

/** Must be called directly from the user's call/accept tap so iOS/Safari lets the sounds play. */
export const primeCallAudio = (): void => { unlockCallSounds(); };

export const closeCallAudio = (): void => undefined;

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

    // Recorded first, so the person called can answer even if their app wakes up after the live signal.
    void startCallSession(callId, params.conversationId, params.targetUserId, params.callType);
    await originalStartCall({ ...params, callId });

    const state = webrtcCallService.getState();
    if (state !== 'calling' && state !== 'ringing') void endCallSession(callId, 'ended');
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
    void endCallSession(params.callId, 'answered');
    await originalAcceptCall(params);
    await markCallNotificationReadByConversation(params.conversationId);
  };

  webrtcCallService.declineCall = async (params) => {
    void endCallSession(params.callId, 'ended');
    await originalDeclineCall(params);
    await markCallNotificationReadByConversation(params.conversationId);
  };

  async function markCallNotificationReadByConversation(conversationId: string) {
    try {
      // @ts-ignore - dynamic import mapped at runtime
      const supabaseModule = await import(/* @vite-ignore */ './supabaseClient');
      const supabase = supabaseModule.supabase;
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
    const conversationId = Array.from(activeCall.keys()).pop();
    const call = conversationId ? activeCall.get(conversationId) : undefined;

    const wasRinging = webrtcCallService.getState() === 'calling' || webrtcCallService.getState() === 'ringing';
    if (call) void endCallSession(call.callId, 'ended');
    await originalEndCall(explicitState);

    // Unanswered however it ended: it timed out, the caller hung up while it rang, or it was declined.
    if (wasRinging && (explicitState === 'missed' || explicitState === 'ended' || explicitState === 'declined') && conversationId && call) {
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
