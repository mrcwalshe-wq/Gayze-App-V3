import type { ChatConnectionState } from './realtimeRecovery';

/** Warm room reads may be bounded ONLY while the account-wide owner supplies
 * authoritative full catch-up. No timestamp watermark replaces that owner. */
export class ChatHistoryOwnership {
  private complete = new Set<string>();
  private healthy = false;
  inboxState(state: ChatConnectionState) {
    this.healthy = state === 'connected';
    if (!this.healthy) this.complete.clear();
  }
  roomComplete(room: string, readable: boolean) {
    if (readable && this.healthy) this.complete.add(room);
    else this.complete.delete(room);
  }
  unseenOlderRow(room: string) { this.complete.delete(room); }
  canReuse(room: string) { return this.healthy && this.complete.has(room); }
  clear() { this.complete.clear(); this.healthy = false; }
}
