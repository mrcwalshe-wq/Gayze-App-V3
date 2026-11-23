// Apple VoIP push for incoming calls: the iPhone shows a real phone call even when the app is closed.
// Needs the secrets APNS_KEY_P8 (the .p8 file contents), APNS_KEY_ID and APNS_TEAM_ID. Topic is the bundle id + ".voip".

const b64url = (bytes: Uint8Array | string): string => {
  const raw = typeof bytes === 'string' ? new TextEncoder().encode(bytes) : bytes;
  let s = '';
  for (const b of raw) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
};

export function pemToPkcs8(pem: string): Uint8Array {
  const body = pem.replace(/\\n/g, '\n').replace(/-----(BEGIN|END) PRIVATE KEY-----/g, '').replace(/\s+/g, '');
  const bin = atob(body);
  return Uint8Array.from(bin, (c) => c.charCodeAt(0));
}

/** ES256 provider token that Apple accepts for up to an hour. */
export async function apnsJwt(keyPem: string, keyId: string, teamId: string, nowSeconds = Math.floor(Date.now() / 1000)): Promise<string> {
  const key = await crypto.subtle.importKey('pkcs8', pemToPkcs8(keyPem), { name: 'ECDSA', namedCurve: 'P-256' }, false, ['sign']);
  const head = b64url(JSON.stringify({ alg: 'ES256', kid: keyId, typ: 'JWT' }));
  const claims = b64url(JSON.stringify({ iss: teamId, iat: nowSeconds }));
  const sig = new Uint8Array(await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, key, new TextEncoder().encode(`${head}.${claims}`)));
  return `${head}.${claims}.${b64url(sig)}`;
}

export interface VoipCall { callId: string; callerId: string; callerName: string; callType: 'audio' | 'video'; conversationId: string; startedAtMs: number }

export function voipPayload(call: VoipCall): Record<string, unknown> {
  return { callId: call.callId, callerId: call.callerId, callerName: call.callerName, callType: call.callType, conversationId: call.conversationId, startedAt: call.startedAtMs };
}

export interface ApnsConfig { keyPem: string; keyId: string; teamId: string; topic: string }
export type VoipResult = 'sent' | 'bad_token' | 'failed';

let cached: { jwt: string; at: number; id: string } | null = null;

/**
 * The provider token, shared by every kind of push this function sends. Apple refuses a key that makes a new token more than once
 * every 20 minutes (429 TooManyProviderTokenUpdates), so VoIP and alert pushes must reuse one. `iat` is snapped to a half-hour
 * boundary so separate function instances end up with the same token.
 */
export async function providerJwt(cfg: ApnsConfig, nowMs = Date.now()): Promise<string> {
  const id = `${cfg.keyId}:${cfg.teamId}`;
  const window = 30 * 60;
  const iat = Math.floor(nowMs / 1000 / window) * window;
  if (!cached || cached.id !== id || cached.at !== iat) cached = { jwt: await apnsJwt(cfg.keyPem, cfg.keyId, cfg.teamId, iat), at: iat, id };
  return cached.jwt;
}
/** Apple rejected the provider token (403): build a new one next time. */
export function forgetProviderJwt(): void { cached = null; }

export async function sendVoipPush(cfg: ApnsConfig, token: string, environment: 'sandbox' | 'production', call: VoipCall, fetchImpl: typeof fetch = fetch): Promise<VoipResult> {
  const now = Date.now();
  const jwt = await providerJwt(cfg, now);
  const host = environment === 'sandbox' ? 'api.sandbox.push.apple.com' : 'api.push.apple.com';
  try {
    const res = await fetchImpl(`https://${host}/3/device/${token}`, {
      method: 'POST',
      headers: {
        authorization: `bearer ${jwt}`,
        'apns-push-type': 'voip',
        'apns-topic': cfg.topic,
        'apns-priority': '10',
        'apns-expiration': String(Math.floor(now / 1000) + 30),
        'content-type': 'application/json',
      },
      body: JSON.stringify(voipPayload(call)),
    });
    if (res.status === 200) return 'sent';
    if (res.status === 410 || res.status === 400) {
      const reason = await res.text().catch(() => '');
      if (res.status === 410 || /BadDeviceToken|Unregistered|DeviceTokenNotForTopic/.test(reason)) return 'bad_token';
    }
    if (res.status === 403) forgetProviderJwt();
    return 'failed';
  } catch {
    return 'failed';
  }
}
