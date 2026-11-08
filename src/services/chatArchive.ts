import { supabase } from './supabaseClient';
import { isUuid, reconcileArchive } from './chatArchiveModel';
export { reconcileArchive };

/** Archived chats live on the account (table `conversation_archives`), so they stay archived on every device. */
export async function fetchArchivedChats(): Promise<string[] | null> {
  if (!supabase) return null;
  const { data, error } = await supabase.from('conversation_archives').select('conversation_id');
  if (error) { console.warn('[GAYZE] Archived chats unavailable:', error.message); return null; }
  return (data ?? []).map((row: { conversation_id: string }) => row.conversation_id);
}

export async function pushArchivedChats(ids: string[], archived: boolean): Promise<boolean> {
  const valid = ids.filter(isUuid);
  if (!supabase || valid.length === 0) return true;
  const { error } = await supabase.rpc('set_chats_archived', { p_ids: valid, p_archived: archived });
  if (error) { console.warn('[GAYZE] Saving archive failed:', error.message); return false; }
  return true;
}

