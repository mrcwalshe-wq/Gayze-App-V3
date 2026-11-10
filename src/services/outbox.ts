/**
 * Messages written without a connection wait here and are sent, in order, when the connection returns.
 *
 * What is saved on the phone is the ENCRYPTED message (ciphertext), never the text: the message is encrypted before it is
 * queued. Sending is idempotent (the message keeps its id, and a repeated insert is recognised), so a retry can never
 * duplicate a message.
 */
export interface OutboxEntry {
  id: string;
  roomId: string;
  cipherHex: string;
  nonceHex: string;
  /** ISO time the message disappears (disappearing-message timer), or null. */
  expiresAt: string | null;
  keyVersion: number;
  createdAt: number;
  attempts: number;
}

export interface KeyValueStore { getItem(key: string): string | null; setItem(key: string, value: string): void; removeItem(key: string): void }

/** A message that is still waiting after this long is dropped rather than sent days late. */
export const OUTBOX_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;
export const OUTBOX_MAX_ENTRIES = 200;

const keyFor = (userId: string) => `gayze_outbox_v1_${userId}`;

export function loadOutbox(store: KeyValueStore, userId: string): OutboxEntry[] {
  try {
    const raw = store.getItem(keyFor(userId));
    const parsed = raw ? JSON.parse(raw) : [];
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter((e): e is OutboxEntry => Boolean(e) && typeof e.id === 'string' && typeof e.roomId === 'string' && typeof e.cipherHex === 'string' && typeof e.nonceHex === 'string')
      .sort((a, b) => a.createdAt - b.createdAt);
  } catch { return []; }
}

function save(store: KeyValueStore, userId: string, entries: OutboxEntry[]): void {
  try {
    if (entries.length === 0) store.removeItem(keyFor(userId));
    else store.setItem(keyFor(userId), JSON.stringify(entries));
  } catch { /* storage full or unavailable: the message stays in memory only */ }
}

/** Queues a message. Re-queuing the same id replaces it, so it can never be sent twice. */
export function enqueueOutbox(store: KeyValueStore, userId: string, entry: Omit<OutboxEntry, 'attempts'>): OutboxEntry[] {
  const next = [...loadOutbox(store, userId).filter((e) => e.id !== entry.id), { ...entry, attempts: 0 }]
    .sort((a, b) => a.createdAt - b.createdAt)
    .slice(-OUTBOX_MAX_ENTRIES);
  save(store, userId, next);
  return next;
}

export function removeFromOutbox(store: KeyValueStore, userId: string, ids: string[]): OutboxEntry[] {
  const drop = new Set(ids);
  const next = loadOutbox(store, userId).filter((e) => !drop.has(e.id));
  save(store, userId, next);
  return next;
}

export function clearOutbox(store: KeyValueStore, userId: string): void { try { store.removeItem(keyFor(userId)); } catch { /* nothing to clear */ } }

/** True when the failure is the connection (not the server refusing the message). */
export function isNetworkFailure(error: unknown, online: boolean = typeof navigator === 'undefined' ? true : navigator.onLine): boolean {
  if (!online) return true;
  const e = error as { message?: unknown; name?: unknown; status?: unknown } | null;
  const text = `${typeof e?.message === 'string' ? e.message : ''} ${typeof error === 'string' ? error : ''}`;
  if (/failed to fetch|load failed|networkerror|network request failed|fetch failed|network connection was lost|timed? ?out|econnreset|offline/i.test(text)) return true;
  return e?.name === 'TypeError' && /fetch|network|load/i.test(text);
}

export interface DrainResult {
  sent: string[];
  /** Refused by the server (blocked, left the chat, ...): will not be retried. */
  failed: string[];
  /** Past its disappearing-message time or too old: dropped without sending. */
  expired: string[];
  /** Still waiting (the connection is still down). */
  remaining: OutboxEntry[];
}

/** Sends queued messages oldest first. Stops at the first connection failure so order is kept. */
export async function drainOutbox(
  store: KeyValueStore,
  userId: string,
  send: (entry: OutboxEntry) => Promise<void>,
  now: number = Date.now(),
  online?: () => boolean,
): Promise<DrainResult> {
  const result: DrainResult = { sent: [], failed: [], expired: [], remaining: [] };
  const queue = loadOutbox(store, userId);
  const keep: OutboxEntry[] = [];
  let stopped = false;
  for (const entry of queue) {
    if (stopped) { keep.push(entry); continue; }
    if (now - entry.createdAt > OUTBOX_MAX_AGE_MS || (entry.expiresAt && Date.parse(entry.expiresAt) <= now)) { result.expired.push(entry.id); continue; }
    try {
      await send(entry);
      result.sent.push(entry.id);
    } catch (error) {
      if (isNetworkFailure(error, online ? online() : undefined)) { stopped = true; keep.push({ ...entry, attempts: entry.attempts + 1 }); }
      else result.failed.push(entry.id);
    }
  }
  save(store, userId, keep);
  result.remaining = keep;
  return result;
}
