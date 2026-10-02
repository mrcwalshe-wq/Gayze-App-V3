import assert from 'node:assert/strict';
import { test } from 'node:test';
import { subscribeToRecoveredMessages, reconcileMessages } from '../../src/services/chatSubscriptions.ts';
import { RealtimeRecovery, requireRealtimeSession, SessionRequiredError } from '../../src/services/realtimeRecovery.ts';
import { mergeMessage } from '../../src/services/messageMerge.ts';
import { IceCredentialCache } from '../../src/services/iceCredentials.ts';

const flush = async () => { for (let i = 0; i < 4; i++) { for (let j = 0; j < 80; j++) await Promise.resolve(); await new Promise((resolve) => setTimeout(resolve, 1)); } };
function environment() {
  let time = 100_000, next = 0;
  const timers = new Map<number, { at: number; fn: () => void }>();
  const watchers = new Set<() => void>();
  const env = {
    isOnline: true, isVisible: true,
    online: () => env.isOnline, visible: () => env.isVisible, now: () => time, random: () => 0,
    later(fn: () => void, ms: number) { const id = ++next; timers.set(id, { fn, at: time + ms }); return id; },
    cancel(id: number) { timers.delete(id); },
    watch(fn: () => void) { watchers.add(fn); return () => watchers.delete(fn); },
    event() { for (const fn of watchers) fn(); },
    async advance(ms: number) {
      const end = time + ms;
      for (;;) {
        await flush();
        const due = [...timers].filter(([, t]) => t.at <= end).sort((a, b) => a[1].at - b[1].at)[0];
        if (!due) break;
        time = due[1].at; timers.delete(due[0]); due[1].fn();
      }
      time = end; await flush();
    },
    timers, watchers,
  };
  return env;
}
function row(id: string, created = '1970-01-01T00:02:00.000Z') {
  return { id, conversation_id: 'room', sender_id: 'peer', ciphertext: 'cipher', nonce: 'nonce', created_at: created, burned_at: null, expires_at: null };
}
function backend() {
  const active = new Map<string, any>();
  const created: any[] = [];
  const authCallbacks = new Set<(event: string, session?: any) => void>();
  const data: any = {
    rows: [] as any[], readError: false, reads: 0, sessionError: false, noSession: false,
    socketResets: 0,
    realtime: { async disconnect() { data.socketResets++; }, connect() {} },
    joins: 0, refreshes: 0, expired: false, leave: null as null | Promise<void>,
    auth: {
      async getSession() { if (data.sessionError) throw new Error('network'); return { data: { session: data.noSession ? null : { user: { id: 'user' }, expires_at: data.expired ? 1 : Date.now() / 1000 + 3600 } }, error: null }; },
      async refreshSession() { data.refreshes++; data.expired = false; return data.auth.getSession(); },
      onAuthStateChange(fn: (event: string) => void) { authCallbacks.add(fn); return { data: { subscription: { unsubscribe: () => authCallbacks.delete(fn) } } }; },
    },
    authEvent(event: string, session?: any) { authCallbacks.forEach((fn) => fn(event, session)); },
    channel(topic: string) {
      if (active.has(topic)) return active.get(topic); // Match real SDK topic reuse.
      const bindings: any[] = [];
      const channel: any = {
        topic, state: 'joining', closed: false,
        on(type: string, filter: any, callback: any) { bindings.push({ type, filter, callback }); return channel; },
        subscribe(callback: any) { assert(!channel.callback, 'duplicate subscribe'); channel.callback = callback; data.joins++; return channel; },
        status(status: string) { channel.state = status === 'SUBSCRIBED' ? 'joined' : 'errored'; channel.callback(status); },
        emit(message: any) { bindings.forEach(({ callback }) => callback({ eventType: 'INSERT', new: message })); },
        async unsubscribe() { if (data.leave) await data.leave; channel.status('CLOSED'); return 'ok'; },
        teardown() { channel.closed = true; if (active.get(topic) === channel) active.delete(topic); },
      };
      active.set(topic, channel); created.push(channel); return channel;
    },
    rpc(name: string) {
      assert.equal(name, 'get_my_conversations');
      return { abortSignal: async () => ({ data: data.rows.map((r: any) => ({ conversation_id: r.conversation_id })), error: null }) };
    },
    from(table: string) {
      assert.equal(table, 'messages');
      let room: string | undefined, rooms: string[] | undefined, cursor: string | undefined, signal: AbortSignal, ascending = true;
      const q: any = {
        select() { return q; }, order(_key: string, options: any) { ascending = options?.ascending ?? true; return q; }, limit() { return q; },
        eq(_key: string, value: string) { room = value; return q; },
        in(_key: string, value: string[]) { rooms = value; return q; },
        or(filter: string) { cursor = filter.match(/id.(?:gt|lt).([^)]*)/)?.[1]; return q; },
        abortSignal(value: AbortSignal) { signal = value; return q; },
        then(resolve: any, reject: any) {
          data.reads++;
          if (data.readError) return Promise.resolve({ data: null, error: new Error('read failed') }).then(resolve, reject);
          const sorted = data.rows.filter((r: any) => (!room || r.conversation_id === room) && (!rooms || rooms.includes(r.conversation_id))).sort((a: any, b: any) => a.created_at.localeCompare(b.created_at) || a.id.localeCompare(b.id));
          if (!ascending) sorted.reverse();
          const start = cursor ? sorted.findIndex((r: any) => r.id === cursor) + 1 : 0;
          return Promise.resolve({ data: signal?.aborted ? [] : sorted.slice(start, start + 2), error: null }).then(resolve, reject);
        },
      };
      return q;
    }, created, active, authCallbacks,
  };
  return data;
}
function subscribe(db: any, env: any, rows: any[], statuses: string[] = [], scope: string | undefined = 'room') {
  return subscribeToRecoveredMessages(db, 'user', scope, async (value, delivery) => {
    if (delivery.current()) rows.push({ ...value, notify: delivery.notify });
  }, (state) => statuses.push(state), env);
}

