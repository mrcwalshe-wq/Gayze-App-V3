/**
 * Catch-up scans must not download message bodies again. A scan runs on every reconnect and every 30 seconds while a chat is open;
 * re-reading every body (including multi-megabyte photos) each time is what exhausted the project's data-transfer allowance.
 *   npx tsx --test scripts/chat-tests/egress.test.ts
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { reconcileMessages, rowVersionKey } from '../../src/services/chatSubscriptions.ts';

type Row = { id: string; conversation_id: string; sender_id: string; ciphertext?: string; nonce: string; created_at: string; expires_at: null; burned_at: null; unsent_at: string | null; key_version: number };
const row = (id: string, conv: string, minute: number, body = 'x'.repeat(1000)): Row => ({
  id, conversation_id: conv, sender_id: 'u', ciphertext: body, nonce: `n-${id}`, created_at: `2026-11-01T10:${String(minute).padStart(2, '0')}:00.000Z`,
  expires_at: null, burned_at: null, unsent_at: null, key_version: 1,
});

/** A stand-in for PostgREST that honours the selected columns and counts body bytes sent. */
function backend(rows: Row[]) {
  const stats = { scans: 0, bodyReads: 0, bodyBytes: 0, bodyIds: [] as string[] };
  const client: any = {
    rpc() { return { abortSignal: async () => ({ data: [...new Set(rows.map((r) => r.conversation_id))].map((conversation_id) => ({ conversation_id })), error: null }) }; },
    from() {
      let columns = '', conv: string | undefined, convs: string[] | undefined, ids: string[] | undefined, limit = 1000, cursor: { created_at: string; id: string } | undefined;
      const q: any = {
        select(c: string) { columns = c; return q; }, order() { return q; }, limit(n: number) { limit = n; return q; },
        eq(_k: string, v: string) { conv = v; return q; },
        in(k: string, v: string[]) { if (k === 'id') ids = v; else convs = v; return q; },
        or(f: string) { const m = f.match(/created_at\.lt\.([^,]+),and\(created_at\.eq\.[^,]+,id\.lt\.([^)]+)\)/)!; cursor = { created_at: m[1], id: m[2] }; return q; },
        abortSignal() { return q; },
        then(resolve: any, reject: any) {
          const withBody = columns.split(',').includes('ciphertext');
          let out = rows.filter((r) => (!conv || r.conversation_id === conv) && (!convs || convs.includes(r.conversation_id)) && (!ids || ids.includes(r.id)));
          out = out.sort((a, b) => b.created_at.localeCompare(a.created_at) || b.id.localeCompare(a.id));
          if (cursor) out = out.filter((r) => r.created_at < cursor!.created_at || (r.created_at === cursor!.created_at && r.id < cursor!.id));
          out = out.slice(0, limit);
          if (ids) { stats.bodyReads += 1; stats.bodyIds.push(...out.map((r) => r.id)); } else stats.scans += 1;
          const data = out.map((r) => { if (withBody) { stats.bodyBytes += (r.ciphertext ?? '').length; return { ...r }; } const { ciphertext: _omit, ...rest } = r; void _omit; return rest; });
          return Promise.resolve({ data, error: null }).then(resolve, reject);
        },
      };
      return q;
    },
  };
  return { client, stats };
}
const run = async (client: any, conv: string | undefined, options: any) => {
  const got: Row[] = [];
  await reconcileMessages(client, conv, new AbortController().signal, async (r) => { got.push(r as unknown as Row); options.cache?.set(r.id, r); }, () => {}, undefined, Infinity, options);
  return got;
};

test('a second scan of the same chat downloads no message bodies at all', async () => {
  const photo = 'p'.repeat(5_000_000);
  const rows = [row('a', 'c1', 1), row('b', 'c1', 2, photo), row('c', 'c1', 3)];
  const { client, stats } = backend(rows);
  const cache = new Map<string, any>();
  const first = await run(client, 'c1', { cache });
  assert.deepEqual(first.map((r) => r.id), ['c', 'b', 'a']);
  assert.equal(first[1].ciphertext!.length, 5_000_000, 'the photo arrives whole the first time');
  const afterFirst = stats.bodyBytes;
  for (let i = 0; i < 20; i += 1) await run(client, 'c1', { cache });   // twenty 30-second re-checks
  assert.equal(stats.bodyBytes, afterFirst, 'no body bytes after the first load');
  assert.ok(afterFirst < 5_100_000, 'and the first load read each body once');
});

test('only a row that is new or changed is downloaded on a later scan', async () => {
  const rows = [row('a', 'c1', 1), row('b', 'c1', 2)];
  const { client, stats } = backend(rows);
  const cache = new Map<string, any>();
  await run(client, 'c1', { cache });
  stats.bodyIds.length = 0;
  rows.push(row('c', 'c1', 3));                         // a new message
  rows[0] = { ...rows[0], nonce: 'n-a-edited', ciphertext: 'edited' };   // a changed one
  const again = await run(client, 'c1', { cache });
  assert.deepEqual([...stats.bodyIds].sort(), ['a', 'c'], 'only the new and the changed row were fetched');
  assert.equal(again.find((r) => r.id === 'a')!.ciphertext, 'edited');
  assert.notEqual(rowVersionKey(rows[0] as any), 'n-a|null|null|null');
});

test('the inbox reads only each chat’s newest message, plus anything that arrived since it started', async () => {
  const rows = [row('a1', 'c1', 1), row('a2', 'c1', 2, 'P'.repeat(2_000_000)), row('a3', 'c1', 3), row('b1', 'c2', 4), row('b2', 'c2', 5), row('late', 'c1', 30)];
  const { client, stats } = backend(rows);
  const since = Date.parse('2026-11-01T10:29:00.000Z');
  const got = await run(client, undefined, { cache: new Map(), latestOnly: true, since });
  assert.deepEqual(got.map((r) => r.id).sort(), ['b2', 'late'], 'newest of each chat (late is both newest of c1 and fresh)');
  assert.ok(stats.bodyBytes < 10_000, `the old 2 MB photo was not downloaded (${stats.bodyBytes} bytes)`);
  // a fresh message that is not the newest of its chat still arrives
  rows.push(row('late2', 'c1', 31));
  const more = await run(client, undefined, { cache: new Map(), latestOnly: true, since });
  assert.ok(more.some((r) => r.id === 'late') && more.some((r) => r.id === 'late2'));
});

test('an unsent message is delivered without fetching a body', async () => {
  const rows = [{ ...row('a', 'c1', 1), ciphertext: undefined, unsent_at: '2026-11-01T10:05:00.000Z' } as Row];
  const { client, stats } = backend(rows);
  const got = await run(client, 'c1', { cache: new Map() });
  assert.equal(got.length, 1); assert.equal(got[0].ciphertext, ''); assert.equal(stats.bodyReads, 0);
});
