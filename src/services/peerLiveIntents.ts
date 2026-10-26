import { useEffect, useMemo, useState } from 'react';
import { supabase } from './supabaseClient';

/** A conversation partner's intent that is live right now (display fields only). */
export interface PeerLive { userId: string; mode: 'social' | 'private'; intent: string; expiresAt: number }

export async function fetchPeersLiveIntents(peerIds: string[]): Promise<Map<string, PeerLive>> {
  const out = new Map<string, PeerLive>();
  if (!supabase || peerIds.length === 0) return out;
  const { data, error } = await supabase.rpc('get_peers_live_intents', { p_peer_ids: peerIds.slice(0, 200) });
  if (error) throw new Error('Live intents unavailable');
  for (const row of (data ?? []) as { user_id: string; mode: string; intent: string; expires_at: string }[]) {
    const expiresAt = Date.parse(row.expires_at);
    if ((row.mode !== 'social' && row.mode !== 'private') || !row.intent || !Number.isFinite(expiresAt)) continue;
    out.set(row.user_id, { userId: row.user_id, mode: row.mode, intent: row.intent, expiresAt });
  }
  return out;
}

/** "42m left", "1h 05m left"; empty when it has run out. */
export function timeLeftLabel(expiresAt: number, now = Date.now()): string {
  const ms = expiresAt - now;
  if (ms <= 0) return '';
  const mins = Math.max(1, Math.round(ms / 60000));
  if (mins < 60) return `${mins}m left`;
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return m ? `${h}h ${String(m).padStart(2, '0')}m left` : `${h}h left`;
}

/**
 * Who in my chats is live right now. Refreshes every 30 s while the app is visible and when it returns to the
 * foreground; entries disappear on their own when they expire. Failures keep the last known answer.
 */
export function usePeersLiveIntents(peerIds: string[], enabled = true): Map<string, PeerLive> {
  const key = useMemo(() => [...new Set(peerIds.filter(Boolean))].sort().join(','), [peerIds]);
  const [live, setLive] = useState<Map<string, PeerLive>>(new Map());
  const [tick, setTick] = useState(0);

  useEffect(() => {
    if (!enabled || !key) { setLive(new Map()); return; }
    let cancelled = false;
    const ids = key.split(',');
    const load = () => {
      fetchPeersLiveIntents(ids).then((m) => { if (!cancelled) setLive(m); }).catch(() => { /* keep last */ });
    };
    load();
    const timer = window.setInterval(() => { if (document.visibilityState === 'visible') load(); }, 30_000);
    const onVisible = () => { if (document.visibilityState === 'visible') load(); };
    document.addEventListener('visibilitychange', onVisible);
    return () => { cancelled = true; window.clearInterval(timer); document.removeEventListener('visibilitychange', onVisible); };
  }, [key, enabled]);

  useEffect(() => {
    const t = window.setInterval(() => setTick((n) => n + 1), 30_000);
    return () => window.clearInterval(t);
  }, []);

  return useMemo(() => {
    const now = Date.now();
    const alive = new Map<string, PeerLive>();
    live.forEach((v, k) => { if (v.expiresAt > now) alive.set(k, v); });
    return alive;
    // tick forces a re-evaluation so expired intents drop off without a refetch
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [live, tick]);
}