test('initial read failure does not prevent subscription; retry reconciles and becomes connected', async () => {
  const env = environment(), db = backend(), rows: any[] = [], states: string[] = [];
  db.readError = true;
  const stop = subscribe(db, env, rows, states);
  await env.advance(150); assert.equal(db.created.length, 1);
  db.created[0].status('SUBSCRIBED'); await flush();
  assert.equal(states.at(-1), 'syncing');
  db.readError = false; db.rows = [row('a')];
  await env.advance(1000); db.created.at(-1).status('SUBSCRIBED'); await flush();
  assert.equal(states.at(-1), 'connected'); assert.deepEqual(rows.map((r) => r.id), ['a']);
  stop(); await flush(); assert.equal(db.active.size, 0); assert.equal(env.watchers.size, 0);
});

test('foreground replaces stale socket and recovers missed rows once, including late committed older rows', async () => {
  const env = environment(), db = backend(), rows: any[] = [], states: string[] = [];
  db.rows = [row('b')];
  const stop = subscribe(db, env, rows, states);
  await env.advance(150); db.created[0].status('SUBSCRIBED'); await flush();
  const old = db.created[0];
  env.isVisible = false; env.event(); await flush();
  assert.equal(states.at(-1), 'suspended');
  db.rows.push(row('a', '1970-01-01T00:00:10.000Z'), row('c'));
  env.isVisible = true; env.event(); env.event(); env.event();
  await env.advance(1000); assert.equal(db.created.length, 2);
  db.created[1].status('SUBSCRIBED'); await flush();
  old.status('CLOSED'); old.status('TIMED_OUT'); old.emit(row('stale'));
  db.created[1].emit(row('c')); await flush();
  assert.equal(states.at(-1), 'connected');
  assert.deepEqual(rows.map((r) => r.id).sort(), ['a', 'b', 'c']);
  assert.equal(rows.find((r) => r.id === 'a').notify, false);
  assert.equal(rows.find((r) => r.id === 'c').notify, true);
  stop();
});

