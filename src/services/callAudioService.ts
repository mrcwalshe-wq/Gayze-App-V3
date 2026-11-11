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
  const statusWatches = new Map<string, number>();
  const terminalStates = new Set(['idle', 'ended', 'declined', 'missed', 'failed']);

  const persistCallStatus = (callId: string | undefined, status: 'answered' | 'ended') =>
    endCallSession(callId, status).catch((error) => {
      console.warn('[GAYZE] Could not persist call status:', error);
    });

  const stopCallStatusWatch = (callId: string) => {
    const timer = statusWatches.get(callId);
    if (timer !== undefined) window.clearInterval(timer);
    statusWatches.delete(callId);
  };

  const watchCallStatus = (callId: string) => {
    stopCallStatusWatch(callId);
    let checking = false;
    const timer = window.setInterval(async () => {
      const currentState = webrtcCallService.getState();
      if (webrtcCallService.currentCallId() !== callId || terminalStates.has(currentState)) {
        stopCallStatusWatch(callId);
        return;
      }
      if (checking) return;
      checking = true;
      try {
        const status = await getCallStatus(callId);
        if (webrtcCallService.currentCallId() !== callId) return;
        const state = webrtcCallService.getState();
        if (status === 'ended') {
          stopCallStatusWatch(callId);
          webrtcCallService.remoteEnded(state === 'calling' || state === 'ringing' ? 'declined' : 'ended');
        } else if (status === 'answered' && (state === 'calling' || state === 'ringing')) {
          webrtcCallService.remoteAnswered();
        }
      } catch (error) {
        console.warn('[GAYZE] Call status check failed:', error);
      } finally {
        checking = false;
      }
    }, 2000);
    statusWatches.set(callId, timer);
  };

  // Clear durable-call tracking when the WebRTC service reaches any terminal state.
  // This also covers remote call-end signals and media failures that bypass endCall().
  webrtcCallService.subscribeState((state) => {
    if (!terminalStates.has(state)) return;
    const endedCallId = webrtcCallService.recentCallId();
    if (!endedCallId) return;
    stopCallStatusWatch(endedCallId);
    for (const [conversationId, call] of activeCall) {
      if (call.callId !== endedCallId) continue;
      activeCall.delete(conversationId);
      if (state !== 'idle') void persistCallStatus(call.callId, 'ended');
    }
  });

  webrtcCallService.startCall = async (params) => {
    const callId = crypto.randomUUID();
    activeCall.set(params.conversationId, {
      callId,
      targetUserId: params.targetUserId,
      callType: params.callType,
    });

    // Persist the call session before signalling starts. The offer mailbox and VoIP push trigger both depend on this row existing.
    try {
      await startCallSession(callId, params.conversationId, params.targetUserId, params.callType);
    } catch (error) {
      console.warn('[GAYZE] Could not create the durable call session:', error);
    }
    // The user may have cancelled while the session write was in flight. Mark the row ended
    // again after the insert resolves, so a late insert cannot leave a phantom ringing call.
    if (activeCall.get(params.conversationId)?.callId !== callId) {
      await persistCallStatus(callId, 'ended');
      return;
    }

    await originalStartCall({ ...params, callId });

    const state = webrtcCallService.getState();
    if (state === 'calling' || state === 'ringing' || state === 'connecting' || state === 'connected') {
      // Keep checking for the full call, not only while ringing. A quick answer can arrive before startCall resolves;
      // native CallKit calls also need server-side hang-up recovery when the web view is asleep.
      watchCallStatus(callId);
      if (state === 'calling' || state === 'ringing') {
        await enqueueCallNotification({
          conversationId: params.conversationId,
          targetUserId: params.targetUserId,
          callId,
          callType: params.callType,
          kind: 'call',
        });
      }
    } else {
      activeCall.delete(params.conversationId);
      await persistCallStatus(callId, 'ended');
    }
  };

  webrtcCallService.acceptCall = async (params) => {
    // Track incoming calls too, so a hang-up from this device updates the durable
    // session and the caller can recover even if the live call-end broadcast is lost.
    const initialCallId = params.callId || webrtcCallService.currentCallId();
    if (initialCallId) {
      activeCall.set(params.conversationId, {
        callId: initialCallId,
        targetUserId: params.callerId,
        callType: params.callType,
      });
    }

    await originalAcceptCall(params);

    const callId = params.callId || webrtcCallService.currentCallId();
    const state = webrtcCallService.getState();
    if (callId && (state === 'connecting' || state === 'connected')) {
      activeCall.set(params.conversationId, {
        callId,
        targetUserId: params.callerId,
        callType: params.callType,
      });
      watchCallStatus(callId);
      await persistCallStatus(callId, 'answered');
    } else if (callId) {
      await persistCallStatus(callId, 'ended');
    }
    await markCallNotificationReadByConversation(params.conversationId);
  };

  webrtcCallService.declineCall = async (params) => {
    const sessionUpdate = persistCallStatus(params.callId, 'ended');
    await originalDeclineCall(params);
    await sessionUpdate;
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
    const sessionUpdate = call ? persistCallStatus(call.callId, 'ended') : Promise.resolve();
    await originalEndCall(explicitState);
    await sessionUpdate;

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
