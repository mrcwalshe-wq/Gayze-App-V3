/**
 * GAYZE — send-push Edge Function.
 *
 * The only place in the system that holds the VAPID private key. It is read
 * from Edge Function secrets and never returned, logged or exposed.
 *
 * Three authenticated entry points:
 *
 *   1. Trigger dispatch (server -> server)
 *      Header: x-gayze-dispatch-secret: <PUSH_DISPATCH_SECRET>
 *      Body:   { event: 'message' | 'intent' | 'intent_expiring'
 *                       | 'safety', ... }
 *      Called by public.request_push_dispatch() via pg_net.
 *
 *   2. Test push (authenticated user -> their own devices only)
 *      Header: Authorization: Bearer <user access token>
 *      Body:   { action: 'test' }
 *      A user can ONLY ever target themselves here; the target is taken from
 *      the verified JWT, never from the request body.
 *
 *   3. Connection push (authenticated user -> the OTHER member of a direct
 *      conversation that their own `submit_interest` call just made mutual)
 *      Header: Authorization: Bearer <user access token>
 *      Body:   { action: 'connection', conversationId }
 *      The recipient is never taken from the request body: it is derived
 *      server-side from `conversation_members`, the caller must be one of
 *      exactly two members, and delivery is claimed once per conversation
 *      ('connection', conversationId) in notification_dispatch_log, whichever
 *      member calls.
 *
 * Required secrets:
 *   VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY, VAPID_SUBJECT,
 *   PUSH_DISPATCH_SECRET, SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY
 */

import { createClient, type SupabaseClient } from 'npm:@supabase/supabase-js@2';
import webpush from 'npm:web-push@3.6.7';

type Category = 'message' | 'intent' | 'intent_expiring' | 'connection' | 'safety' | 'test';

interface NotificationPayload {
  type: Category;
  title: string;
  body: string;
  url: string;
  conversationId?: string | null;
  intentId?: string | null;
  tag?: string;
}

interface SubscriptionRow {
  id: string;
  endpoint: string;
  p256dh: string;
  auth: string;
}

const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? '';
const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
const VAPID_PUBLIC_KEY = Deno.env.get('VAPID_PUBLIC_KEY') ?? '';
const VAPID_PRIVATE_KEY = Deno.env.get('VAPID_PRIVATE_KEY') ?? '';
const VAPID_SUBJECT = Deno.env.get('VAPID_SUBJECT') ?? 'mailto:support@gayze.co.uk';
const DISPATCH_SECRET = Deno.env.get('PUSH_DISPATCH_SECRET') ?? '';

if (VAPID_PUBLIC_KEY && VAPID_PRIVATE_KEY) {
  webpush.setVapidDetails(VAPID_SUBJECT, VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY);
}

const admin: SupabaseClient = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });

/** Constant-time-ish comparison for the shared dispatch secret. */
function secretMatches(provided: string | null): boolean {
  if (!DISPATCH_SECRET || !provided) return false;
  if (provided.length !== DISPATCH_SECRET.length) return false;
  let diff = 0;
  for (let i = 0; i < provided.length; i += 1) {
    diff |= provided.charCodeAt(i) ^ DISPATCH_SECRET.charCodeAt(i);
  }
  return diff === 0;
}

/** Server-side preference gate. The UI filter is never trusted on its own. */
async function categoryEnabled(userId: string, category: Category): Promise<boolean> {
  const { data, error } = await admin.rpc('push_category_enabled', {
    p_user: userId,
    p_category: category,
  });
  if (error) {
    console.warn('[GAYZE] preference lookup failed:', error.message);
    return false;
  }
  return data === true;
}

/**
 * Deliver one payload to every endpoint a user owns.
 * Endpoints the push service reports as gone (404/410) are deleted.
 */
