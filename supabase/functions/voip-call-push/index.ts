// Rings the callee's iPhone as a real phone call (Apple VoIP push -> CallKit) when a call starts ringing.
// Called only by the database trigger, authenticated with the same dispatch secret as send-push.
// Needs the secrets APNS_KEY_P8, APNS_KEY_ID, APNS_TEAM_ID (optional APNS_VOIP_TOPIC, default com.gayze.app.voip).
import { createClient } from 'npm:@supabase/supabase-js@2';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? '';
const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';

const json = (data: unknown, status = 200) => new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json' } });
const isUuid = (id: unknown): id is string => typeof id === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id);

const b64url = (bytes: Uint8Array | string): string => {
  const raw = typeof bytes === 'string' ? new TextEncoder().encode(bytes) : bytes;
  let s = '';
  for (const b of raw) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
};

function pemToPkcs8(pem: string): Uint8Array {
  const body = pem.replace(/\\n/g, '\n').replace(/-----(BEGIN|END) PRIVATE KEY-----/g, '').replace(/\s+/g, '');
  return Uint8Array.from(atob(body), (c) => c.charCodeAt(0));
}

async function apnsJwt(keyPem: string, keyId: string, teamId: string): Promise<string> {
  const key = await crypto.subtle.importKey('pkcs8', pemToPkcs8(keyPem), { name: 'ECDSA', namedCurve: 'P-256' }, false, ['sign']);
  const head = b64url(JSON.stringify({ alg: 'ES256', kid: keyId, typ: 'JWT' }));
  const claims = b64url(JSON.stringify({ iss: teamId, iat: Math.floor(Date.now() / 1000) }));
  const sig = new Uint8Array(await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, key, new TextEncoder().encode(`${head}.${claims}`)));
  return `${head}.${claims}.${b64url(sig)}`;
}

Deno.serve(async (req: Request) => {
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405);
  let body: Record<string, unknown>;
  try { body = await req.json(); } catch { return json({ error: 'Bad request' }, 400); }

  const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, { auth: { persistSession: false } });

  const secretHeader = req.headers.get('x-gayze-dispatch-secret');
  if (!secretHeader) return json({ error: 'Forbidden' }, 403);
  const { data: expected, error: authErr } = await admin.rpc('gayze_get_push_dispatch_runtime_secret');
  if (authErr || typeof expected !== 'string' || expected.length === 0 || secretHeader !== expected) return json({ error: 'Forbidden' }, 403);

  if (!isUuid(body.callSessionId)) return json({ error: 'Invalid call' }, 400);

  const keyPem = Deno.env.get('APNS_KEY_P8') ?? '';
  const keyId = Deno.env.get('APNS_KEY_ID') ?? '';
  const teamId = Deno.env.get('APNS_TEAM_ID') ?? '';
  if (!keyPem || !keyId || !teamId) return json({ delivered: 0, reason: 'apns_not_configured' });
  const topic = Deno.env.get('APNS_VOIP_TOPIC') ?? 'com.gayze.app.voip';

  const { data: session } = await admin.from('call_sessions')
    .select('id, conversation_id, caller_id, callee_id, call_type, status, created_at')
    .eq('id', body.callSessionId).maybeSingle();
  if (!session || session.status !== 'ringing') return json({ delivered: 0, reason: 'call_not_ringing' });
  // Blocked pairs are refused when the call is recorded (start_call_session), so no call row exists for them.

  const [{ data: caller }, { data: tokens }] = await Promise.all([
    admin.from('profiles').select('display_name').eq('id', session.caller_id).maybeSingle(),
    admin.from('voip_tokens').select('token, environment').eq('user_id', session.callee_id),
  ]);
  if (!tokens || tokens.length === 0) return json({ delivered: 0, reason: 'no_voip_tokens' });

  let jwt: string;
  try { jwt = await apnsJwt(keyPem, keyId, teamId); } catch (e) { console.error('[voip-call-push] bad APNs key', String(e)); return json({ delivered: 0, reason: 'bad_apns_key' }); }

  const payload = JSON.stringify({
    callId: session.id, callerId: session.caller_id, callerName: caller?.display_name || 'Gayze member',
    callType: session.call_type, conversationId: session.conversation_id, startedAt: Date.parse(session.created_at) || Date.now(),
  });

  let delivered = 0;
  const results: string[] = [];
  for (const t of tokens) {
    const host = t.environment === 'sandbox' ? 'api.sandbox.push.apple.com' : 'api.push.apple.com';
    try {
      const res = await fetch(`https://${host}/3/device/${t.token}`, {
        method: 'POST',
        headers: {
          authorization: `bearer ${jwt}`,
          'apns-push-type': 'voip',
          'apns-topic': topic,
          'apns-priority': '10',
          'apns-expiration': String(Math.floor(Date.now() / 1000) + 30),
          'content-type': 'application/json',
        },
        body: payload,
      });
      if (res.status === 200) { delivered += 1; results.push('sent'); continue; }
      const reason = await res.text().catch(() => '');
      results.push(`${res.status} ${reason}`.slice(0, 120));
      if (res.status === 410 || (res.status === 400 && /BadDeviceToken|Unregistered|DeviceTokenNotForTopic/.test(reason))) {
        await admin.from('voip_tokens').delete().eq('token', t.token);
      }
    } catch (e) {
      results.push(`error ${String(e)}`.slice(0, 120));
    }
  }
  console.log('[voip-call-push]', JSON.stringify({ callId: session.id, results }));
  return json({ delivered });
});
