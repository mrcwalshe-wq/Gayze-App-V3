import { supabase } from './supabaseClient';

/** Persist a block for the authenticated user. The blocks table is RLS-protected. */
export async function blockUser(peerId: string): Promise<void> {
  if (!supabase) throw new Error('Blocking requires the live account service.');
  const { data: auth, error: authError } = await supabase.auth.getUser();
  if (authError || !auth.user) throw new Error('Sign in to block this user.');
  if (!peerId || peerId === auth.user.id) throw new Error('You cannot block this account.');
  const { error } = await supabase.from('blocks').upsert(
    { blocker_id: auth.user.id, blocked_id: peerId },
    { onConflict: 'blocker_id,blocked_id', ignoreDuplicates: true },
  );
  if (error) throw new Error(error.message || 'Could not block this user.');
}

/** Remove a block created by the authenticated user. */
export async function unblockUser(peerId: string): Promise<void> {
  if (!supabase) throw new Error('Blocking requires the live account service.');
  const { data: auth, error: authError } = await supabase.auth.getUser();
  if (authError || !auth.user) throw new Error('Sign in to manage blocked users.');
  const { error } = await supabase.from('blocks')
    .delete().eq('blocker_id', auth.user.id).eq('blocked_id', peerId);
  if (error) throw new Error(error.message || 'Could not unblock this user.');
}

/** Returns true when either account has blocked the other. */
export async function isBlockedBetween(peerId: string): Promise<boolean> {
  if (!supabase || !peerId) return false;
  const { data: auth, error: authError } = await supabase.auth.getUser();
  if (authError || !auth.user) throw new Error('Sign in to verify block status.');
  const { data, error } = await supabase.rpc('gayze_is_blocked_between', { p_peer_id: peerId });
  if (error) throw error;
  return data === true;
}


export interface BlockedUser {
  userId: string;
  displayName: string;
  handle: string | null;
}

/** Lists only blocks created by the signed-in account. */
export async function loadBlockedUsers(): Promise<BlockedUser[]> {
  if (!supabase) throw new Error('Blocking requires the live account service.');
  const { data: auth, error: authError } = await supabase.auth.getUser();
  if (authError || !auth.user) throw new Error('Sign in to view blocked users.');
  const { data, error } = await supabase
    .from('blocks')
    .select('blocked_id, profiles!blocks_blocked_id_fkey(display_name,handle)')
    .eq('blocker_id', auth.user.id)
    .order('created_at', { ascending: false });
  if (error) throw new Error(error.message || 'Could not load blocked users.');
  return (data ?? []).map((row) => ({
    userId: row.blocked_id,
    displayName: row.profiles?.display_name || row.profiles?.handle || 'GAYZE user',
    handle: row.profiles?.handle || null,
  }));
}
