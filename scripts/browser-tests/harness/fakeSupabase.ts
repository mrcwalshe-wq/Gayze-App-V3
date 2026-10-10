// Test-only stand-in for the Supabase client. Implements exactly the surface that
// webrtcService / realtimeRecovery / callHistoryService call, over a local relay
// (scripts/browser-tests/relay.mjs). Realtime RLS is NOT modelled here; it is
// verified separately against the migration in scripts/call-tests.
type Handler = (envelope: { payload: unknown }) => void;

const relayUrl = (window as unknown as { __RELAY_URL__: string }).__RELAY_URL__;
const userId = new URLSearchParams(location.search).get('u') || '';
const iceServers = JSON.parse(new URLSearchParams(location.search).get('ice') || 'null');

let socket: WebSocket | null = null;
let socketReady: Promise<void> | null = null;
const pendingAcks = new Map<string, (ok: boolean) => void>();
const subscriptions = new Map<string, Set<FakeChannel>>();
let seq = 0;
let relayDown = false;

function connect(): Promise<void> {
  if (socketReady) return socketReady;
  socketReady = new Promise((resolve, reject) => {
    const ws = new WebSocket(`${relayUrl}?u=${encodeURIComponent(userId)}`);
    socket = ws;
    ws.onopen = () => resolve();
    ws.onerror = () => reject(new Error('relay unavailable'));
    ws.onclose = () => { socketReady = null; socket = null; for (const ch of [...new Set([...subscriptions.values()].flatMap((s) => [...s]))]) ch.onSocketLost(); };
    ws.onmessage = (event) => {
      const msg = JSON.parse(String(event.data));
      if (msg.t === 'ack') { pendingAcks.get(msg.id)?.(true); pendingAcks.delete(msg.id); return; }
      if (msg.t === 'subscribed') { for (const ch of subscriptions.get(msg.topic) ?? []) ch.onSubscribed(); return; }
      if (msg.t === 'bc') {
        for (const ch of subscriptions.get(msg.topic) ?? []) ch.deliver(msg.event, msg.payload);
      }
    };
  });
  return socketReady;
}

function send(obj: unknown): boolean {
  if (!socket || socket.readyState !== WebSocket.OPEN || relayDown) return false;
  socket.send(JSON.stringify(obj));
  return true;
}

class FakeChannel {
  state: 'joining' | 'joined' | 'closed' | 'errored' = 'closed';
  private handlers: Array<{ event: string; fn: Handler }> = [];
  private statusCb: ((status: string) => void) | null = null;
  constructor(public topic: string, public options: unknown) {}
  on(_type: string, filter: { event: string }, fn: Handler) { this.handlers.push({ event: filter.event, fn }); return this; }
  subscribe(cb?: (status: string) => void) {
    this.statusCb = cb ?? null;
    this.state = 'joining';
    let set = subscriptions.get(this.topic);
    if (!set) { set = new Set(); subscriptions.set(this.topic, set); }
    set.add(this);
    connect().then(() => send({ t: 'sub', topic: this.topic })).catch(() => { this.state = 'errored'; this.statusCb?.('CHANNEL_ERROR'); });
    return this;
  }
  onSubscribed() { if (this.state === 'joining') { this.state = 'joined'; this.statusCb?.('SUBSCRIBED'); } }
  onSocketLost() { if (this.state === 'joined') { this.state = 'errored'; this.statusCb?.('CHANNEL_ERROR'); } }
  deliver(event: string, payload: unknown) {
    for (const h of this.handlers) if (h.event === event) h.fn({ payload });
  }
  async send(packet: { event: string; payload: unknown }, _opts?: { timeout?: number }): Promise<'ok' | 'timed out' | 'error'> {
    if (this.state !== 'joined') return 'error';
    const id = `m${++seq}`;
    const ack = new Promise<boolean>((resolve) => { pendingAcks.set(id, resolve); setTimeout(() => { if (pendingAcks.delete(id)) resolve(false); }, 5000); });
    if (!send({ t: 'bc', id, topic: this.topic, event: packet.event, payload: packet.payload })) return 'error';
    return (await ack) ? 'ok' : 'timed out';
  }
  async unsubscribe(_ms?: number) {
    subscriptions.get(this.topic)?.delete(this);
    send({ t: 'unsub', topic: this.topic });
    this.state = 'closed';
    return 'ok';
  }
  teardown() { /* no-op */ }
}

const noopQuery = () => {
  const q: Record<string, unknown> = {};
  const chain = () => q;
  for (const m of ['select', 'insert', 'update', 'delete', 'upsert', 'eq', 'neq', 'in', 'order', 'limit', 'gte', 'lte', 'single', 'maybeSingle', 'is']) q[m] = chain;
  q.then = (resolve: (v: unknown) => unknown) => resolve({ data: null, error: { message: 'harness: no database' } });
  return q;
};

export const supabase = {
  channel(topic: string, options?: unknown) { return new FakeChannel(topic, options); },
  async removeChannel(channel: FakeChannel) { return channel.unsubscribe(); },
  auth: {
    async getSession() { return { data: { session: { user: { id: userId }, expires_at: Math.floor(Date.now() / 1000) + 3600 } }, error: null }; },
    async refreshSession() { return { data: { session: null }, error: { message: 'harness' } }; },
    onAuthStateChange() { return { data: { subscription: { unsubscribe() {} } } }; },
  },
  functions: {
    async invoke(_name: string, _opts?: unknown) {
      return { data: { iceServers: iceServers ?? [{ urls: 'stun:stun.l.google.com:19302' }] }, error: null };
    },
  },
  realtime: { connect() {}, async disconnect() {} },
  from() { return noopQuery(); },
};

export const isSupabaseConfigured = true;

// Test controls: break and restore the relay to exercise reconnection paths.
export const relayControl = {
  drop() { relayDown = true; socket?.close(); },
  restore() { relayDown = false; socketReady = null; for (const set of subscriptions.values()) for (const ch of set) if (ch.state === 'errored') ch.subscribe(); },
};