async function deliver(userId: string, payload: NotificationPayload): Promise<number> {
  if (!VAPID_PRIVATE_KEY) {
    console.error('[GAYZE] VAPID_PRIVATE_KEY is not configured');
    return 0;
  }

  const { data: subscriptions, error } = await admin
    .from('push_subscriptions')
    .select('id,endpoint,p256dh,auth')
    .eq('user_id', userId);

  if (error) {
    console.warn('[GAYZE] subscription lookup failed:', error.message);
    return 0;
  }
  if (!subscriptions?.length) return 0;

  const serialised = JSON.stringify(payload);
  const stale: string[] = [];
  let delivered = 0;

  await Promise.all(
    (subscriptions as SubscriptionRow[]).map(async (sub) => {
      try {
        await webpush.sendNotification(
          { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
          serialised,
          { TTL: 60 * 60 * 24, urgency: payload.type === 'safety' ? 'high' : 'normal' },
        );
        delivered += 1;
      } catch (err) {
        const status = (err as { statusCode?: number }).statusCode;
        if (status === 404 || status === 410) {
          // The browser dropped this subscription — clean it up.
          stale.push(sub.id);
        } else {
          console.warn('[GAYZE] push send failed:', status, (err as Error).message);
        }
      }
    }),
  );

  if (stale.length) {
    await admin.from('push_subscriptions').delete().in('id', stale);
  }
  if (delivered > 0) {
    await admin
      .from('push_subscriptions')
      .update({ last_used_at: new Date().toISOString() })
      .eq('user_id', userId);
  }

  return delivered;
}

/** Send to a user, honouring their category preference. */
async function notify(userId: string, payload: NotificationPayload): Promise<number> {
  if (!(await categoryEnabled(userId, payload.type))) return 0;
  return deliver(userId, payload);
}

// ---------------------------------------------------------------------------
// Event handlers
// ---------------------------------------------------------------------------

/**
 * Claim a one-time dispatch slot. Returns true only for the caller that
 * inserted the ledger row; any retry / duplicate gets false (unique_violation).
 * On any other error we return false: better to miss a push than to spam.
 */
async function claimDispatch(userId: string, category: Category, dedupeKey: string): Promise<boolean> {
  const { error } = await admin
    .from('notification_dispatch_log')
    .insert({ user_id: userId, category, dedupe_key: dedupeKey });
  if (!error) return true;
  if ((error as { code?: string }).code !== '23505') {
    console.warn('[GAYZE] dispatch claim failed:', error.message);
  }
  return false;
}

/**
 * Mutual-interest push. `callerId` is the verified JWT subject of the user whose
 * `submit_interest` call returned mutual; the recipient is the other member.
 */
async function handleConnectionAction(callerId: string, conversationIdRaw: unknown): Promise<{ delivered: number; reason?: string }> {
  const conversationId = typeof conversationIdRaw === 'string' ? conversationIdRaw : '';
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(conversationId)) {
    return { delivered: 0, reason: 'invalid_conversation' };
  }

  const { data: members, error } = await admin
    .from('conversation_members')
    .select('user_id')
    .eq('conversation_id', conversationId);
  if (error) {
    console.warn('[GAYZE] connection member lookup failed:', error.message);
    return { delivered: 0, reason: 'lookup_failed' };
  }

  const ids = (members ?? []).map((m) => (m as { user_id: string }).user_id);
  // Only a direct (two-person) conversation the caller belongs to can be a
  // "connection". Anything else is rejected without revealing why.
  if (ids.length !== 2 || !ids.includes(callerId)) return { delivered: 0, reason: 'not_a_direct_member' };

  const peerId = ids.find((id) => id !== callerId);
  if (!peerId) return { delivered: 0, reason: 'not_a_direct_member' };

  // Exactly once per CONVERSATION, however many times and from whichever side
  // this is called (e.g. the other user later re-sends interest and the RPC
  // reports the same mutual conversation again). The ledger key is therefore
  // anchored to a canonical member (the lexicographically smaller user id) rather
  // than to the recipient, so both sides contend for the same single slot.
  const claimOwner = ids.slice().sort()[0];
  if (!(await claimDispatch(claimOwner, 'connection', conversationId))) {
    return { delivered: 0, reason: 'already_sent' };
  }

  const delivered = await notify(peerId, {
    type: 'connection',
    title: 'New connection',
    // No names, no intent details.
    body: 'You and someone nearby are both interested.',
    url: `/messages/${conversationId}`,
    conversationId,
    tag: `gayze-connection-${conversationId}`,
  });
  return { delivered };
}

