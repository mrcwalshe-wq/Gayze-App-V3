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
  if (authError || !auth.user) return false;
  const [outgoing, incoming] = await Promise.all([
    supabase.from('blocks').select('blocked_id').eq('blocker_id', auth.user.id).eq('blocked_id', peerId).maybeSingle(),
    supabase.from('blocks').select('blocker_id').eq('blocker_id', peerId).eq('blocked_id', auth.user.id).maybeSingle(),
  ]);
  if (outgoing.error) throw outgoing.error;
  if (incoming.error) throw incoming.error;
  return Boolean(outgoing.data || incoming.data);
}
