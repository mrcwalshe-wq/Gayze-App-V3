import { supabase } from './supabaseClient';

export type ServerPresenceStatus = 'online' | 'away' | 'offline' | 'hidden';
export interface ServerPresence { userId: string; status: ServerPresenceStatus; lastSeenAt: string | null }

export interface PrivacySettings {
  showOnlineStatus: boolean;
  showLastSeen: boolean;
  whoCanMessage: 'everyone' | 'connections';
  discoverable: boolean;
}
export const DEFAULT_PRIVACY: PrivacySettings = { showOnlineStatus: true, showLastSeen: true, whoCanMessage: 'everyone', discoverable: true };

const HEARTBEAT_MS = 45_000;

/**
 * Tells the server this person is here: every 45 s while the app is visible, and once as 'away' when it is hidden.
 * The server decides who is online from the last heartbeat, so a closed tab or dead phone goes offline by itself.
 */
export function startPresenceHeartbeat(): () => void {
  if (!supabase) return () => undefined;
  const client = supabase;
  let timer: number | null = null;
  const beat = (status: 'online' | 'away') => { void client.rpc('presence_heartbeat', { p_status: status }).then(() => undefined, () => undefined); };
  const sync = () => {
    if (timer !== null) { window.clearInterval(timer); timer = null; }
    if (document.visibilityState === 'visible') { beat('online'); timer = window.setInterval(() => beat('online'), HEARTBEAT_MS); }
    else beat('away');
  };
  sync();
  document.addEventListener('visibilitychange', sync);
  window.addEventListener('online', sync);
  return () => {
    document.removeEventListener('visibilitychange', sync);
    window.removeEventListener('online', sync);
    if (timer !== null) window.clearInterval(timer);
  };
}

/** Server-computed status for up to 100 people. People who hide it, or who you may not see, come back as 'hidden'. */
export async function fetchPresence(userIds: string[]): Promise<ServerPresence[]> {
  if (!supabase || userIds.length === 0) return [];
  const { data, error } = await supabase.rpc('get_presence', { p_user_ids: userIds.slice(0, 100) });
  if (error || !Array.isArray(data)) return [];
  return (data as { user_id: string; status: ServerPresenceStatus; last_seen_at: string | null }[])
    .map((r) => ({ userId: r.user_id, status: r.status, lastSeenAt: r.last_seen_at }));
}

export async function loadPrivacySettings(userId: string): Promise<PrivacySettings> {
  if (!supabase) return DEFAULT_PRIVACY;
  const { data } = await supabase.from('user_privacy_settings')
    .select('show_online_status,show_last_seen,who_can_message,discoverable').eq('user_id', userId).maybeSingle();
  if (!data) return DEFAULT_PRIVACY;
  return {
    showOnlineStatus: data.show_online_status ?? true, showLastSeen: data.show_last_seen ?? true,
    whoCanMessage: data.who_can_message === 'connections' ? 'connections' : 'everyone', discoverable: data.discoverable ?? true,
  };
}

export async function savePrivacySettings(userId: string, s: PrivacySettings): Promise<boolean> {
  if (!supabase) return false;
  const { error } = await supabase.from('user_privacy_settings').upsert({
    user_id: userId, show_online_status: s.showOnlineStatus, show_last_seen: s.showLastSeen,
    who_can_message: s.whoCanMessage, discoverable: s.discoverable, updated_at: new Date().toISOString(),
  }, { onConflict: 'user_id' });
  return !error;
}
