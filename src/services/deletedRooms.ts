/**
 * Tracks conversations the user just deleted so that a room-list load that
 * STARTED before the delete was confirmed cannot bring the room back, while a
 * load started afterwards (server truth, e.g. a recreated conversation) is
 * trusted. Nothing here is a permanent blacklist.
 */
export class DeletedRoomTracker {
  private epoch = 0;
  private pending = new Map<string, number>();

  /** Epoch to stamp on a list load at the moment it starts. */
  get currentEpoch(): number { return this.epoch; }

  /** Delete requested: drop every list result for this room until resolved. */
  begin(roomId: string) { this.pending.set(roomId, Number.POSITIVE_INFINITY); }

  /** Delete failed: the room is visible again. */
  fail(roomId: string) { this.pending.delete(roomId); }

  /** Delete confirmed: only loads that started earlier are stale. */
  confirm(roomId: string) { this.epoch += 1; this.pending.set(roomId, this.epoch); }

  clear() { this.pending.clear(); }

  /** Filter a load that started at `startEpoch`. */
  filter<T extends { id: string }>(rooms: T[], startEpoch: number): T[] {
    for (const [roomId, epoch] of [...this.pending]) {
      if (startEpoch >= epoch) this.pending.delete(roomId);
    }
    return rooms.filter((room) => !this.pending.has(room.id));
  }
}
