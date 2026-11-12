import { supabase } from './supabaseClient';
import type { IncomingCall } from './webrtcService';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const isCallSessionId = (id: unknown): id is string => typeof id === 'string' && UUID.test(id);

/** Record that a call is ringing, so the person called can still answer it if their app was asleep when the live signal went out. */
export async function startCallSession(callId: string, conversationId: string, calleeId: string, callType: 'audio' | 'video'): Promise<void> {
  if (!supabase) throw new Error('Calling is unavailable until the secure connection is ready.');
  if (!isCallSessionId(callId)) throw new Error('Invalid call session identifier.');
  const { error } = await supabase.rpc('start_call_session', { p_call_id: callId, p_conversation: conversationId, p_callee: calleeId, p_call_type: callType });
  if (error) throw new Error(error.message || 'The accepted GAYZE connection could not be verified.');
}

export async function endCallSession(callId: string | undefined, status: 'answered' | 'ended'): Promise<void> {
  if (!supabase || !isCallSessionId(callId)) return;
  const { error } = await supabase.rpc('end_call_session', { p_call_id: callId, p_status: status });
  if (error) console.warn('[GAYZE] Could not update the call:', error.message);
}

/** The call ringing for this person right now, if there is one. */
export async function getRingingCall(): Promise<IncomingCall | null> {
  if (!supabase) return null;
  const { data, error } = await supabase.rpc('get_ringing_call');
  if (error || !Array.isArray(data) || !data[0]) return null;
  const r = data[0] as { call_id: string; conversation_id: string; caller_id: string; caller_name: string; call_type: string; started_at: string };
  return {
    conversationId: r.conversation_id, callerId: r.caller_id, callerName: r.caller_name || 'Gayze member',
    callType: r.call_type === 'audio' ? 'audio' : 'video', timestamp: Date.parse(r.started_at) || Date.now(), callId: r.call_id,
  };
}

/** Where a call stands on the server ('ringing' | 'answered' | 'ended'), or null if unknown. Used so a caller stops ringing when the live decline signal was missed. */
export async function getCallStatus(callId: string | undefined): Promise<'ringing' | 'answered' | 'ended' | null> {
  if (!supabase || !isCallSessionId(callId)) return null;
  const { data, error } = await supabase.rpc('get_call_status', { p_call_id: callId });
  if (error || (data !== 'ringing' && data !== 'answered' && data !== 'ended')) return null;
  return data;
}