test('missed online event is repaired by pageshow/visibility and events cannot produce a reconnect storm', async () => {
  const env = environment(), db = backend(), states: string[] = [];
  const stop = subscribe(db, env, [], states);
  await env.advance(150); db.created[0].status('SUBSCRIBED'); await flush();
  env.isOnline = false; env.event(); assert.equal(states.at(-1), 'offline');
  await env.advance(120_000); assert.equal(db.created.length, 1);
  env.isOnline = true;
  for (let i = 0; i < 100; i++) env.event();
  await env.advance(1000); assert.equal(db.created.length, 2);
  db.created[1].status('SUBSCRIBED'); await flush(); assert.equal(states.at(-1), 'connected'); stop();
});

for (const status of ['CHANNEL_ERROR', 'ERROR', 'TIMED_OUT', 'CLOSED']) {
  test(`${status} is retried; successful SDK rejoin cancels pending replacement`, async () => {
    const env = environment(), db = backend(), states: string[] = [];
    const stop = subscribe(db, env, [], states);
    await env.advance(150); const channel = db.created[0];
    channel.status(status); channel.status('SUBSCRIBED'); await flush();
    await env.advance(2000); assert.equal(db.created.length, 1); assert.equal(states.at(-1), 'connected'); stop();
  });
}

test('a join with no status times out, and a slow leave serializes StrictMode remount', async () => {
  const env = environment(), db = backend();
  let release!: () => void;
  const stop = subscribe(db, env, []);
  await env.advance(150); await env.advance(20_000);
  assert.equal(db.socketResets, 1);
  db.leave = new Promise<void>((resolve) => { release = resolve; });
  await env.advance(1000); // second channel now joining
  stop();
  const second = subscribe(db, env, []);
  await env.advance(1000); const count = db.created.length;
  assert.equal(db.active.size, 1);
  release(); await flush(); assert.equal(db.created.length, count + 1);
  assert.equal(db.active.size, 1); second(); await flush();
});

test('two consumers share one channel but have independent rows, statuses and cleanup', async () => {
  const env = environment(), db = backend(), first: any[] = [], second: any[] = [], states: string[] = [];
  const a = subscribe(db, env, first);
  const b = subscribe(db, env, second, states);
  await env.advance(150); assert.equal(db.created.length, 1);
  db.created[0].status('SUBSCRIBED'); db.created[0].emit(row('a')); await flush();
  assert.equal(first.length, 1); assert.equal(second.length, 1);
  a(); db.created[0].emit(row('b')); db.created[0].status('CHANNEL_ERROR'); await flush();
  assert.equal(first.length, 1); assert.equal(second.length, 2); assert.equal(states.at(-1), 'reconnecting');
  b(); b(); await flush(); assert.equal(db.active.size, 0);
});

test('inbox and room both recover through the same client and neither is gated by UI hydration', async () => {
  const env = environment(), db = backend(), inbox: any[] = [], roomRows: any[] = [];
  db.rows = [row('a'), { ...row('b'), conversation_id: 'other-room' }];
  const b = subscribeToRecoveredMessages(db, 'user', undefined, (r) => { inbox.push(r); }, undefined, env as any);
  const c = subscribe(db, env, roomRows);
  await env.advance(150); db.created.forEach((ch: any) => ch.status('SUBSCRIBED')); await flush();
  assert.deepEqual(inbox.map((r) => r.id), ['b', 'a']); assert.deepEqual(roomRows.map((r) => r.id), ['a']); b(); c();
});

test('expired token refreshed before join; signout cancels callbacks and never retries old user', async () => {
  const env = environment(), db = backend(), rows: any[] = [], states: string[] = [];
  db.expired = true;
  const stop = subscribe(db, env, rows, states);
  await env.advance(150); assert.equal(db.refreshes, 1);
  const old = db.created[0]; old.status('SUBSCRIBED'); await flush();
  db.noSession = true; db.authEvent('SIGNED_OUT'); old.emit(row('late'));
  await env.advance(40_000); assert.equal(rows.length, 0); assert.equal(states.at(-1), 'sign-in-required');
  assert.equal(db.created.length, 1); stop();
});