async function handleMessageEvent(body: Record<string, unknown>): Promise<number> {
  const conversationId = String(body.conversationId ?? '');
  const senderId = String(body.senderId ?? '');
  const senderName = String(body.senderName ?? 'Someone').slice(0, 40);
  if (!conversationId || !senderId) return 0;

  const { data: members, error } = await admin
    .from('conversation_members')
    .select('user_id')
    .eq('conversation_id', conversationId)
    .neq('user_id', senderId);

  if (error) {
    console.warn('[GAYZE] member lookup failed:', error.message);
    return 0;
  }

  let sent = 0;
  for (const member of members ?? []) {
    const userId = (member as { user_id: string }).user_id;
    sent += await notify(userId, {
      type: 'message',
      title: 'New message',
      // Message bodies are end-to-end encrypted — the server cannot read them
      // and must never attempt to include content.
      body: `${senderName} sent you a message`,
      url: `/messages/${conversationId}`,
      conversationId,
      tag: `gayze-message-${conversationId}`,
    });
  }
  return sent;
}

// NOTE: no database trigger currently produces the 'intent' event (the interests
// schema and submit_interest body are not in this repository). The handler is
// kept so a verified producer can be wired later without changing this contract.
async function handleIntentEvent(body: Record<string, unknown>): Promise<number> {
  const toUserId = String(body.toUserId ?? '');
  const intentId = body.intentId ? String(body.intentId) : null;
  if (!toUserId) return 0;

  return notify(toUserId, {
    type: 'intent',
    title: 'Someone is interested',
    // Deliberately does not name the sender or describe the intent.
    body: 'Someone responded to your active intent.',
    url: '/right-now',
    intentId,
    tag: `gayze-intent-${intentId ?? 'general'}`,
  });
}

async function handleIntentExpiringEvent(body: Record<string, unknown>): Promise<number> {
  const toUserId = String(body.toUserId ?? '');
  const intentId = body.intentId ? String(body.intentId) : null;
  if (!toUserId) return 0;

  return notify(toUserId, {
    type: 'intent_expiring',
    title: 'Your intent is ending soon',
    body: 'Your active intent expires shortly. Extend it to stay visible.',
    url: '/profile',
    intentId,
    tag: `gayze-intent-expiring-${intentId ?? 'general'}`,
  });
}

async function handleSafetyEvent(body: Record<string, unknown>): Promise<number> {
  const toUserId = String(body.toUserId ?? '');
  if (!toUserId) return 0;

  const message = typeof body.message === 'string' ? body.message.slice(0, 120) : null;

  return notify(toUserId, {
    type: 'safety',
    title: 'Gayze safety alert',
    body: message ?? 'A safety check-in needs your attention.',
    url: '/profile',
    tag: 'gayze-safety',
  });
}

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------

Deno.serve(async (req) => {
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405);

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return json({ error: 'Invalid JSON body' }, 400);
  }

  // --- Path 1: authenticated user actions (verified JWT; target never from body)
  const authHeader = req.headers.get('Authorization');
  if (body.action === 'test' || body.action === 'connection') {
    if (!authHeader?.startsWith('Bearer ')) return json({ error: 'Authentication required' }, 401);

    const token = authHeader.slice('Bearer '.length);
    const { data: userData, error: userError } = await admin.auth.getUser(token);
    if (userError || !userData?.user) return json({ error: 'Invalid session' }, 401);

    if (body.action === 'connection') {
      const result = await handleConnectionAction(userData.user.id, body.conversationId);
      return json({ ok: true, ...result });
    }

    // The target is the verified JWT subject — a caller cannot push to anyone else.
    const sent = await deliver(userData.user.id, {
      type: 'test',
      title: 'Gayze notifications are working',
      body: 'Your Gayze push notifications are now enabled.',
      url: '/profile',
      tag: 'gayze-test',
    });

    return json({ ok: true, delivered: sent });
  }

  // --- Path 2: internal trigger dispatch
  if (!secretMatches(req.headers.get('x-gayze-dispatch-secret'))) {
    return json({ error: 'Forbidden' }, 403);
  }

  const event = String(body.event ?? '');
  let delivered = 0;

  switch (event) {
    case 'message':
      delivered = await handleMessageEvent(body);
      break;
    case 'intent':
      delivered = await handleIntentEvent(body);
      break;
    case 'intent_expiring':
      delivered = await handleIntentExpiringEvent(body);
      break;
    case 'safety':
      delivered = await handleSafetyEvent(body);
      break;
    default:
      return json({ error: `Unknown event: ${event}` }, 400);
  }

  return json({ ok: true, delivered });
});
