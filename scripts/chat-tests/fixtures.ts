import type { SupabaseMessageRow } from '../../src/services/supabaseService';
export const delay = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));
export const row = (index: number): SupabaseMessageRow => ({
  id: `00000000-0000-4000-8000-${String(index).padStart(12, '0')}`, conversation_id: 'room', sender_id: 'peer',
  created_at: new Date(1_700_000_000_000 + Math.floor(index / 3) * 1000).toISOString(),
  ciphertext: 'cipher', nonce: 'nonce', burned_at: null, expires_at: null,
});
/** REST boundary only. Real scanner/crypto/merge run unchanged. */
export function messageBackend(rows: SupabaseMessageRow[], cap = 1000) {
  const requests: { ascending: boolean; limit: number; cursor?: string }[] = [];
  return {
    requests,
    rpc() { return { abortSignal: async () => ({ data: [{ conversation_id: 'room' }], error: null }) }; },
    from(table: string) {
      if (table !== 'messages') throw new Error('Unexpected table');
      let ascending = true, limit = 1000, cursor: string | undefined, signal: AbortSignal;
      const query: any = {
        select() { return query; }, eq() { return query; }, in() { return query; },
        order(_column: string, options: { ascending: boolean }) { ascending = options.ascending; return query; },
        limit(value: number) { limit = value; return query; },
        or(value: string) { cursor = value.match(/id\.(?:lt|gt)\.([^)]*)/)?.[1]; return query; },
        abortSignal(value: AbortSignal) { signal = value; return query; },
        then(resolve: any, reject: any) {
          requests.push({ ascending, limit, cursor });
          const sorted = [...rows].sort((a, b) => a.created_at.localeCompare(b.created_at) || a.id.localeCompare(b.id));
          if (!ascending) sorted.reverse();
          const start = cursor ? sorted.findIndex((value) => value.id === cursor) + 1 : 0;
          return Promise.resolve({ data: signal?.aborted ? [] : sorted.slice(start, start + Math.min(cap, limit)), error: null }).then(resolve, reject);
        },
      };
      return query;
    },
  };
}
