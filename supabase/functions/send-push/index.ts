import { createECDH } from 'node:crypto';
import { Buffer } from 'node:buffer';
import { createClient } from '@supabase/supabase-js';
// @deno-types="npm:@types/web-push@3.6.4"
import webpush from 'web-push';
import { createPushHandler, type PushStore } from './handler.ts';
if (Deno.env.get('ECE_KEYLOG') === '1') throw new Error('Push crypto key logging must be disabled');
const url = Deno.env.get('SUPABASE_URL') ?? '';
const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
const publicKey = Deno.env.get('VAPID_PUBLIC_KEY') ?? '';
const privateKey = Deno.env.get('VAPID_PRIVATE_KEY') ?? '';
const subject = Deno.env.get('VAPID_SUBJECT') ?? '';
let vapidConfigured = false;
try { webpush.setVapidDetails(subject, publicKey, privateKey); const key = createECDH('prime256v1'); key.setPrivateKey(Buffer.from(privateKey, 'base64url')); vapidConfigured = key.getPublicKey().equals(Buffer.from(publicKey, 'base64url')); } catch { /* Invalid configuration stays queued, without consuming delivery claims. */ }
const options = { auth: { persistSession: false, autoRefreshToken: false } };
if (!url || !serviceKey) throw new Error('Push backend configuration missing');
const db = createClient(url, serviceKey, options);
function checked<T>(result: { data: T; error: unknown }): T { if (result.error) throw new Error('Notification database operation failed'); return result.data; }
const store: PushStore = {
  async user(token) { const result = await db.auth.getUser(token); return result.error ? null : result.data.user; },
  async notice(id) {
    const notice = checked(await db.from('gayze_notifications').select('id,user_id,actor_id,category,event_key,url,read_at,created_at').eq('id', id).maybeSingle());
    if (!notice?.actor_id) return notice;
    const profile = checked(await db.from('profiles').select('display_name').eq('id', notice.actor_id).maybeSingle());
    return { ...notice, actor_display_name: typeof profile?.display_name === 'string' ? profile.display_name : null };
  },
  async eligible(id) { return checked(await db.rpc('gayze_notification_push_allowed', { p_id: id })) === true; },
  async preferences(user) { return checked(await db.from('notification_preferences').select('push_enabled,messages,intent_activity,connections,intent_expiry,safety').eq('user_id', user).maybeSingle()); },
  async subscriptions(user) { return checked(await db.from('push_subscriptions').select('id,user_id,endpoint,p256dh,auth').eq('user_id', user)) ?? []; },
  async claim(id, subscription) { return checked(await db.rpc('gayze_claim_notification_delivery', { p_id: id, p_subscription: subscription })) === true; },
  async finish(id, endpoint, state, status) { checked(await db.from('gayze_notification_deliveries').update({ state, status_code: status ?? null }).eq('notification_id', id).eq('endpoint', endpoint)); },
  async prune(subscription) { checked(await db.rpc('gayze_prune_push_subscription', { p_id: subscription.id, p_user_id: subscription.user_id, p_endpoint: subscription.endpoint, p_p256dh: subscription.p256dh, p_auth: subscription.auth })); },
  async complete(id) { checked(await db.from('gayze_notifications').update({ push_processed_at: new Date().toISOString() }).eq('id', id)); },
  async unread(user) { const result = await db.from('gayze_notifications').select('id', { count: 'exact', head: true }).eq('user_id', user).is('read_at', null); checked(result); return result.count ?? 0; },
  async test(user, key) { return checked(await db.rpc('gayze_enqueue_notification', { p_user: user, p_actor: null, p_category: 'test', p_key: key, p_url: '/notifications' })); },
  async connection(token, conversation) { const caller = createClient(url, Deno.env.get('SUPABASE_ANON_KEY') ?? '', { ...options, global: { headers: { Authorization: `Bearer ${token}` } } }); return checked(await caller.rpc('gayze_connection_notification', { p_conversation: conversation })); },
};
const handler = createPushHandler(store, async (subscription, payload) => { const result = await webpush.sendNotification({ endpoint: subscription.endpoint, keys: { p256dh: subscription.p256dh, auth: subscription.auth } }, JSON.stringify(payload), { vapidDetails: { subject, publicKey, privateKey }, TTL: 300, timeout: 5000, urgency: payload.type === 'safety' ? 'high' : 'normal', topic: String(payload.notificationId).replaceAll('-', '') }); return result.statusCode; }, { dispatchSecret: Deno.env.get('PUSH_DISPATCH_SECRET'), dispatchSecretProvider: async () => { const result = await db.rpc('gayze_get_push_dispatch_runtime_secret'); return result.data ?? undefined; }, origins: (Deno.env.get('PUSH_ALLOWED_ORIGINS') ?? 'https://gayze.co.uk').split(',').map((origin) => origin.trim()), configured: vapidConfigured });
Deno.serve(handler);