test('session loss and session network failure are distinguished', async () => {
  const db = backend(); db.noSession = true;
  await assert.rejects(requireRealtimeSession(db, 'user', new AbortController().signal), SessionRequiredError);
  db.noSession = false; db.sessionError = true;
  await assert.rejects(requireRealtimeSession(db, 'user', new AbortController().signal), /network/);
});

test('REST pagination crosses small server caps and equal timestamps without omissions', async () => {
  const db = backend(); db.rows = [row('a'), row('b'), row('c'), row('d'), row('e')];
  const received: string[] = [];
  await reconcileMessages(db, 'room', new AbortController().signal, async (r) => { received.push(r.id); });
  assert.deepEqual(received, ['e', 'd', 'c', 'b', 'a']); assert.equal(db.reads, 4);
});

test('reconciliation is single flight and cancellation prevents late consumer work', async () => {
  const env = environment(), db = backend(); let finish!: () => void; let deliveries = 0;
  const gate = new Promise<void>((resolve) => { finish = resolve; });
  db.rows = [row('a')];
  const stop = subscribeToRecoveredMessages(db, 'user', 'room', async (_r, delivery) => {
    await gate; if (delivery.current()) deliveries++;
  }, undefined, env as any);
  await env.advance(150); db.created[0].status('SUBSCRIBED'); db.created[0].status('SUBSCRIBED');
  await flush(); assert.equal(db.reads, 1);
  stop(); finish(); await flush(); assert.equal(deliveries, 0);
});

test('stable merge retains history, orders equal timestamps, and cannot resurrect burn or downgrade plaintext', () => {
  const a: any = { id: 'a', timestamp: 1, plainText: 'hello', isBurned: false };
  let rows = mergeMessage([], { ...a, id: 'b' }); rows = mergeMessage(rows, a);
  rows = mergeMessage(rows, { ...a, plainText: '[Encrypted message]' });
  assert.deepEqual(rows.map((r) => r.id), ['a', 'b']); assert.equal(rows[0].plainText, 'hello');
  rows = mergeMessage(rows, { ...a, isBurned: true }); rows = mergeMessage(rows, a);
  assert.equal(rows[0].isBurned, true); assert.equal(rows[0].plainText, ''); assert.equal(rows.length, 2);
});

test('TURN cache refreshes before expiry, deduplicates fetches, and never caches absent TTL or failure', async () => {
  let now = 10_000, calls = 0;
  const servers = [{ urls: 'turn:relay.example:3478', username: 'temporary', credential: 'test-only' }];
  const cache = new IceCredentialCache(async () => { calls++; return { iceServers: servers, ttl: 100 }; }, () => now);
  await Promise.all([cache.get(), cache.get()]); assert.equal(calls, 1);
  now = 89_000; await cache.get(); assert.equal(calls, 1);
  now = 90_000; await cache.get(); assert.equal(calls, 2);
  cache.clear(); await cache.get(); assert.equal(calls, 3);
  let count = 0;
  const unknown = new IceCredentialCache(async () => { count++; if (count === 1) throw new Error('temporary'); return { iceServers: servers }; });
  await assert.rejects(unknown.get()); await unknown.get(); await unknown.get(); assert.equal(count, 3);
});

test('TURN clear prevents a late credential response from repopulating another call/account', async () => {
  let resolve!: (value: any) => void;
  const cache = new IceCredentialCache(() => new Promise((done) => { resolve = done; }));
  const pending = cache.get(); cache.clear(); resolve({ iceServers: [{ urls: 'stun:example.com' }], ttl: 100 });
  await assert.rejects(pending, /invalidated/);
});

