import { supabase } from './supabaseClient';
import { RealtimeRecovery, requireRealtimeSession, type ChatConnectionState } from './realtimeRecovery';

export interface InboxNotification {
  id: string; user_id: string; actor_id: string | null; category: string;
  url: string; created_at: string; read_at: string | null;
}
export interface NotificationInbox { rows: InboxNotification[]; unread: number; messageUnread: number; }
export const notificationCopy: Record<string, string> = {
  gaze: 'Someone sent you a Gayze', message: 'You have a new message', connection: 'You have a new connection',
  intent_expiring: 'Your intent is ending soon', safety: 'Your safety check-in has ended', test: 'GAYZE test notification',
};

export function watchNotificationInbox(userId: string, receive: (inbox: NotificationInbox) => void,
  status: (state: ChatConnectionState) => void) {
  if (!supabase) return { stop() {}, refresh() {} };
  const client = supabase;
  const recovery = new RealtimeRecovery({
    client, userId, topic: `gayze-notifications-${userId}`,
    session: (signal) => requireRealtimeSession(client, userId, signal),
    build: (channel, current) => channel.on('postgres_changes', {
      event: '*', schema: 'public', table: 'gayze_notifications', filter: `user_id=eq.${userId}`,
    }, () => { if (current()) recovery.resync(); }),
    status,
    reconcile: async (signal, current) => {
      const rows: InboxNotification[] = [];
      let cursor: InboxNotification | undefined;
      for (;;) {
        let query = client.from('gayze_notifications').select('id,user_id,actor_id,category,url,created_at,read_at')
          .eq('user_id', userId).order('created_at').order('id').limit(200);
        if (cursor) query = query.or(`created_at.gt.${cursor.created_at},and(created_at.eq.${cursor.created_at},id.gt.${cursor.id})`);
        const result = await query.abortSignal(signal);
        if (!current()) return;
        if (result.error) throw new Error('Notification inbox unavailable');
        if (!result.data?.length) break;
        rows.push(...result.data);
        const last = result.data.at(-1)!;
        if (last.id === cursor?.id) throw new Error('Notification pagination stalled');
        cursor = last;
      }
      const count = (messages: boolean) => {
        let query = client.from('gayze_notifications').select('id', { count: 'exact', head: true }).eq('user_id', userId).is('read_at', null);
        if (messages) query = query.eq('category', 'message');
        return query.abortSignal(signal);
      };
      const [total, messages] = await Promise.all([count(false), count(true)]);
      if (!current()) return;
      if (total.error || messages.error) throw new Error('Unread count unavailable');
      receive({ rows: rows.reverse(), unread: total.count ?? 0, messageUnread: messages.count ?? 0 });
    },
  });
  return { stop: () => recovery.stop(), refresh: () => recovery.resync() };
}

export async function markNotificationRead(id?: string, conversationId?: string): Promise<void> {
  if (!supabase) throw new Error('Notification inbox unavailable');
  if (id) {
    // Defence in depth: do not even invoke the acknowledgement RPC unless the
    // notification belongs to the currently authenticated account. The RPC
    // remains owner-scoped as the authoritative server-side check.
    const { data: { user }, error: userError } = await supabase.auth.getUser();
    if (userError || !user) return;
    const { data: owned, error: ownershipError } = await supabase
      .from('gayze_notifications')
      .select('id')
      .eq('id', id)
      .eq('user_id', user.id)
      .maybeSingle();
    if (ownershipError || !owned) return;
  }
  const { error } = await supabase.rpc('gayze_mark_notification_read', { p_id: id ?? null, p_conversation: conversationId ?? null });
  if (error) throw new Error('Could not mark the notification as read');
}
