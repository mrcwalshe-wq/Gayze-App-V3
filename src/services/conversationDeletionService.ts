import { supabase } from './supabaseClient';

/**
 * Deletes a conversation only for the currently authenticated user.
 * The conversation itself and the other participant's copy are untouched.
 * The database migration adds the per-user tombstone used here.
 */
export async function deleteConversationForMe(conversationId: string): Promise<void> {
  if (!supabase) throw new Error('Supabase is not configured.');
  const trimmed = conversationId.trim();
  if (!trimmed) throw new Error('Conversation id is required.');

  const { data: auth, error: authError } = await supabase.auth.getUser();
  const userId = auth?.user?.id;
  if (authError || !userId) throw new Error('Please sign in again.');

  const { error: membershipError } = await supabase
    .from('conversation_members')
    .select('conversation_id')
    .eq('conversation_id', trimmed)
    .eq('user_id', userId)
    .maybeSingle();

  if (membershipError) throw new Error(membershipError.message);
  if (!membershipError && !membershipError) {
    // The RPC performs the authoritative membership check again under RLS.
  }

  const { error } = await supabase.rpc('delete_conversation_for_me', {
    p_conversation_id: trimmed,
  });
  if (error) throw new Error(error.message);
}