test('a never-resolving old consumer cannot pin the queue after foreground recovery', async () => {
  const env = environment(), db = backend(), states: string[] = []; let calls = 0, accepted = 0;
  db.rows = [row('a')];
  const stop = subscribeToRecoveredMessages(db, 'user', 'room', async (_row, delivery) => {
    calls++;
    if (calls === 1) await new Promise(() => {});
    if (delivery.current()) accepted++;
  }, (state) => states.push(state), env as any);
  await env.advance(150); db.created[0].status('SUBSCRIBED'); await flush();
  env.isVisible = false; env.event(); await flush();
  env.isVisible = true; env.event(); await env.advance(1000);
  db.created.at(-1).status('SUBSCRIBED'); await flush();
  assert.equal(accepted, 1); assert.equal(states.at(-1), 'connected'); stop();
});

test('retry backoff grows and caps even when REST works but channel joins keep failing', async () => {
  const env = environment(), db = backend();
  const stop = subscribe(db, env, []);
  await env.advance(150);
  const waits = [1000, 2000, 4000, 8000, 16000, 30000, 30000];
  for (const wait of waits) {
    const count = db.created.length;
    db.created.at(-1).status('CHANNEL_ERROR'); await flush();
    await env.advance(wait - 1); assert.equal(db.created.length, count);
    await env.advance(1); assert.equal(db.created.length, count + 1);
  }
  stop();
});

test('two stalled topics share one SDK transport repair, not competing socket resets', async () => {
  const env = environment(), db = backend();
  const a = subscribe(db, env, []);
  const b = subscribeToRecoveredMessages(db, 'user', undefined, () => {}, undefined, env as any);
  await env.advance(20_150);
  assert.equal(db.socketResets, 1); a(); b();
});

test('a direct account switch invalidates the old stream before React cleanup', async () => {
  const env = environment(), db = backend(), rows: any[] = [], states: string[] = [];
  const stop = subscribe(db, env, rows, states);
  await env.advance(150); const old = db.created[0]; old.status('SUBSCRIBED'); await flush();
  db.authEvent('SIGNED_IN', { user: { id: 'another-user' } });
  old.emit(row('old-account-row')); await flush();
  assert.equal(rows.length, 0); assert.equal(states.at(-1), 'sign-in-required'); stop();
});

test('invalid refresh credentials require sign-in, but a refresh network outage stays retryable', async () => {
  const db = backend(); db.expired = true;
  db.auth.refreshSession = async () => ({ data: { session: null }, error: { code: 'refresh_token_not_found', status: 400 } });
  await assert.rejects(requireRealtimeSession(db, 'user', new AbortController().signal), SessionRequiredError);
  db.auth.refreshSession = async () => ({ data: { session: null }, error: new Error('temporary gateway failure') });
  await assert.rejects(requireRealtimeSession(db, 'user', new AbortController().signal), /temporary gateway/);
});

test('late encryption keys reprocess placeholders without resetting a healthy stream or repeating alerts', async () => {
  const env = environment(), db = backend(), alerts: boolean[] = [], states: string[] = [];
  let keysReady = false;
  const stop = subscribeToRecoveredMessages(db, 'user', 'room', (_row, delivery) => {
    alerts.push(delivery.notify); return keysReady;
  }, (state) => states.push(state), env as any);
  await env.advance(150); db.created[0].status('SUBSCRIBED'); await flush();
  const message = row('waiting-for-key', new Date(env.now()).toISOString());
  db.rows = [message]; db.created[0].emit(message); await flush();
  keysReady = true;
  await env.advance(30_000); await flush();
  assert.deepEqual(alerts, [true, false]);
  await env.advance(30_000); await flush();
  assert.equal(alerts.length, 2); assert.equal(db.created.length, 1);
  assert.equal(states.at(-1), 'connected'); stop();
});

