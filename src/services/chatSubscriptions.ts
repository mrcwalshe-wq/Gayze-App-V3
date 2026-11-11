import { traceChat, countChatWork } from './chatTrace';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { SupabaseMessageRow } from './supabaseService';
import { RealtimeRecovery, requireRealtimeSession, type ChatConnectionState, type RecoveryEnvironment } from './realtimeRecovery';

const MESSAGE_COLUMNS = 'id,conversation_id,sender_id,ciphertext,nonce,created_at,expires_at,burned_at,unsent_at,key_version';
/**
 * Everything except the message body. Catch-up scans run on every reconnect AND every 30 seconds while a chat is open; reading the
 * bodies each time meant every photo in every chat was downloaded again and again (megabytes per scan), which is what used up the
 * project's data-transfer allowance. A scan now reads only these small columns, and a body is downloaded once: when the row is new
 * to this session or has changed.
 */
const SCAN_COLUMNS = 'id,conversation_id,sender_id,nonce,created_at,expires_at,burned_at,unsent_at,key_version';
/** A row's body can only change together with these, so they identify a version without holding the body. */
export const rowVersionKey = (row: Pick<SupabaseMessageRow, 'nonce' | 'burned_at' | 'expires_at' | 'unsent_at'>): string =>
  `${row.nonce}|${row.burned_at}|${row.expires_at}|${row.unsent_at}`;
export interface ReconcileOptions {
  /** Whole rows this session already holds, by id. Rows found here unchanged are not downloaded again. */
  cache?: Map<string, SupabaseMessageRow>;
  /** The inbox only needs each chat's newest message (for the preview) and anything that arrived since it started. */
  latestOnly?: boolean;
  /** With latestOnly: rows created at or after this time (ms) are always included. */
  since?: number;
}
export interface MessageDelivery {
  /** False for old history on initial load, expired rows and duplicate delivery. */
  notify: boolean;
  current(): boolean;
}
/** Returning false keeps a displayed encrypted placeholder retryable on the
 * next reconciliation, without treating missing keys as a channel failure. */
export type MessageListener = (row: SupabaseMessageRow, delivery: MessageDelivery) => void | boolean | Promise<void | boolean>;

type Page = { data: unknown; error: unknown };
interface PageRead { work: Promise<Page>; abort: AbortController; readers: number; }
const pageReads = new WeakMap<SupabaseClient, Map<string, PageRead>>();

/** Identical inbox/room REST pages share in-flight I/O, not retained history.
 * Each reader keeps its own cancellation; only the final release aborts HTTP.
 * Explicit account scope prevents reuse across an authentication switch. */
async function readPage(client: SupabaseClient, userId: string | undefined, key: string,
  signal: AbortSignal, read: (signal: AbortSignal) => PromiseLike<Page>): Promise<Page> {
  if (!userId) return read(signal);
  let pages = pageReads.get(client);
  if (!pages) { pages = new Map(); pageReads.set(client, pages); }
  const id = `${userId}:${key}`;
  let entry = pages.get(id);
  if (!entry) {
    const abort = new AbortController();
    entry = { abort, readers: 0, work: Promise.resolve().then(() => read(abort.signal)) };
    pages.set(id, entry);
  }
  const acquired = entry;
  acquired.readers++;
  try { return await untilAborted(acquired.work, signal); }
  finally {
    if (--acquired.readers === 0) {
      acquired.abort.abort();
      if (pages.get(id) === acquired) pages.delete(id);
    }
  }
}

/** Full keyset scan on rejoin: does not trust a timestamp watermark to represent
 * commit order. No row is skipped just because it committed late or a page hit
 * the server's configured row limit. No DELETE-by-absence on a partial scan. */
