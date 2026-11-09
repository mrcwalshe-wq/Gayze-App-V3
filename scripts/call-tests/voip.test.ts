import test from 'node:test';
import assert from 'node:assert/strict';
import { generateKeyPairSync, verify } from 'node:crypto';
import { apnsJwt, pemToPkcs8, sendVoipPush, voipPayload } from '../../supabase/functions/send-push/voip.ts';

const { privateKey, publicKey } = generateKeyPairSync('ec', { namedCurve: 'P-256' });
const pem = privateKey.export({ type: 'pkcs8', format: 'pem' }) as string;
const call = { callId: 'c1', callerId: 'u1', callerName: 'Chris', callType: 'video' as const, conversationId: 'k1', startedAtMs: 123 };
const cfg = { keyPem: pem, keyId: 'KEYID12345', teamId: 'TEAMID1234', topic: 'com.gayze.app.voip' };

test('apns jwt is a valid ES256 token with the key and team ids', async () => {
  const jwt = await apnsJwt(pem, 'KEYID12345', 'TEAMID1234', 1000);
  const [h, c, s] = jwt.split('.');
  assert.deepEqual(JSON.parse(Buffer.from(h, 'base64url').toString()), { alg: 'ES256', kid: 'KEYID12345', typ: 'JWT' });
  assert.deepEqual(JSON.parse(Buffer.from(c, 'base64url').toString()), { iss: 'TEAMID1234', iat: 1000 });
  assert.ok(verify('sha256', Buffer.from(`${h}.${c}`), { key: publicKey, dsaEncoding: 'ieee-p1363' }, Buffer.from(s, 'base64url')));
});

test('a key stored with literal \\n sequences still loads', () => {
  assert.ok(pemToPkcs8(pem.replace(/\n/g, '\\n')).length > 30);
});

test('push goes to the right host with the voip headers and the call payload', async () => {
  const seen: { url: string; headers: Record<string, string>; body: string }[] = [];
  const f = (async (url: string, init: RequestInit) => { seen.push({ url, headers: init.headers as Record<string, string>, body: String(init.body) }); return new Response('', { status: 200 }); }) as unknown as typeof fetch;
  assert.equal(await sendVoipPush(cfg, 'abcd', 'sandbox', call, f), 'sent');
  assert.equal(await sendVoipPush(cfg, 'abcd', 'production', call, f), 'sent');
  assert.equal(seen[0].url, 'https://api.sandbox.push.apple.com/3/device/abcd');
  assert.equal(seen[1].url, 'https://api.push.apple.com/3/device/abcd');
  assert.equal(seen[0].headers['apns-push-type'], 'voip');
  assert.equal(seen[0].headers['apns-topic'], 'com.gayze.app.voip');
  assert.deepEqual(JSON.parse(seen[0].body), voipPayload(call));
});

test('dead tokens are reported so they can be removed; other failures are not', async () => {
  const mk = (status: number, text: string) => (async () => new Response(text, { status })) as unknown as typeof fetch;
  assert.equal(await sendVoipPush(cfg, 't', 'production', call, mk(410, '{"reason":"Unregistered"}')), 'bad_token');
  assert.equal(await sendVoipPush(cfg, 't', 'production', call, mk(400, '{"reason":"BadDeviceToken"}')), 'bad_token');
  assert.equal(await sendVoipPush(cfg, 't', 'production', call, mk(500, '')), 'failed');
});
