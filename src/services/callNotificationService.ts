import { supabase } from './supabaseClient';

export type CallNotificationType = 'call' | 'missed_call';

export async function enqueueCallNotification(params: {
  conversationId: string;
  targetUserId: string;
  callId: string;
  callType: 'audio' | 'video';
  kind: CallNotificationType;
}): Promise<string | null> {
  if (!supabase) return null;
  try {
    const { data, error } = await supabase.rpc('gayze_call_notification', {
      p_conversation: params.conversationId,
      p_recipient: params.targetUserId,
      p_call_id: params.callId,
      p_call_type: params.callType,
      p_category: params.kind,
    });
    if (error) {
      console.warn('[GAYZE] Call notification request failed:', error.message);
      return null;
    }
    return typeof data === 'string' ? data : null;
  } catch (error) {
    console.warn('[GAYZE] Call notification request failed:', error);
    return null;
  }
}

export async function markCallNotificationRead(notificationId: string | null): Promise<void> {
  if (!supabase || !notificationId) return;
  try {
    const { error } = await supabase.rpc('gayze_mark_notification_read', {
      p_id: notificationId,
      p_conversation: null,
    });
    if (error) console.warn('[GAYZE] Could not clear call notification:', error.message);
  } catch (error) {
    console.warn('[GAYZE] Could not clear call notification:', error);
  }
}
