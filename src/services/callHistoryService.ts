import { supabase } from './supabaseClient';
import type { CallState, CallType } from './webrtcService';

/**
 * Call history and missed call tracking service.
 * Persists call records for audio and video calls, including missed calls.
 */

export interface CallRecord {
  id: string;
  conversationId: string;
  callerId: string;
  callerName: string;
  targetUserId: string;
  targetUserName?: string;
  callType: CallType;
  state: CallState;
  startedAt: number;
  endedAt?: number;
  durationSeconds?: number;
  direction: 'incoming' | 'outgoing';
  isMissed: boolean;
  isRead: boolean;
  createdAt: number;
}

export interface CallHistoryFilters {
  conversationId?: string;
  userId?: string;
  isMissed?: boolean;
  callType?: CallType;
  limit?: number;
}

export interface CallHistoryStats {
  totalCalls: number;
  missedCalls: number;
  incomingCalls: number;
  outgoingCalls: number;
  audioCalls: number;
  videoCalls: number;
}

/**
 * Save a call record to the database
 */
export async function saveCallRecord(record: Omit<CallRecord, 'id' | 'createdAt'>): Promise<CallRecord | null> {
  if (!supabase) return null;

  try {
    const user = await ensureSupabaseSession();
    if (!user) return null;

    // Only save records for the authenticated user
    const isCaller = record.callerId === user.id;
    const isTarget = record.targetUserId === user.id;
    
    if (!isCaller && !isTarget) return null;

    // Determine direction from the authenticated user's perspective
    const direction = isCaller ? 'outgoing' : 'incoming';
    const otherUserId = isCaller ? record.targetUserId : record.callerId;
    const otherUserName = isCaller ? record.targetUserName : record.callerName;
    const conversationId = record.conversationId;

    const callRecord = {
      user_id: user.id,
      conversation_id: conversationId,
      peer_user_id: otherUserId,
      peer_display_name: otherUserName,
      call_type: record.callType,
      call_state: record.state,
      direction,
      started_at: new Date(record.startedAt).toISOString(),
      ended_at: record.endedAt ? new Date(record.endedAt).toISOString() : null,
      duration_seconds: record.durationSeconds ?? null,
      is_missed: record.isMissed || false,
      is_read: record.isRead || false,
      created_at: new Date().toISOString(),
    };

    const { data, error } = await supabase
      .from('call_history')
      .insert(callRecord)
      .select('id,conversation_id,peer_user_id,peer_display_name,call_type,call_state,direction,started_at,ended_at,duration_seconds,is_missed,is_read,created_at')
      .single();

    if (error) {
      console.warn('[GAYZE] Failed to save call record:', error.message);
      return null;
    }

    if (!data) return null;

    return {
      id: data.id,
      conversationId: data.conversation_id,
      callerId: isCaller ? user.id : otherUserId,
      callerName: isCaller ? user.email || 'Me' : otherUserName || 'Unknown',
      targetUserId: isCaller ? otherUserId : user.id,
      targetUserName: isCaller ? otherUserName : user.email || 'Me',
      callType: data.call_type as CallType,
      state: data.call_state as CallState,
      startedAt: new Date(data.started_at).getTime(),
      endedAt: data.ended_at ? new Date(data.ended_at).getTime() : undefined,
      durationSeconds: data.duration_seconds ?? undefined,
      direction: data.direction as 'incoming' | 'outgoing',
      isMissed: data.is_missed,
      isRead: data.is_read,
      createdAt: new Date(data.created_at).getTime(),
    };
  } catch (err: any) {
    console.warn('[GAYZE] Call record save exception:', err?.message || err);
    return null;
  }
}

/**
 * Load call history for the current user
 */
export async function loadCallHistory(filters: CallHistoryFilters = {}): Promise<CallRecord[]> {
  if (!supabase) return [];

  try {
    const user = await ensureSupabaseSession();
    if (!user) return [];

    let query = supabase
      .from('call_history')
      .select('id,conversation_id,peer_user_id,peer_display_name,call_type,call_state,direction,started_at,ended_at,duration_seconds,is_missed,is_read,created_at')
      .eq('user_id', user.id)
      .order('created_at', { ascending: false });

    if (filters.conversationId) {
      query = query.eq('conversation_id', filters.conversationId);
    }
    
    if (filters.isMissed !== undefined) {
      query = query.eq('is_missed', filters.isMissed);
    }
    
    if (filters.callType) {
      query = query.eq('call_type', filters.callType);
    }
    
    if (filters.limit) {
      query = query.limit(filters.limit);
    }

    const { data, error } = await query;

    if (error) {
      console.warn('[GAYZE] Failed to load call history:', error.message);
      return [];
    }

    return (data ?? []).map((row: any) => ({
      id: row.id,
      conversationId: row.conversation_id,
      callerId: row.direction === 'outgoing' ? user.id : row.peer_user_id,
      callerName: row.direction === 'outgoing' ? 'Me' : row.peer_display_name || 'Unknown',
      targetUserId: row.direction === 'outgoing' ? row.peer_user_id : user.id,
      targetUserName: row.direction === 'outgoing' ? row.peer_display_name : 'Me',
      callType: row.call_type as CallType,
      state: row.call_state as CallState,
      startedAt: new Date(row.started_at).getTime(),
      endedAt: row.ended_at ? new Date(row.ended_at).getTime() : undefined,
      durationSeconds: row.duration_seconds ?? undefined,
      direction: row.direction as 'incoming' | 'outgoing',
      isMissed: row.is_missed,
      isRead: row.is_read,
      createdAt: new Date(row.created_at).getTime(),
    }));
  } catch (err: any) {
    console.warn('[GAYZE] Call history load exception:', err?.message || err);
    return [];
  }
}

