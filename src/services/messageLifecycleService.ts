import { supabase } from './supabaseService';

async function requireSession() {
  if (!supabase) throw new Error('Messaging backend unavailable.');
  const { data, error } = await supabase.auth.getUser();
  if (error || !data.user) throw new Error('Sign in required.');
  return data.user;
}

export async function deleteMessageForMe(messageId: string): Promise<void> {
  await requireSession();
  const { error } = await supabase!.rpc('delete_message_for_me', { p_message_id: messageId });
  if (error) throw new Error('Could not delete the message.');
}

export async function unsendMessage(messageId: string): Promise<void> {
  await requireSession();
  const { error } = await supabase!.rpc('unsend_message', { p_message_id: messageId });
  if (error) throw new Error(error.message || 'Could not unsend the message.');
}

export async function setMessageExpiry(messageId: string, expiresAt: Date | null): Promise<void> {
  await requireSession();
  const { error } = await supabase!.rpc('set_message_expiry', {
    p_message_id: messageId,
    p_expires_at: expiresAt?.toISOString() ?? null,
  });
  if (error) throw new Error('Could not update message expiry.');
}

export async function scheduleEncryptedMessage(args: {
  conversationId: string;
  ciphertext: string;
  nonce: string;
  scheduledFor: Date;
  clientMessageId: string;
  expiresAt?: Date | null;
}) {
  await requireSession();
  const { data, error } = await supabase!.rpc('schedule_encrypted_message', {
    p_conversation_id: args.conversationId,
    p_ciphertext: args.ciphertext,
    p_nonce: args.nonce,
    p_scheduled_for: args.scheduledFor.toISOString(),
    p_client_message_id: args.clientMessageId,
    p_expires_at: args.expiresAt?.toISOString() ?? null,
  });
  if (error) throw new Error('Could not schedule the message.');
  return data;
}

export async function cancelScheduledMessage(messageId: string): Promise<void> {
  await requireSession();
  const { error } = await supabase!.rpc('cancel_scheduled_message', { p_message_id: messageId });
  if (error) throw new Error('Could not cancel the scheduled message.');
}
