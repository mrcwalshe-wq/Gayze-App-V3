import type { SupabaseClient } from '@supabase/supabase-js';
import { supabase } from './supabaseClient';
import { RealtimeRecovery, requireRealtimeSession, type RecoveryEnvironment } from './realtimeRecovery';

export interface PeerIntent {
  id: string; peerId: string; mode: 'social' | 'private'; intent: string;
  startsAt: number; expiresAt: number;
}
export type PeerIntentState = { status: 'loading' | 'none' | 'unavailable'; intent?: never }
  | { status: 'ready'; intent: PeerIntent };

/** Validate REST data, never publish untrusted realtime payloads as current intent. */
export function parsePeerIntent(row: Record<string, unknown> | null, peerId: string, now: number): PeerIntent | null {
  if (!row || row.user_id !== peerId || row.is_paused !== false || typeof row.id !== 'string'
    || (row.mode !== 'social' && row.mode !== 'private') || typeof row.intent !== 'string' || !row.intent.trim()) return null;
  const startsAt = typeof row.starts_at === 'string' ? Date.parse(row.starts_at) : NaN;
  const expiresAt = typeof row.expires_at === 'string' ? Date.parse(row.expires_at) : NaN;
  if (!Number.isFinite(startsAt) || !Number.isFinite(expiresAt) || expiresAt <= now || expiresAt <= startsAt) return null;
  return { id: row.id, peerId, mode: row.mode, intent: row.intent, startsAt, expiresAt };
}

/** Same SDK/recovery owner as chat. Narrow, authenticated, RLS-governed reads.
 * Polling covers dropped events and filtered DELETEs (which Postgres Changes
 * cannot reliably deliver). No schema assumptions beyond existing intents columns.
 */
export function watchPeerIntent(userId: string, peerId: string, receive: (state: PeerIntentState) => void,
  client: SupabaseClient | null = supabase, environment?: RecoveryEnvironment) {
  if (!client || !userId || !peerId || userId === peerId) {
    receive({ status: 'unavailable' });
    return { stop() {}, refresh() {} };
  }
  let stopped = false;
  let revision = 0;
  let publication = 0;
  let expiry: ReturnType<typeof setTimeout> | undefined;
  const now = () => environment?.now() ?? Date.now();
  const cancelExpiry = () => {
    if (expiry !== undefined) {
      if (environment) environment.cancel(expiry); else clearTimeout(expiry);
      expiry = undefined;
    }
  };
  const publish = (state: PeerIntentState) => { if (!stopped) { publication++; receive(state); } };
  const recovery = new RealtimeRecovery({
    client, userId, topic: `gayze-peer-intent-${userId}-${peerId}`, environment, pollMs: 15_000,
    session: signal => requireRealtimeSession(client, userId, signal),
    build: (channel, current) => channel.on('postgres_changes', {
      event: '*', schema: 'public', table: 'intents', filter: `user_id=eq.${peerId}`,
    }, () => { if (current()) { revision++; recovery.resync(); } }),
    status: state => {
      if (['offline', 'suspended', 'sign-in-required'].includes(state)) {
        cancelExpiry(); publish({ status: 'unavailable' });
      }
    },
    reconcile: async (signal, current) => {
      const readingRevision = revision;
      try {
        const result = await client.from('intents')
          .select('id,user_id,mode,intent,starts_at,expires_at,is_paused')
          .eq('user_id', peerId).eq('is_paused', false).gt('expires_at', new Date(now()).toISOString())
          .order('starts_at', { ascending: false }).order('id').limit(1).abortSignal(signal).maybeSingle();
        if (!current() || stopped || readingRevision !== revision) return;
        cancelExpiry();
        if (result.error) throw new Error('Peer intent unavailable');
        const intent = parsePeerIntent(result.data, peerId, now());
        publish(intent ? { status: 'ready', intent } : { status: 'none' });
        if (intent) {
          const published = publication;
          const tick = () => {
            expiry = undefined;
            if (stopped || published !== publication) return;
            // REST may be healthy while realtime is joining. Keep that fresh
            // result, but never label a stalled read's old snapshot current.
            publish({ status: now() >= intent.expiresAt ? 'none' : 'unavailable' });
            recovery.resync();
          };
          const delay = Math.max(0, Math.min(30_000, intent.expiresAt - now()));
          expiry = environment ? environment.later(tick, delay) : setTimeout(tick, delay);
        }
      } catch {
        if (!current() || stopped) return;
        cancelExpiry(); publish({ status: 'unavailable' });
        throw new Error('Peer intent unavailable');
      }
    },
  });
  return { stop() { stopped = true; cancelExpiry(); recovery.stop(); }, refresh() { recovery.resync(); } };
}
