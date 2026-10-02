import type { SwarmRoom, EncryptedMessage } from '../types';
import type { SupabaseMessageRow } from './supabaseService';
import type { ConversationKeyResult } from './conversationKeyService';

/** Account/device-local, bounded, RAM-only reuse. Never persist keys/plaintext.
 * Share in-flight work between inbox, active-room hydration and send. */
export class ChatMessageProcessor {
  private keys = new Map<string, { work: Promise<ConversationKeyResult>; expires: number }>();
  private texts = new Map<string, { version: string; work: Promise<string>; expires: number; created: number }>();
  generation = 0;
  constructor(
    private resolve: (room: SwarmRoom, userId?: string) => Promise<ConversationKeyResult>,
    private decrypt: (cipher: string, nonce: string, key: CryptoKey) => Promise<string>,
    private now = Date.now,
  ) {}
  clear() { this.generation++; this.keys.clear(); this.texts.clear(); }
  private keyId(room: SwarmRoom, userId: string) {
    return JSON.stringify([userId, room.id, room.type, room.peerKey, [...(room.memberIds ?? [])].sort()]);
  }
  key(room: SwarmRoom, userId: string): Promise<ConversationKeyResult> {
    const id = this.keyId(room, userId);
    const cached = this.keys.get(id);
    if (cached && cached.expires > this.now()) return cached.work;
    const entry = { work: Promise.resolve(null as unknown as ConversationKeyResult), expires: this.now() + 30_000 };
    entry.work = this.resolve(room, userId).then((result) => {
      entry.expires = this.now() + (result.key ? 300_000 : 250);
      return result;
    }, (error) => { if (this.keys.get(id) === entry) this.keys.delete(id); throw error; });
    this.keys.set(id, entry);
    if (this.keys.size > 64) this.keys.delete(this.keys.keys().next().value!);
    return entry.work;
  }
  forget(row: SupabaseMessageRow, userId: string) { this.texts.delete(`${userId}:${row.conversation_id}:${row.id}`); }
  text(room: SwarmRoom, row: SupabaseMessageRow, userId: string): Promise<string> {
    const id = `${userId}:${row.conversation_id}:${row.id}`;
    if (!row.nonce || row.burned_at || (row.expires_at && Date.parse(row.expires_at) <= this.now())) {
      this.texts.delete(id);
      return Promise.reject(new Error('Message no longer readable'));
    }
    const version = `${this.keyId(room, userId)}|${row.nonce}|${row.ciphertext}`;
    const cached = this.texts.get(id);
    if (cached?.version === version && cached.expires > this.now()) return cached.work;
    const keyId = this.keyId(room, userId);
    const keyWork = this.key(room, userId);
    const entry = { version, created: Date.parse(row.created_at) || 0, expires: Math.min(this.now() + 120_000, row.expires_at ? Date.parse(row.expires_at) : Infinity), work: Promise.resolve('') };
    entry.work = keyWork.then(async (result) => {
      if (!result.key) throw new Error(result.reason || 'Conversation key unavailable');
      try { return await this.decrypt(row.ciphertext, row.nonce!, result.key); }
      catch (error) {
        // A changed/revoked identity or envelope must be retryable; do not let
        // an old request evict the replacement key started by another row.
        if (this.keys.get(keyId)?.work === keyWork) this.keys.delete(keyId);
        throw error;
      }
    }).catch((error) => { if (this.texts.get(id) === entry) this.texts.delete(id); throw error; });
    this.texts.set(id, entry);
    if (this.texts.size > 512) {
      // History arrives newest-first. FIFO eviction retained the OLDEST 512
      // messages and evicted every recent message before a warm reopen.
      let oldest: string | undefined;
      let timestamp = Infinity;
      for (const [candidate, value] of this.texts) {
        if (value.created < timestamp || (value.created === timestamp && (!oldest || candidate < oldest))) {
          oldest = candidate; timestamp = value.created;
        }
      }
      if (oldest) this.texts.delete(oldest);
    }
    return entry.work;
  }
}

/** One React merge/sort per frame-sized batch, not one per decrypted row.
 * clear() also invalidates queued work on sign-out/cache purge/unmount. */
export class MessageBatcher {
  private pending: EncryptedMessage[] = [];
  private timer?: ReturnType<typeof setTimeout>;
  constructor(private publish: (messages: EncryptedMessage[]) => void) {}
  add(message: EncryptedMessage) {
    this.pending.push(message);
    if (this.timer !== undefined) return;
    this.timer = setTimeout(() => {
      this.timer = undefined;
      const batch = this.pending;
      this.pending = [];
      this.publish(batch);
    }, 16);
  }
  clear() {
    if (this.timer !== undefined) clearTimeout(this.timer);
    this.timer = undefined;
    this.pending = [];
  }
}
