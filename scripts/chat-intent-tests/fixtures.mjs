export const user = '00000000-0000-4000-8000-000000000001';
export const peer = '00000000-0000-4000-8000-000000000002';
export const other = '00000000-0000-4000-8000-000000000003';
export const roomId = '10000000-0000-4000-8000-000000000001';
export const otherRoomId = '10000000-0000-4000-8000-000000000002';
export const flush = async () => { for (let n = 0; n < 100; n++) await Promise.resolve(); };
export const room = (id = roomId, peerUserId = peer) => ({ id, type: 'direct', peerUserId, name: 'Alex', peerName: 'Alex', ephemeralTtlSeconds: 0 });
export const intentRow = (now = Date.now(), overrides = {}) => ({ id: 'intent-one', user_id: peer, mode: 'social', intent: 'Coffee',
  is_paused: false, starts_at: new Date(now - 1000).toISOString(), expires_at: new Date(now + 3_600_000).toISOString(), ...overrides });
export function environment() {
  let time = Date.now(), id = 0;
  const timers = new Map(), watchers = new Set();
  const env = {
    isOnline: true, isVisible: true, online: () => env.isOnline, visible: () => env.isVisible, now: () => time, random: () => 0,
    later(fn, ms) { const key = ++id; timers.set(key, { at: time + ms, fn }); return key; }, cancel(key) { timers.delete(key); },
    watch(fn) { watchers.add(fn); return () => watchers.delete(fn); }, event() { for (const fn of watchers) fn(); },
    async advance(ms) {
      const until = time + ms;
      for (;;) {
        await flush();
        const due = [...timers].filter(([, t]) => t.at <= until).sort((a, b) => a[1].at - b[1].at)[0];
        if (!due) break;
        time = due[1].at; timers.delete(due[0]); due[1].fn();
      }
      time = until; await flush();
    }, timers, watchers,
  };
  return env;
}
export function backend() {
  const channels = [], authListeners = new Set();
  const data = {
    rows: [], reads: [], error: null, held: null, sessionUser: user,
    realtime: { async disconnect() {}, connect() {} },
    auth: {
      async getSession() { return { data: { session: data.sessionUser ? { user: { id: data.sessionUser }, expires_at: Date.now() / 1000 + 3600 } : null }, error: null }; },
      onAuthStateChange(fn) { authListeners.add(fn); return { data: { subscription: { unsubscribe() { authListeners.delete(fn); } } } }; },
    },
    authEvent(event, id) { data.sessionUser = id; for (const fn of authListeners) fn(event, id ? { user: { id } } : null); },
    channel(topic) {
      const bindings = [];
      const ch = { topic, closed: false, on(_kind, filter, cb) { bindings.push({ filter, cb }); return ch; },
        subscribe(cb) { ch.status = cb; queueMicrotask(() => { if (!ch.closed) cb('SUBSCRIBED'); }); return ch; },
        emit(payload = {}) { for (const { cb } of bindings) cb(payload); },
        async unsubscribe() { ch.closed = true; ch.status('CLOSED'); return 'ok'; }, teardown() { ch.closed = true; }, bindings };
      channels.push(ch); return ch;
    },
    // The peer's row is NOT readable by table select (intents RLS is owner-only): any direct read is a bug.
    from(table) { throw new Error('Direct table read is not allowed (RLS is owner-only): ' + table); },
    // Models public.get_peer_intent(): live (not paused, not expired by SERVER time) intent of that peer only, newest first.
    rpc(name, args) {
      if (name !== 'get_peer_intent') throw new Error('Unexpected rpc: ' + name);
      const q = { abortSignal() { return q; },
        then(resolve, reject) {
          data.reads.push({ rpc: name, args });
          const nowMs = data.clock ? data.clock() : Date.now();
          const rows = data.rows.filter(r => r.user_id === args.p_peer_id && r.is_paused === false && Date.parse(r.expires_at) > nowMs)
            .sort((a, b) => b.starts_at.localeCompare(a.starts_at) || a.id.localeCompare(b.id));
          const result = { data: rows.slice(0, 1), error: data.error };
          return Promise.resolve(data.held).then(() => result).then(resolve, reject);
        } };
      return q;
    }, channels, authListeners,
  };
  return data;
}