/**
 * Load unread call history count
 */
export async function getUnreadCallCount(): Promise<number> {
  if (!supabase) return 0;

  try {
    const user = await ensureSupabaseSession();
    if (!user) return 0;

    const { count, error } = await supabase
      .from('call_history')
      .select('id', { count: 'exact', head: true })
      .eq('user_id', user.id)
      .eq('is_read', false)
      .eq('is_missed', true);

    if (error) {
      console.warn('[GAYZE] Failed to get unread call count:', error.message);
      return 0;
    }

    return count ?? 0;
  } catch (err: any) {
    console.warn('[GAYZE] Unread call count exception:', err?.message || err);
    return 0;
  }
}

/**
 * Mark call records as read
 */
export async function markCallRecordsAsRead(ids?: string[], conversationId?: string): Promise<boolean> {
  if (!supabase) return false;

  try {
    const user = await ensureSupabaseSession();
    if (!user) return false;

    let query = supabase
      .from('call_history')
      .update({ is_read: true })
      .eq('user_id', user.id);

    if (ids && ids.length > 0) {
      query = query.in('id', ids);
    } else if (conversationId) {
      query = query.eq('conversation_id', conversationId);
    } else {
      // If no specific IDs or conversation, mark all as read
      query = query.eq('is_read', false);
    }

    const { error } = await query;

    if (error) {
      console.warn('[GAYZE] Failed to mark call records as read:', error.message);
      return false;
    }

    return true;
  } catch (err: any) {
    console.warn('[GAYZE] Mark call records as read exception:', err?.message || err);
    return false;
  }
}

/**
 * Mark a specific call as missed
 */
export async function markCallAsMissed(conversationId: string, callerId: string, callType: CallType): Promise<CallRecord | null> {
  if (!supabase) return null;

  try {
    const user = await ensureSupabaseSession();
    if (!user) return null;

    // Check if this is an incoming call to the current user
    if (callerId === user.id) return null; // Don't mark outgoing calls as missed

    const missedRecord = {
      user_id: user.id,
      conversation_id: conversationId,
      peer_user_id: callerId,
      peer_display_name: 'Unknown', // Will be updated when we get the caller info
      call_type: callType,
      call_state: 'missed' as CallState,
      direction: 'incoming' as const,
      started_at: new Date().toISOString(),
      ended_at: null,
      duration_seconds: null,
      is_missed: true,
      is_read: false,
      created_at: new Date().toISOString(),
    };

    const { data, error } = await supabase
      .from('call_history')
      .insert(missedRecord)
      .select('id,conversation_id,peer_user_id,peer_display_name,call_type,call_state,direction,started_at,ended_at,duration_seconds,is_missed,is_read,created_at')
      .single();

    if (error) {
      console.warn('[GAYZE] Failed to mark call as missed:', error.message);
      return null;
    }

    if (!data) return null;

    return {
      id: data.id,
      conversationId: data.conversation_id,
      callerId: data.peer_user_id,
      callerName: data.peer_display_name || 'Unknown',
      targetUserId: user.id,
      targetUserName: 'Me',
      callType: data.call_type as CallType,
      state: data.call_state as CallState,
      startedAt: new Date(data.started_at).getTime(),
      endedAt: data.ended_at ? new Date(data.ended_at).getTime() : undefined,
      durationSeconds: data.duration_seconds ?? undefined,
      direction: data.direction as 'incoming' | 'outgoing',
      isMissed: data.is_missed,
      isRead: data.is_read,
      createdAt: new Date(data.created_at).getTime(),
    };
  } catch (err: any) {
    console.warn('[GAYZE] Mark call as missed exception:', err?.message || err);
    return null;
  }
}

/**
 * Update a call record with additional information (e.g., caller name)
 */
export async function updateCallRecord(id: string, updates: Partial<CallRecord>): Promise<boolean> {
  if (!supabase) return false;

  try {
    const user = await ensureSupabaseSession();
    if (!user) return false;

    const updateData: Record<string, any> = {};
    
    if (updates.callerName !== undefined) {
      updateData.peer_display_name = updates.callerName;
    }
    
    if (updates.endedAt !== undefined) {
      updateData.ended_at = new Date(updates.endedAt).toISOString();
    }
    
    if (updates.durationSeconds !== undefined) {
      updateData.duration_seconds = updates.durationSeconds;
    }
    
    if (updates.state !== undefined) {
      updateData.call_state = updates.state;
    }
    
    if (updates.isRead !== undefined) {
      updateData.is_read = updates.isRead;
    }
    
    if (updates.isMissed !== undefined) {
      updateData.is_missed = updates.isMissed;
    }

    const { error } = await supabase
      .from('call_history')
      .update(updateData)
      .eq('id', id)
      .eq('user_id', user.id);

    if (error) {
      console.warn('[GAYZE] Failed to update call record:', error.message);
      return false;
    }

    return true;
  } catch (err: any) {
    console.warn('[GAYZE] Update call record exception:', err?.message || err);
    return false;
  }
}

