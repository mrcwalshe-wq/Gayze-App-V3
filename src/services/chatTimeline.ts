/**
 * Merge chat messages with received-Gayze events into one chronological feed.
 *
 * A Gayze is an event in the conversation, so it sits where it happened rather
 * than in a block above the history. Gayzes that arrive back-to-back (no
 * message between them) collapse into a single "sent you N Gayzes" row.
 */
export interface TimelineMessage { id: string; timestamp: number }
export interface TimelineGayze { id: string; createdAt: string }

export type TimelineEntry<M extends TimelineMessage> =
  | { kind: 'message'; key: string; at: number; message: M }
  | { kind: 'gayze'; key: string; at: number; count: number; latestCreatedAt: string };

export function buildChatTimeline<M extends TimelineMessage>(
  messages: readonly M[],
  gayzes: readonly TimelineGayze[],
  /** When older history is hidden, drop Gayzes older than the first shown message. */
  hasHiddenHistory = false,
): Array<TimelineEntry<M>> {
  const firstShown = messages.length ? messages[0].timestamp : -Infinity;
  const events = gayzes
    .map((gayze) => ({ gayze, at: Date.parse(gayze.createdAt) }))
    .filter(({ at }) => Number.isFinite(at) && (!hasHiddenHistory || at >= firstShown))
    .sort((a, b) => a.at - b.at || a.gayze.id.localeCompare(b.gayze.id));

  const entries: Array<TimelineEntry<M>> = [];
  let m = 0;
  let e = 0;
  while (m < messages.length || e < events.length) {
    const takeEvent = e < events.length && (m >= messages.length || events[e].at < messages[m].timestamp);
    if (!takeEvent) {
      const message = messages[m++];
      entries.push({ kind: 'message', key: `m-${message.id}`, at: message.timestamp, message });
      continue;
    }
    const { gayze, at } = events[e++];
    const last = entries[entries.length - 1];
    if (last && last.kind === 'gayze') {
      last.count += 1;
      last.at = at;
      last.latestCreatedAt = gayze.createdAt;
    } else {
      entries.push({ kind: 'gayze', key: `g-${gayze.id}`, at, count: 1, latestCreatedAt: gayze.createdAt });
    }
  }
  return entries;
}

/** Latest activity in a room: last message, or the newest Gayze from its peer. */
export function roomActivityAt(
  lastTimestamp: number,
  latestMessageAt: number | undefined,
  latestGayzeAt: number | undefined,
): number {
  return Math.max(lastTimestamp || 0, latestMessageAt ?? 0, latestGayzeAt ?? 0);
}
