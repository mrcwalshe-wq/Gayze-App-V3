import { supabase } from './supabaseClient';
import { isCallSessionId } from './callSessions';

/**
 * The fallback route for call setup (see migration 20261111120000_call_signal_mailbox.sql). The offer and the answer are also left
 * here, and a phone that has not received them over the live channel reads them from here. Nothing in this file ever throws: the
 * live channel stays the first route and a failure here must never get in a call's way.
 */
export type MailboxKind = 'offer' | 'answer';

export async function postCallSignal(callId: string | null | undefined, toUserId: string | null | undefined, kind: MailboxKind, sdp: unknown): Promise<void> {
  if (!supabase || !callId || !toUserId || !isCallSessionId(callId)) return;
  try { await supabase.rpc('post_call_signal', { p_call_id: callId, p_to: toUserId, p_kind: kind, p_payload: { sdp } }); } catch { /* the live channel still carries it */ }
}

export interface MailboxMessage { id: number; senderId: string; sdp: RTCSessionDescriptionInit }

/** The newest message of this kind newer than `after`, or null. */
export async function fetchCallSignal(
  callId: string | null | undefined,
  kind: MailboxKind,
  after = 0,
  onError?: (message: string) => void,
): Promise<MailboxMessage | null> {
  if (!supabase || !callId || !isCallSessionId(callId)) return null;
  try {
    const { data, error } = await supabase.rpc('get_call_signal', { p_call_id: callId, p_kind: kind, p_after: after });
    if (error) { onError?.(error.message || 'mailbox RPC failed'); return null; }
    if (!Array.isArray(data) || !data[0]) return null;
    const row = data[0] as { id: number | string; sender_id: string; payload?: { sdp?: RTCSessionDescriptionInit } };
    const sdp = row.payload?.sdp;
    return sdp && typeof sdp.sdp === 'string' ? { id: Number(row.id), senderId: row.sender_id, sdp } : null;
  } catch (error) {
    onError?.(error instanceof Error ? error.message : 'mailbox request failed');
    return null;
  }
}