/**
 * Delete a call record
 */
export async function deleteCallRecord(id: string): Promise<boolean> {
  if (!supabase) return false;

  try {
    const user = await ensureSupabaseSession();
    if (!user) return false;

    const { error } = await supabase
      .from('call_history')
      .delete()
      .eq('id', id)
      .eq('user_id', user.id);

    if (error) {
      console.warn('[GAYZE] Failed to delete call record:', error.message);
      return false;
    }

    return true;
  } catch (err: any) {
    console.warn('[GAYZE] Delete call record exception:', err?.message || err);
    return false;
  }
}

/**
 * Get call history statistics
 */
export async function getCallHistoryStats(): Promise<CallHistoryStats> {
  if (!supabase) return {
    totalCalls: 0,
    missedCalls: 0,
    incomingCalls: 0,
    outgoingCalls: 0,
    audioCalls: 0,
    videoCalls: 0,
  };

  try {
    const user = await ensureSupabaseSession();
    if (!user) return {
      totalCalls: 0,
      missedCalls: 0,
      incomingCalls: 0,
      outgoingCalls: 0,
      audioCalls: 0,
      videoCalls: 0,
    };

    const [total, missed, incoming, outgoing, audio, video] = await Promise.all([
      supabase.from('call_history').select('id', { count: 'exact', head: true }).eq('user_id', user.id),
      supabase.from('call_history').select('id', { count: 'exact', head: true }).eq('user_id', user.id).eq('is_missed', true),
      supabase.from('call_history').select('id', { count: 'exact', head: true }).eq('user_id', user.id).eq('direction', 'incoming'),
      supabase.from('call_history').select('id', { count: 'exact', head: true }).eq('user_id', user.id).eq('direction', 'outgoing'),
      supabase.from('call_history').select('id', { count: 'exact', head: true }).eq('user_id', user.id).eq('call_type', 'audio'),
      supabase.from('call_history').select('id', { count: 'exact', head: true }).eq('user_id', user.id).eq('call_type', 'video'),
    ]);

    return {
      totalCalls: total.count ?? 0,
      missedCalls: missed.count ?? 0,
      incomingCalls: incoming.count ?? 0,
      outgoingCalls: outgoing.count ?? 0,
      audioCalls: audio.count ?? 0,
      videoCalls: video.count ?? 0,
    };
  } catch (err: any) {
    console.warn('[GAYZE] Call history stats exception:', err?.message || err);
    return {
      totalCalls: 0,
      missedCalls: 0,
      incomingCalls: 0,
      outgoingCalls: 0,
      audioCalls: 0,
      videoCalls: 0,
    };
  }
}

/**
 * Subscribe to real-time updates for call history
 */
export function subscribeToCallHistory(
  userId: string,
  onUpdate: (record: CallRecord) => void,
  onError?: (error: string) => void
): () => void {
  if (!supabase) return () => undefined;

  try {
    const channel = supabase
      .channel(`gayze-call-history-${userId}`)
      .on('postgres_changes', {
        event: 'INSERT',
        schema: 'public',
        table: 'call_history',
        filter: `user_id=eq.${userId}`,
      }, (payload) => {
        if (payload.new) {
          const record: CallRecord = {
            id: payload.new.id,
            conversationId: payload.new.conversation_id,
            callerId: payload.new.direction === 'outgoing' ? userId : payload.new.peer_user_id,
            callerName: payload.new.direction === 'outgoing' ? 'Me' : payload.new.peer_display_name || 'Unknown',
            targetUserId: payload.new.direction === 'outgoing' ? payload.new.peer_user_id : userId,
            targetUserName: payload.new.direction === 'outgoing' ? payload.new.peer_display_name : 'Me',
            callType: payload.new.call_type as CallType,
            state: payload.new.call_state as CallState,
            startedAt: new Date(payload.new.started_at).getTime(),
            endedAt: payload.new.ended_at ? new Date(payload.new.ended_at).getTime() : undefined,
            durationSeconds: payload.new.duration_seconds ?? undefined,
            direction: payload.new.direction as 'incoming' | 'outgoing',
            isMissed: payload.new.is_missed,
            isRead: payload.new.is_read,
            createdAt: new Date(payload.new.created_at).getTime(),
          };
          onUpdate(record);
        }
      })
      .subscribe();

    return () => {
      if (supabase) {
        void supabase.removeChannel(channel);
      }
    };
  } catch (err: any) {
    onError?.(err?.message || 'Failed to subscribe to call history');
    return () => undefined;
  }
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