test('inbox REST catch-up scopes messages through existing conversation membership RPC', async () => {
  const env = environment(), db = backend(), seen: any[] = [];
  db.rows = [row('ours'), { ...row('not-ours'), conversation_id: 'other-room' }];
  db.rpc = () => ({ abortSignal: async () => ({ data: [{ conversation_id: 'room' }], error: null }) });
  const stop = subscribeToRecoveredMessages(db, 'user', undefined, (value) => { seen.push(value); }, undefined, env as any);
  await env.advance(150); db.created[0].status('SUBSCRIBED'); await flush();
  assert.deepEqual(seen.map((value) => value.id), ['ours']); stop();
});

test('attaching/reopening a second observer resyncs data without replacing a healthy channel', async () => {
  const env = environment(), db = backend(), first: any[] = [], second: any[] = [];
  db.rows = [row('a')];
  const a = subscribe(db, env, first);
  await env.advance(150); db.created[0].status('SUBSCRIBED'); await flush();
  const b = subscribe(db, env, second); await flush(); await env.advance(1000);
  assert.equal(db.created.length, 1); assert.equal(db.active.size, 1);
  assert.equal(first.length, 1); assert.equal(second.length, 1);
  b(); db.created[0].emit(row('b')); await flush(); assert.equal(first.length, 2);
  a();
});

test('REST outage retries without claiming the joined socket/presence disconnected; live delivery continues', async () => {
  const env = environment(), db = backend(), seen: any[] = [], states: string[] = [];
  const stop = subscribe(db, env, seen, states);
  await env.advance(150); db.created[0].status('SUBSCRIBED'); await flush();
  db.readError = true; await env.advance(30_000);
  assert.equal(states.at(-1), 'syncing'); assert.equal(db.created.length, 1);
  db.created[0].emit(row('live')); await flush(); assert.equal(seen[0].id, 'live');
  db.readError = false; db.rows = [row('missed')]; await env.advance(1000);
  assert.equal(states.at(-1), 'connected'); assert.equal(db.created.length, 1);
  assert.deepEqual(seen.map((value) => value.id).sort(), ['live', 'missed']); stop();
});

test('progressing long backfill renews the stall deadline instead of reporting a false lost connection', async () => {
  const env = environment(), db = backend(), states: string[] = [];
  let progress = () => {}, finish!: () => void;
  const gate = new Promise<void>((resolve) => { finish = resolve; });
  const owner = new RealtimeRecovery({ client: db, userId: 'user', topic: 'long-history', environment: env as any,
    session: async () => {}, build: (channel) => channel,
    reconcile: async (_signal, _current, reportProgress) => { progress = reportProgress; await gate; },
    status: (state) => states.push(state),
  });
  await env.advance(150); db.created[0].status('SUBSCRIBED'); await flush();
  await env.advance(30_000); progress(); await env.advance(31_000);
  assert.equal(db.created.length, 1); assert.equal(states.at(-1), 'syncing');
  finish(); await flush(); assert.equal(states.at(-1), 'connected'); owner.stop();
});

test('live lane is not blocked by a slow history message', async () => {
  const env = environment(), db = backend(); db.rows = [row('slow-history')];
  let finish!: () => void; const gate = new Promise<void>((resolve) => { finish = resolve; });
  const seen: string[] = [];
  const stop = subscribeToRecoveredMessages(db, 'user', 'room', async (value) => {
    if (value.id === 'slow-history') await gate; seen.push(value.id);
  }, undefined, env as any);
  await env.advance(150); db.created[0].status('SUBSCRIBED'); await flush();
  db.created[0].emit(row('new-live')); await flush(); assert.deepEqual(seen, ['new-live']);
  finish(); await flush(); assert.deepEqual(seen, ['new-live', 'slow-history']); stop();
});


test('REST finishing before first JOIN ACK stays connecting, not falsely interrupted', async () => {
  const env = environment(), db = backend(), states: string[] = [];
  const stop = subscribe(db, env, [], states);
  await env.advance(150); await flush();
  assert.equal(states.at(-1), 'connecting'); assert(!states.includes('reconnecting'));
  db.created[0].status('SUBSCRIBED'); await flush();
  assert.equal(states.at(-1), 'connected'); stop();
});
