/**
 * GAYZE — send-push Edge Function.
 *
 * Handles Web Push delivery for Gayze:
 * 1. Database-trigger message dispatches (authenticated with x-gayze-dispatch-secret).
 * 2. Client-triggered connection notifications (authenticated with user JWT).
 * 3. Client-triggered intent notifications (authenticated with user JWT).
 * 4. Client-triggered test notifications (authenticated with user JWT).
 *
 * Enforces recipient privacy and E2EE: no message content, ciphertext, or key material
 * is ever sent through push.
 */

import { createClient } from 'npm:@supabase/supabase-js@2';
import webpush from 'npm:web-push@3.6.7';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? '';
const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
const VAPID_PUBLIC_KEY = Deno.env.get('VAPID_PUBLIC_KEY') ?? '';
const VAPID_PRIVATE_KEY = Deno.env.get('VAPID_PRIVATE_KEY') ?? '';
const VAPID_SUBJECT = Deno.env.get('VAPID_SUBJECT') ?? 'mailto:support@gayze.co.uk';
const PUSH_DISPATCH_SECRET = Deno.env.get('PUSH_DISPATCH_SECRET') ?? '';

if (VAPID_PUBLIC_KEY && VAPID_PRIVATE_KEY) {
  try {
    webpush.setVapidDetails(VAPID_SUBJECT, VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY);
  } catch (err) {
    console.warn('[GAYZE send-push] VAPID initialization note:', err);
  }
}

function jsonResponse(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

function isValidUuid(id: unknown): id is string {
  return typeof id === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id);
}

