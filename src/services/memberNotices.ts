import { supabase } from './supabaseClient';

/** A message from Gayze itself: an admin broadcast, a direct message, or a gathering update. */
export interface MemberNotice {
  id: string;
  kind: 'broadcast' | 'admin_message' | 'gathering_rsvp' | 'gathering_full';
  title: string;
  body: string;
  url: string;
  created_at: string;
  read_at: string | null;
}

export async function loadMemberNotices(limit = 50): Promise<MemberNotice[]> {
  if (!supabase) return [];
  const { data, error } = await supabase.rpc('get_my_notices', { p_limit: limit });
  if (error) throw new Error('Notices unavailable');
  return (data ?? []) as MemberNotice[];
}

export async function markMemberNoticesRead(ids?: string[]): Promise<void> {
  if (!supabase) return;
  const { error } = await supabase.rpc('mark_notices_read', { p_ids: ids ?? null });
  if (error) throw new Error('Could not update notices');
}
