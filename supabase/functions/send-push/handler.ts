// Portable, dependency-injected handler. No provider credentials or content from
// a client payload are trusted. index.ts supplies the real Supabase/Web Push adapters.
export interface Notice { id: string; user_id: string; category: string; event_key?: string; url: string; read_at: string | null; created_at: string; }
export interface Subscription { id: string; user_id: string; endpoint: string; p256dh: string; auth: string; }
export interface PushStore {
  user(token: string): Promise<{ id: string; app_metadata?: Record<string, unknown> } | null>;
  notice(id: string): Promise<Notice | null>;
  eligible(id: string): Promise<boolean>;
  preferences(user: string): Promise<Record<string, boolean> | null>;
  subscriptions(user: string): Promise<Subscription[]>;
  claim(id: string, subscription: string, endpoint: string): Promise<boolean>;
  finish(id: string, endpoint: string, state: string, status?: number): Promise<void>;
  prune(subscription: Subscription): Promise<void>;
  complete(id: string): Promise<void>;
  unread(user: string): Promise<number>;
  test(user: string, key: string): Promise<string>;
  connection(token: string, conversation: string): Promise<string>;
}
export interface PushConfig { dispatchSecret?: string; origins: string[]; configured: boolean; }
export type PushTransport = (subscription: Subscription, payload: Record<string, unknown>) => Promise<number | void>;
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const categories: Record<string, string> = { message: 'messages', gaze: 'intent_activity', connection: 'connections', intent_expiring: 'intent_expiry', safety: 'safety', test: 'push_enabled' };
const copy: Record<string, [string, string]> = {
  message: ['New message', 'You have a new GAYZE message.'],
  gaze: ['New Gayze', 'Someone sent you a Gayze.'],
  connection: ['New connection', 'You have a new GAYZE connection.'],
  intent_expiring: ['Your intent is ending soon', 'Review your active intent in GAYZE.'],
  safety: ['Safety check-in', 'Your safety check-in has ended. Confirm you are safe.'],
  test: ['GAYZE notifications', 'Your test notification is ready.'],
};
export function allowedEndpoint(endpoint: string): boolean {
  try {
    const u = new URL(endpoint);
    return u.protocol === 'https:' && !u.username && !u.password && !u.port && !u.hash &&
      (u.hostname === 'fcm.googleapis.com' || u.hostname === 'updates.push.services.mozilla.com' ||
       u.hostname.endsWith('.push.apple.com') || u.hostname.endsWith('.notify.windows.com'));
  } catch { return false; }
}
export async function validSubscriptionKeys(subscription: Subscription): Promise<boolean> {
  try {
    const decode = (value: string) => Uint8Array.from(atob(value.replace(/-/g, '+').replace(/_/g, '/')), (char) => char.charCodeAt(0));
    const key = decode(subscription.p256dh), auth = decode(subscription.auth);
    if (key.length !== 65 || key[0] !== 4 || auth.length !== 16) return false;
    await crypto.subtle.importKey('raw', key, { name: 'ECDH', namedCurve: 'P-256' }, false, []);
    return true;
  } catch { return false; }
}
async function equalSecret(a: string, b: string): Promise<boolean> {
  if (a.length > 512 || !a || !b) return false;
  const digest = (s: string) => crypto.subtle.digest('SHA-256', new TextEncoder().encode(s));
  const [x, y] = await Promise.all([digest(a), digest(b)]);
  const aa = new Uint8Array(x), bb = new Uint8Array(y);
  let diff = 0; for (let i = 0; i < aa.length; i++) diff |= aa[i] ^ bb[i];
  return diff === 0;
}
async function body(request: Request): Promise<Record<string, unknown>> {
  const reader = request.body?.getReader();
  if (!reader) throw new Error('body');
  const chunks: Uint8Array[] = []; let bytes = 0;
  for (;;) {
    const part = await reader.read(); if (part.done) break;
    bytes += part.value.length;
    if (bytes > 8192) { await reader.cancel(); throw new Error('body'); }
    chunks.push(part.value);
  }
  const joined = new Uint8Array(bytes); let offset = 0;
  for (const chunk of chunks) { joined.set(chunk, offset); offset += chunk.length; }
  const value = JSON.parse(new TextDecoder().decode(joined));
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('body');
  return value;
}
export function createPushHandler(store: PushStore, transport: PushTransport, config: PushConfig) {
  return async (request: Request): Promise<Response> => {
    const origin = request.headers.get('origin');
    const headers: Record<string, string> = { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', Vary: 'Origin' };
    if (origin && config.origins.includes(origin)) headers['Access-Control-Allow-Origin'] = origin;
    const respond = (status: number, value: unknown) => new Response(JSON.stringify(value), { status, headers });
    if (origin && !config.origins.includes(origin)) return respond(403, { error: 'Origin not allowed' });
    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: { ...headers,
      'Access-Control-Allow-Methods': 'POST, OPTIONS', 'Access-Control-Allow-Headers': 'authorization, apikey, content-type, x-client-info' } });
    if (request.method !== 'POST') return respond(405, { error: 'POST required' });
    try {
      const trusted = await equalSecret(request.headers.get('x-gayze-dispatch-secret') ?? '', config.dispatchSecret ?? '');
      const token = request.headers.get('authorization')?.match(/^Bearer (\S+)$/i)?.[1];
      const user = !trusted && token ? await store.user(token) : null;
      if (!trusted && !user) return respond(401, { error: 'Authentication required' });
      let input: Record<string, unknown>;
      try { input = await body(request); } catch { return respond(400, { error: 'Invalid request body' }); }
      let id: string;
      if (!trusted && input.action === 'test') {
        if (user?.app_metadata?.role !== 'admin') return respond(403, { error: 'Operator role required' });
        id = await store.test(user.id, String(Math.floor(Date.now() / 60_000)));
      } else if (!trusted && input.action === 'connection') {
        if (typeof input.conversationId !== 'string' || !uuid.test(input.conversationId)) return respond(400, { error: 'Invalid conversation' });
        id = await store.connection(token!, input.conversationId);
      } else {
        if (typeof input.notificationId !== 'string' || !uuid.test(input.notificationId)) return respond(400, { error: 'Notification ID required' });
        id = input.notificationId;
      }
      const notice = await store.notice(id);
      if (!notice) return respond(404, { error: 'Notification unavailable' });
      if (!trusted && input.action !== 'connection' && notice.user_id !== user!.id) return respond(403, { error: 'Not your notification' });
      if (!copy[notice.category]) return respond(400, { error: 'Unsupported category' });
      if (notice.read_at || !await store.eligible(id) || Date.parse(notice.created_at) < Date.now() - 86400_000) {
        await store.complete(id); return respond(200, { delivered: 0, skipped: 'read-or-old' });
      }
      const prefs = await store.preferences(notice.user_id);
      if (prefs?.push_enabled === false || prefs?.[categories[notice.category]] === false) {
        await store.complete(id); return respond(200, { delivered: 0, skipped: 'preferences' });
      }
      if (!config.configured) return respond(503, { error: 'Web Push server configuration missing' });
      const subscriptions = await store.subscriptions(notice.user_id);
      const count = await store.unread(notice.user_id);
      const [title, text] = copy[notice.category];
      const path = /^\/(notifications|profile|messages\/[0-9a-f-]{36})$/.test(notice.url) ? notice.url : '/notifications';
      const isMessageLike = ['message', 'connection'].includes(notice.category) && path.startsWith('/messages/');
      const conversationId = isMessageLike ? path.slice('/messages/'.length) : undefined;
      const routeUrl = conversationId
        ? `/messages/${conversationId}?notification=${id}&recipient=${notice.user_id}`
        : `${path}?notification=${id}&recipient=${notice.user_id}`;
      const payload = { type: notice.category, title, body: text, notificationId: id,
        recipientId: notice.user_id,
        messageId: notice.category === 'message' && uuid.test(notice.event_key ?? '') ? notice.event_key : undefined,
        // The click URL additionally carries the recipient binding, so cold
        // launches after an account switch cannot open another user's route.
        conversationId,
        url: routeUrl, tag: `gayze-${id}`, badgeCount: count, renotify: false };
      let delivered = 0;
      for (const subscription of subscriptions) {
        if (subscription.user_id !== notice.user_id) continue;
        if (!await store.claim(id, subscription.id, subscription.endpoint)) continue;
        if (!allowedEndpoint(subscription.endpoint) || !await validSubscriptionKeys(subscription)) {
          await store.finish(id, subscription.endpoint, 'invalid'); await store.prune(subscription); continue;
        }
        let acceptedStatus: number | undefined;
        try {
          acceptedStatus = (await transport(subscription, payload)) ?? undefined;
        } catch (error) {
          const status = Number((error as { statusCode?: number })?.statusCode) || undefined;
          const expired = status === 404 || status === 410;
          await store.finish(id, subscription.endpoint, expired ? 'expired' : status ? 'failed' : 'unknown', status);
          if (expired) await store.prune(subscription);
          continue;
        }
        await store.finish(id, subscription.endpoint, 'accepted', acceptedStatus); delivered++;
      }
      await store.complete(id);
      return respond(200, { delivered });
    } catch {
      return respond(500, { error: 'Notification processing failed' });
    }
  };
}
