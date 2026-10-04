import { supabase } from './supabaseClient';
import { markCallRecordsAsRead, getUnreadCallCount } from './callHistoryService';
import type { IncomingCall } from './webrtcService';

/**
 * Call notification service that integrates with the existing notification pipeline.
 * Handles incoming call notifications, missed call notifications, and call history updates.
 */

export interface CallNotification {
  id: string;
  type: 'incoming_call' | 'missed_call' | 'call_ended';
  conversationId: string;
  callerId: string;
  callerName: string;
  callType: 'audio' | 'video';
  timestamp: number;
  isRead: boolean;
  title: string;
  body: string;
  data?: {
    conversationId: string;
    callerId: string;
    callType: 'audio' | 'video';
    timestamp: number;
  };
}

/**
 * Send a push notification for an incoming call
 * Integrates with the existing notification pipeline
 */
export async function sendIncomingCallNotification(call: IncomingCall): Promise<boolean> {
  if (!supabase) return false;

  try {
    const user = await ensureSupabaseSession();
    if (!user) return false;

    // Don't send notification to the caller
    if (call.callerId === user.id) return false;

    const notificationData = {
      user_id: call.targetUserId || user.id, // Send to target user
      actor_id: call.callerId,
      category: 'call',
      url: `/messages/${call.conversationId}?call=incoming`,
      created_at: new Date().toISOString(),
      read_at: null,
    };

    const { error } = await supabase
      .from('gayze_notifications')
      .insert(notificationData);

    if (error) {
      console.warn('[GAYZE] Failed to send incoming call notification:', error.message);
      return false;
    }

    return true;
  } catch (err: any) {
    console.warn('[GAYZE] Incoming call notification exception:', err?.message || err);
    return false;
  }
}

/**
 * Send a push notification for a missed call
 */
export async function sendMissedCallNotification(call: IncomingCall): Promise<boolean> {
  if (!supabase) return false;

  try {
    const user = await ensureSupabaseSession();
    if (!user) return false;

    // Don't send notification to the caller
    if (call.callerId === user.id) return false;

    const notificationData = {
      user_id: call.targetUserId || user.id, // Send to target user
      actor_id: call.callerId,
      category: 'missed_call',
      url: `/messages/${call.conversationId}?call=missed`,
      created_at: new Date().toISOString(),
      read_at: null,
    };

    const { error } = await supabase
      .from('gayze_notifications')
      .insert(notificationData);

    if (error) {
      console.warn('[GAYZE] Failed to send missed call notification:', error.message);
      return false;
    }

    return true;
  } catch (err: any) {
    console.warn('[GAYZE] Missed call notification exception:', err?.message || err);
    return false;
  }
}

/**
 * Send a push notification for call ended
 */
export async function sendCallEndedNotification(
  conversationId: string,
  callerId: string,
  callType: 'audio' | 'video',
  durationSeconds: number
): Promise<boolean> {
  if (!supabase) return false;

  try {
    const user = await ensureSupabaseSession();
    if (!user) return false;

    // Don't send notification to the caller
    if (callerId === user.id) return false;

    const notificationData = {
      user_id: user.id,
      actor_id: callerId,
      category: 'call_ended',
      url: `/messages/${conversationId}?call=ended`,
      created_at: new Date().toISOString(),
      read_at: null,
    };

    const { error } = await supabase
      .from('gayze_notifications')
      .insert(notificationData);

    if (error) {
      console.warn('[GAYZE] Failed to send call ended notification:', error.message);
      return false;
    }

    return true;
  } catch (err: any) {
    console.warn('[GAYZE] Call ended notification exception:', err?.message || err);
    return false;
  }
}

/**
 * Load call-related notifications for the current user
 */
export async function loadCallNotifications(): Promise<CallNotification[]> {
  if (!supabase) return [];

  try {
    const user = await ensureSupabaseSession();
    if (!user) return [];

    const { data, error } = await supabase
      .from('gayze_notifications')
      .select('id,actor_id,category,url,created_at,read_at')
      .eq('user_id', user.id)
      .in('category', ['call', 'missed_call', 'call_ended'])
      .order('created_at', { ascending: false });

    if (error) {
      console.warn('[GAYZE] Failed to load call notifications:', error.message);
      return [];
    }

    return (data ?? []).map((row: any) => {
      const url = new URL(row.url, 'https://gayze.local');
      const conversationId = url.pathname.split('/')[2];
      const searchParams = new URLSearchParams(url.search);
      const callType = searchParams.get('callType') as 'audio' | 'video' || 'video';

      return {
        id: row.id,
        type: row.category === 'call' ? 'incoming_call' : row.category === 'missed_call' ? 'missed_call' : 'call_ended',
        conversationId,
        callerId: row.actor_id,
        callerName: 'Unknown', // Will be resolved from user profile
        callType,
        timestamp: new Date(row.created_at).getTime(),
        isRead: row.read_at !== null,
        title: getNotificationTitle(row.category),
        body: getNotificationBody(row.category, row.actor_id),
        data: {
          conversationId,
          callerId: row.actor_id,
          callType,
          timestamp: new Date(row.created_at).getTime(),
        },
      };
    });
  } catch (err: any) {
    console.warn('[GAYZE] Load call notifications exception:', err?.message || err);
    return [];
  }
}