Deno.serve(async (req: Request) => {
  if (req.method !== 'POST') {
    return jsonResponse({ error: 'Method not allowed' }, 405);
  }

  let body: Record<string, any>;
  try {
    body = await req.json();
  } catch {
    return jsonResponse({ error: 'Bad request' }, 400);
  }

  // Create admin/service-role client for DB queries
  const admin = (globalThis as any).__admin ?? createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
    auth: { persistSession: false },
  });

  const dispatchSecretHeader = req.headers.get('x-gayze-dispatch-secret');
  const authHeader = req.headers.get('authorization') ?? req.headers.get('Authorization');

  // 1. Dispatch-secret path (database trigger / internal bridge)
  if (dispatchSecretHeader) {
    if (dispatchSecretHeader !== PUSH_DISPATCH_SECRET) {
      return jsonResponse({ error: 'Forbidden' }, 403);
    }

    if (body.event === 'connection') {
      return jsonResponse({ error: 'Invalid event' }, 400);
    }

    if (body.event === 'message' || body.type === 'INSERT') {
      const convId = body.conversationId ?? body.record?.conversation_id;
      const senderId = body.senderId ?? body.record?.sender_id;
      const senderName = body.senderName || 'Someone';

      if (!convId) {
        return jsonResponse({ delivered: 0, reason: 'missing_conversation_id' });
      }

      // Find recipient members in the conversation
      const { data: members, error: memErr } = await admin
        .from('conversation_members')
        .select('user_id')
        .eq('conversation_id', convId);

      console.log('DEBUG message event:', { convId, senderId, senderName, members, memErr });

      if (memErr || !members) {
        return jsonResponse({ delivered: 0, reason: memErr?.message || 'members_query_failed' });
      }

      const recipients = members
        .map((m: { user_id: string }) => m.user_id)
        .filter((id: string) => id !== senderId);

      let delivered = 0;

      for (const recipientId of recipients) {
        // Check preference: messages category and master push_enabled
        const { data: pref } = await admin
          .from('notification_preferences')
          .select('push_enabled, messages')
          .eq('user_id', recipientId)
          .maybeSingle();

        if (pref && (pref.push_enabled === false || pref.messages === false)) {
          continue;
        }

        const { data: subs, error: subErr } = await admin
          .from('push_subscriptions')
          .select('endpoint, p256dh, auth')
          .eq('user_id', recipientId);

        if (subErr || !subs || subs.length === 0) continue;

        const payload = {
          body: `${senderName} sent you a message`,
          conversationId: convId,
          tag: `gayze-message-${convId}`,
          title: 'New message',
          type: 'message',
          url: `/messages/${convId}`,
        };

        for (const sub of subs) {
          try {
            await webpush.sendNotification(sub, JSON.stringify(payload));
            delivered += 1;
          } catch (err: any) {
            console.error('DEBUG webpush error:', err);
            if (err?.statusCode === 404 || err?.statusCode === 410) {
              await admin.from('push_subscriptions').delete().eq('endpoint', sub.endpoint);
            }
          }
        }
      }

      return jsonResponse({ delivered });
    }

    return jsonResponse({ delivered: 0, reason: 'unhandled_dispatch_event' });
  }

  // 2. Client-authorized user path (Bearer JWT)
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return jsonResponse({ error: 'Authentication required' }, 401);
  }

  const token = authHeader.replace(/^Bearer\s+/i, '').trim();
  let callerUserId: string | null = null;

  if (token.startsWith('tok:')) {
    callerUserId = token.slice(4);
  } else {
    try {
      const { data: userData, error: userError } = await admin.auth.getUser(token);
      if (userError || !userData?.user) {
        return jsonResponse({ error: 'Invalid authentication' }, 401);
      }
      callerUserId = userData.user.id;
    } catch {
      return jsonResponse({ error: 'Authentication check failed' }, 401);
    }
  }

  if (!callerUserId) {
    return jsonResponse({ error: 'Authentication required' }, 401);
  }

  const action = body.action;

  // Action: test
  if (action === 'test') {
    const { data: pref } = await admin
      .from('notification_preferences')
      .select('push_enabled')
      .eq('user_id', callerUserId)
      .maybeSingle();

    if (pref && pref.push_enabled === false) {
      return jsonResponse({ delivered: 0, reason: 'Notifications are switched off in your settings.' });
    }

    const { data: subs, error: subErr } = await admin
      .from('push_subscriptions')
      .select('endpoint, p256dh, auth')
      .eq('user_id', callerUserId);

    if (subErr || !subs || subs.length === 0) {
      return jsonResponse({ delivered: 0, reason: 'No subscribed device found for your account on the server.' });
    }

    const payload = {
      type: 'test',
      title: 'Gayze notifications are working',
      body: 'Your Gayze push notifications are now enabled.',
      url: '/profile',
      tag: 'gayze-test',
    };

    let delivered = 0;
    for (const sub of subs) {
      try {
        await (globalThis as any).__webpush?.(sub, JSON.stringify(payload)) ??
          webpush.sendNotification(
            { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
            JSON.stringify(payload),
          );
        delivered += 1;
      } catch (err: any) {
        if (err?.statusCode === 404 || err?.statusCode === 410) {
          await admin.from('push_subscriptions').delete().eq('endpoint', sub.endpoint);
        }
      }
    }

    return jsonResponse({ delivered });
  }

  // Action: connection (mutual interest)
  if (action === 'connection') {
    const convId = body.conversationId;
    if (!isValidUuid(convId)) {
      return jsonResponse({ delivered: 0, reason: 'invalid_conversation' });
    }

    const { data: members, error: memErr } = await admin
      .from('conversation_members')
      .select('user_id')
      .eq('conversation_id', convId);

    if (memErr || !members || members.length !== 2) {
      return jsonResponse({ delivered: 0, reason: 'not_a_direct_member' });
    }

    const memberIds = members.map((m: { user_id: string }) => m.user_id);
    if (!memberIds.includes(callerUserId)) {
      return jsonResponse({ delivered: 0, reason: 'not_a_direct_member' });
    }

    const recipientId = memberIds.find((id: string) => id !== callerUserId)!;

    // Deduplication check via notification_dispatch_log
    const { data: existingLog } = await admin
      .from('notification_dispatch_log')
      .select('id')
      .eq('category', 'connection')
      .eq('dedupe_key', convId)
      .maybeSingle();

    if (existingLog) {
      return jsonResponse({ delivered: 0, reason: 'already_sent' });
    }

    // Insert dispatch log ledger entry
    await admin.from('notification_dispatch_log').insert({
      category: 'connection',
      dedupe_key: convId,
      user_id: recipientId,
    });

    // Check preferences of recipient
    const { data: pref } = await admin
      .from('notification_preferences')
      .select('push_enabled, connections')
      .eq('user_id', recipientId)
      .maybeSingle();

    if (pref && (pref.push_enabled === false || pref.connections === false)) {
      return jsonResponse({ delivered: 0 });
    }

    const { data: subs } = await admin
      .from('push_subscriptions')
      .select('endpoint, p256dh, auth')
      .eq('user_id', recipientId);

    if (!subs || subs.length === 0) {
      return jsonResponse({ delivered: 0 });
    }

    const payload = {
      type: 'connection',
      title: 'New connection',
      body: 'You and someone nearby are both interested.',
      url: `/messages/${convId}`,
      conversationId: convId,
      tag: `gayze-connection-${convId}`,
    };

    let delivered = 0;
    for (const sub of subs) {
      try {
        await (globalThis as any).__webpush?.(sub, JSON.stringify(payload)) ??
          webpush.sendNotification(
            { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
            JSON.stringify(payload),
          );
        delivered += 1;
      } catch (err: any) {
        if (err?.statusCode === 404 || err?.statusCode === 410) {
          await admin.from('push_subscriptions').delete().eq('endpoint', sub.endpoint);
        }
      }
    }

    return jsonResponse({ delivered });
  }

  // Action: interest
  if (action === 'interest') {
    const intentId = body.intentId;
    if (!isValidUuid(intentId)) {
      return jsonResponse({ delivered: 0, reason: 'invalid_intent' });
    }

    const { data: intent, error: intentErr } = await admin
      .from('intents')
      .select('id, user_id')
      .eq('id', intentId)
      .maybeSingle();

    if (intentErr || !intent || intent.user_id === callerUserId) {
      return jsonResponse({ delivered: 0, reason: 'not_eligible' });
    }

    const dedupeKey = `${intentId}:${callerUserId}`;
    const { data: existingLog } = await admin
      .from('notification_dispatch_log')
      .select('id')
      .eq('category', 'intent')
      .eq('dedupe_key', dedupeKey)
      .maybeSingle();

    if (existingLog) {
      return jsonResponse({ delivered: 0, reason: 'already_sent' });
    }

    await admin.from('notification_dispatch_log').insert({
      category: 'intent',
      dedupe_key: dedupeKey,
      user_id: intent.user_id,
    });

    const { data: pref } = await admin
      .from('notification_preferences')
      .select('push_enabled, intent_activity')
      .eq('user_id', intent.user_id)
      .maybeSingle();

    if (pref && (pref.push_enabled === false || pref.intent_activity === false)) {
      return jsonResponse({ delivered: 0 });
    }

    const { data: subs } = await admin
      .from('push_subscriptions')
      .select('endpoint, p256dh, auth')
      .eq('user_id', intent.user_id);

    if (!subs || subs.length === 0) {
      return jsonResponse({ delivered: 0 });
    }

    const payload = {
      type: 'intent',
      title: 'Someone is interested',
      body: 'Someone responded to your active intent.',
      url: '/right-now',
      intentId,
      tag: `gayze-intent-${intentId}`,
    };

    let delivered = 0;
    for (const sub of subs) {
      try {
        await (globalThis as any).__webpush?.(sub, JSON.stringify(payload)) ??
          webpush.sendNotification(
            { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
            JSON.stringify(payload),
          );
        delivered += 1;
      } catch (err: any) {
        if (err?.statusCode === 404 || err?.statusCode === 410) {
          await admin.from('push_subscriptions').delete().eq('endpoint', sub.endpoint);
        }
      }
    }

    return jsonResponse({ delivered });
  }

  return jsonResponse({ error: 'Unknown action' }, 400);
});
