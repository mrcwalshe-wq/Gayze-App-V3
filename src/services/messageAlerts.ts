/** One foreground decision per stable DB message ID, shared by Realtime and
 * the service-worker handshake. Opaque IDs only, RAM only, account-scoped. */
export class MessageAlerts {
  private seen = new Set<string>();
  clear() { this.seen.clear(); }
  acknowledged(messageId: string, recipientId: string, currentUserId: string | null) {
    if (!currentUserId || recipientId !== currentUserId) return;
    this.seen.add(`${currentUserId}:${messageId}`);
    if (this.seen.size > 2500) this.seen.delete(this.seen.values().next().value!);
  }
  present(messageId: string, conversationId: string, context: {
    foreground: boolean; viewingRoom: string | null; userId: string | null; recipientId: string;
  }, show: () => void): boolean {
    if (!context.foreground || !context.userId || context.recipientId !== context.userId) return false;
    const key = `${context.userId}:${messageId}`;
    if (this.seen.has(key)) return true;
    this.acknowledged(messageId, context.recipientId, context.userId);
    if (context.viewingRoom !== conversationId) show();
    return true;
  }
}