export async function reconcileMessages(
  client: SupabaseClient,
  conversationId: string | undefined,
  signal: AbortSignal,
  accept: (row: SupabaseMessageRow) => Promise<void>,
  progress: () => void = () => {},
  userId?: string,
  historyLimit = Infinity,
  options: ReconcileOptions = {},
) {
  const latestSeen = new Set<string>();
  let ids = conversationId ? [conversationId] : [];
  if (!conversationId) {
    // Defence in depth: restrict REST catch-up to the existing membership-scoped
    // inbox RPC too. RLS is still mandatory; never download the entire messages
    // table on the assumption that a production policy must be correct.
    const { data, error } = await client.rpc('get_my_conversations').abortSignal(signal);
    if (signal.aborted) return;
    if (error) throw error;
    ids = [...new Set<string>((data ?? []).map((row: { conversation_id: string }) => row.conversation_id))];
  }
  for (let start = 0; start < ids.length && !signal.aborted; start += 50) {
    const group = ids.slice(start, start + 50);
    let cursor: SupabaseMessageRow | undefined;
    let delivered = 0;
    while (!signal.aborted && delivered < historyLimit) {
      const pageLimit = Math.min(cursor ? 200 : 50, historyLimit - delivered);
      let query = client.from('messages').select(SCAN_COLUMNS)
        .order('created_at', { ascending: false }).order('id', { ascending: false }).limit(pageLimit);
      query = group.length === 1 ? query.eq('conversation_id', group[0]) : query.in('conversation_id', group);
      if (cursor) {
        // Cursor values are typed DB timestamp/UUID columns, never user filters.
        query = query.or(`created_at.lt.${cursor.created_at},and(created_at.eq.${cursor.created_at},id.lt.${cursor.id})`);
      }
      const pageKey = JSON.stringify([[...group].sort(), cursor?.created_at, cursor?.id, pageLimit]);
      const { data, error } = await readPage(client, userId, pageKey, signal, (sharedSignal) => query.abortSignal(sharedSignal));
      if (signal.aborted) return;
      if (error) throw error;
      if (conversationId) { traceChat(conversationId, 'first-page'); countChatWork(conversationId, 'pages'); }
      progress();
      const rows = (data ?? []) as SupabaseMessageRow[];
      if (conversationId) countChatWork(conversationId, 'rows', rows.length);
      if (!rows.length) break;
      // Which of these rows does the caller need, and which bodies are not held yet?
      const wanted = rows.filter((row) => {
        if (!options.latestOnly) return true;
        const fresh = options.since !== undefined && Date.parse(row.created_at) >= options.since;
        const newest = !latestSeen.has(row.conversation_id);
        latestSeen.add(row.conversation_id);
        return newest || fresh;
      });
      const whole = new Map<string, SupabaseMessageRow>();
      const missing: string[] = [];
      for (const row of wanted) {
        const held = options.cache?.get(row.id);
        if (typeof row.ciphertext === 'string') whole.set(row.id, row);                       // the server sent the body anyway
        else if (row.unsent_at) whole.set(row.id, { ...row, ciphertext: '' });                 // unsent rows have no body
        else if (held && rowVersionKey(held) === rowVersionKey(row)) whole.set(row.id, held);  // already downloaded, unchanged
        else missing.push(row.id);
      }
      for (let offset = 0; offset < missing.length && !signal.aborted; offset += 20) {
        const { data: bodies, error: bodyError } = await client.from('messages').select(MESSAGE_COLUMNS).in('id', missing.slice(offset, offset + 20)).abortSignal(signal);
        if (signal.aborted) return;
        if (bodyError) throw bodyError;
        for (const row of (bodies ?? []) as SupabaseMessageRow[]) whole.set(row.id, row);
      }
      const ready = wanted.map((row) => whole.get(row.id)).filter((row): row is SupabaseMessageRow => Boolean(row));
      // Recent page first; bounded parallel crypto/key work, with a task yield
      // between batches so React/scroll/input are not starved by old history.
      for (let offset = 0; offset < ready.length && !signal.aborted; offset += 8) {
        await Promise.all(ready.slice(offset, offset + 8).map(accept));
        progress();
        await new Promise<void>((resolve) => setTimeout(resolve, 0));
      }
      delivered += rows.length;
      const next = rows[rows.length - 1];
      if (next.id === cursor?.id) throw new Error('Message cursor did not advance');
      cursor = next;
    }
  }
}

// A suspended/dead consumer request must not pin the delivery queue across a
// channel generation. Its eventual result is still guarded by delivery.current.
function untilAborted<T>(work: Promise<T>, signal: AbortSignal): Promise<T> {
  return new Promise((resolve, reject) => {
    const cancelled = () => { signal.removeEventListener('abort', cancelled); reject(new Error('Message delivery cancelled')); };
    if (signal.aborted) { void work.catch(() => undefined); cancelled(); return; }
    signal.addEventListener('abort', cancelled, { once: true });
    work.then((value) => { signal.removeEventListener('abort', cancelled); resolve(value); }, (error) => {
      signal.removeEventListener('abort', cancelled); reject(error);
    });
  });
}

interface Observer {
  row: MessageListener;
  status?: (state: ChatConnectionState) => void;
  seen: Map<string, string>;
  notified: Set<string>;
  live: boolean;
  recentOnly?: () => boolean;
}
interface Stream { observers: Set<Observer>; recovery: RealtimeRecovery; state: ChatConnectionState; }
const clients = new WeakMap<SupabaseClient, Map<string, Stream>>();

