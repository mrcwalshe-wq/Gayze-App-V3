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