/**
 * Mark call notifications as read
 */
export async function markCallNotificationsAsRead(ids?: string[]): Promise<boolean> {
  if (!supabase) return false;

  try {
    const user = await ensureSupabaseSession();
    if (!user) return false;

    let query = supabase
      .from('gayze_notifications')
      .update({ read_at: new Date().toISOString() })
      .eq('user_id', user.id)
      .in('category', ['call', 'missed_call', 'call_ended']);

    if (ids && ids.length > 0) {
      query = query.in('id', ids);
    }

    const { error } = await query;

    if (error) {
      console.warn('[GAYZE] Failed to mark call notifications as read:', error.message);
      return false;
    }

    // Also mark corresponding call history records as read
    if (ids) {
      await markCallRecordsAsRead(ids);
    }

    return true;
  } catch (err: any) {
    console.warn('[GAYZE] Mark call notifications as read exception:', err?.message || err);
    return false;
  }
}

/**
 * Get unread call notification count
 */
export async function getUnreadCallNotificationCount(): Promise<number> {
  if (!supabase) return 0;

  try {
    const user = await ensureSupabaseSession();
    if (!user) return 0;

    const { count, error } = await supabase
      .from('gayze_notifications')
      .select('id', { count: 'exact', head: true })
      .eq('user_id', user.id)
      .in('category', ['call', 'missed_call', 'call_ended'])
      .is('read_at', null);

    if (error) {
      console.warn('[GAYZE] Failed to get unread call notification count:', error.message);
      return 0;
    }

    return count ?? 0;
  } catch (err: any) {
    console.warn('[GAYZE] Unread call notification count exception:', err?.message || err);
    return 0;
  }
}

/**
 * Get combined unread count (call notifications + missed calls)
 */
export async function getCombinedUnreadCount(): Promise<number> {
  const [notificationCount, callCount] = await Promise.all([
    getUnreadCallNotificationCount(),
    getUnreadCallCount(),
  ]);

  return notificationCount + callCount;
}

/**
 * Subscribe to real-time call notifications
 */
export function subscribeToCallNotifications(
  userId: string,
  onNotification: (notification: CallNotification) => void,
  onError?: (error: string) => void
): () => void {
  if (!supabase) return () => undefined;

  try {
    const channel = supabase
      .channel(`gayze-call-notifications-${userId}`)
      .on('postgres_changes', {
        event: 'INSERT',
        schema: 'public',
        table: 'gayze_notifications',
        filter: `user_id=eq.${userId}`,
      }, (payload) => {
        if (payload.new && ['call', 'missed_call', 'call_ended'].includes(payload.new.category)) {
          const notification: CallNotification = {
            id: payload.new.id,
            type: payload.new.category === 'call' ? 'incoming_call' : payload.new.category === 'missed_call' ? 'missed_call' : 'call_ended',
            conversationId: '',
            callerId: payload.new.actor_id,
            callerName: 'Unknown',
            callType: 'video',
            timestamp: new Date(payload.new.created_at).getTime(),
            isRead: payload.new.read_at !== null,
            title: getNotificationTitle(payload.new.category),
            body: getNotificationBody(payload.new.category, payload.new.actor_id),
          };
          
          // Extract conversation ID from URL if possible
          try {
            const url = new URL(payload.new.url, 'https://gayze.local');
            const conversationId = url.pathname.split('/')[2];
            notification.conversationId = conversationId;
            notification.data = {
              conversationId,
              callerId: payload.new.actor_id,
              callType: 'video',
              timestamp: new Date(payload.new.created_at).getTime(),
            };
          } catch { /* URL parsing failed */ }

          onNotification(notification);
        }
      })
      .subscribe();

    return () => {
      if (supabase) {
        void supabase.removeChannel(channel);
      }
    };
  } catch (err: any) {
    onError?.(err?.message || 'Failed to subscribe to call notifications');
    return () => undefined;
  }
}

/**
 * Helper functions for notification content
 */
function getNotificationTitle(category: string): string {
  switch (category) {
    case 'call':
      return 'Incoming Call';
    case 'missed_call':
      return 'Missed Call';
    case 'call_ended':
      return 'Call Ended';
    default:
      return 'Call Notification';
  }
}

function getNotificationBody(category: string, callerId: string): string {
  switch (category) {
    case 'call':
      return `Incoming call from ${shortenId(callerId)}`;
    case 'missed_call':
      return `Missed call from ${shortenId(callerId)}`;
    case 'call_ended':
      return `Call ended with ${shortenId(callerId)}`;
    default:
      return `Call notification from ${shortenId(callerId)}`;
  }
}

function shortenId(id: string): string {
  return id.length > 8 ? `${id.slice(0, 8)}...` : id;
}

/**
 * Ensure Supabase session for the current user
 */
async function ensureSupabaseSession() {
  if (!supabase) return null;
  try {
    const { data, error } = await supabase.auth.getSession();
    if (error) {
      console.warn('[GAYZE] Supabase getSession info:', error.message);
      return null;
    }
    return data.session?.user ?? null;
  } catch (err: any) {
    console.warn('[GAYZE] Supabase session check error:', err?.message || err);
    return null;
  }
}