/** The two existing message feeds use the SAME Supabase client/socket. */
export function subscribeToRecoveredMessages(
  client: SupabaseClient,
  userId: string,
  conversationId: string | undefined,
  onMessage: MessageListener,
  onStatus?: (state: ChatConnectionState) => void,
  environment?: RecoveryEnvironment,
  recentOnly?: () => boolean,
): () => void {
  if (conversationId) traceChat(conversationId, 'subscription-requested');
  let streams = clients.get(client);
  if (!streams) { streams = new Map(); clients.set(client, streams); }
  const key = `${userId}:${conversationId ?? 'inbox'}`;
  const observer: Observer = { row: onMessage, status: onStatus, seen: new Map(), notified: new Set(), live: true, recentOnly };
  let stream = streams.get(key);
  if (!stream) {
    const startedAt = environment?.now() ?? Date.now();
    const observers = new Set<Observer>();
    const tails = new Map<string, Promise<void>>();
    // Whole rows already downloaded in this session, so catch-up scans never download a message body twice.
    const held = new Map<string, SupabaseMessageRow>();
    let liveTail = Promise.resolve();
    const deliver = (row: SupabaseMessageRow, current: () => boolean, realtime: boolean, signal: AbortSignal) => {
      // Serialize versions of the SAME ID, not every message in the account.
      const work = (tails.get(row.id) ?? Promise.resolve()).then(async () => {
        if (!current() || !row.id || !row.conversation_id) return;
        if (typeof row.ciphertext === 'string') held.set(row.id, row);
        const version = `${row.nonce}|${row.ciphertext}|${row.burned_at}|${row.expires_at}`;
        for (const consumer of observers) {
          if (!current() || !consumer.live || consumer.seen.get(row.id) === version) continue;
          const notify = (realtime || Date.parse(row.created_at) >= startedAt)
            && !consumer.seen.has(row.id) && !consumer.notified.has(row.id) && !row.burned_at
            && (!row.expires_at || Date.parse(row.expires_at) > Date.now());
          const accepted = await untilAborted(Promise.resolve(consumer.row(row, { notify, current: () => consumer.live && current() })), signal);
          if (current() && consumer.live) {
            if (notify) consumer.notified.add(row.id);
            if (accepted !== false) consumer.seen.set(row.id, version);
          }
        }
      });
      const tail = work.catch(() => undefined);
      tails.set(row.id, tail);
      void tail.then(() => { if (tails.get(row.id) === tail) tails.delete(row.id); });
      return work;
    };
    const entry: Stream = { observers, state: 'connecting', recovery: null! };
    stream = entry;
    streams.set(key, entry);
    entry.recovery = new RealtimeRecovery({
      client, userId,
      topic: `gayze-messages-${userId}-${conversationId ?? 'inbox'}`,
      session: (signal) => requireRealtimeSession(client, userId, signal),
      environment,
      subscribed: () => { if (conversationId) traceChat(conversationId, 'realtime-subscribed'); },
      build: (channel, current, signal) => channel.on('postgres_changes', {
        event: '*', schema: 'public', table: 'messages',
        ...(conversationId ? { filter: `conversation_id=eq.${conversationId}` } : {}),
      }, (payload) => {
        if (payload.eventType === 'DELETE') return; // RLS deletion payloads may omit the room.
        // Realtime leaves the big columns out of a row over its size limit (a large photo). Fetch the whole row instead of
        // dropping the message, so it still arrives live.
        const incoming = payload.new as SupabaseMessageRow;
        const whole = async (): Promise<SupabaseMessageRow> => {
          if (incoming?.id && !incoming.ciphertext && !incoming.unsent_at) {
            const { data } = await client.from('messages').select(MESSAGE_COLUMNS).eq('id', incoming.id).abortSignal(signal).maybeSingle();
            if (data) return data as SupabaseMessageRow;
          }
          return incoming;
        };
        // Live messages get their own lane: never wait behind a history page.
        liveTail = liveTail.then(whole).then((row) => deliver(row, current, payload.eventType === 'INSERT', signal))
          .catch(() => { if (current()) entry.recovery.resync(); });
      }),
      reconcile: (signal, current, progress) => reconcileMessages(client, conversationId, signal, (row) => deliver(row, current, false, signal), progress, userId,
        conversationId && observers.size && [...observers].every((consumer) => consumer.recentOnly?.() === true) ? 50 : Infinity,
        { cache: held, latestOnly: !conversationId, since: startedAt }),
      status: (state) => {
        if (state === 'connected' && conversationId) traceChat(conversationId, 'history-complete');
        entry.state = state;
        observers.forEach((consumer) => { if (consumer.live) consumer.status?.(state); });
      },
    });
  } else {
    // New observer has its own delivery acknowledgement set. A joined feed
    // needs another reconciliation to bring that observer up to date too.
    stream.recovery.resync();
  }
  stream.observers.add(observer);
  onStatus?.(stream.state);
  const acquired = stream;
  return () => {
    if (!observer.live) return;
    observer.live = false;
    acquired.observers.delete(observer);
    observer.seen.clear();
    if (acquired.observers.size) return;
    acquired.recovery.stop();
    if (streams!.get(key) === acquired) streams!.delete(key);
  };
}
