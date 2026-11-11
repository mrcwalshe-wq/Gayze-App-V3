import { webrtcCallService } from './webrtcService';
import { enqueueCallNotification } from './callNotificationService';
import { endCallSession, getCallStatus, startCallSession } from './callSessions';

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
  const endingCallIds = new Set<string>();

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
      // If the other person declines (or hangs up on the ring) and the live decline signal never arrives, the server still knows.
      const watch = window.setInterval(async () => {
        const now = webrtcCallService.getState();
        if (webrtcCallService.currentCallId() !== callId || now === 'idle' || now === 'ended' || now === 'declined' || now === 'failed' || now === 'missed') { window.clearInterval(watch); return; }
        if (now === 'connecting' || now === 'connected') {
          // The other phone may be carrying the call natively (answered on its lock screen) and cannot send the live "call ended"
          // signal, so an answered call that was hung up there is learned from the server.
          if ((await getCallStatus(callId)) === 'ended' && webrtcCallService.currentCallId() === callId) { window.clearInterval(watch); webrtcCallService.remoteEnded('ended'); }
          return;
        }
        const status = await getCallStatus(callId);
        // Answered on the server but still ringing here: the live accept was missed (phone answered from the lock screen).
        if (status === 'answered') webrtcCallService.remoteAnswered();
        if (status === 'ended') {
          window.clearInterval(watch);
          const again = webrtcCallService.getState();
          if ((again === 'calling' || again === 'ringing') && webrtcCallService.currentCallId() === callId) webrtcCallService.remoteEnded('declined');
        }
      }, 2000);
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
    // This wrapper also writes call-session and missed-call records. Guard it
    // separately so overlapping UI teardown paths cannot duplicate those writes.
    if (call && endingCallIds.has(call.callId)) return;
    if (call) endingCallIds.add(call.callId);

    try {
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

    } finally {
      if (conversationId) activeCall.delete(conversationId);
      if (call) endingCallIds.delete(call.callId);
    }
  };
}
