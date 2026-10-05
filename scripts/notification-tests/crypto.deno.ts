// Real existing Web Push implementation; generated ephemeral test keys only.
// No network request or production credential is used by these tests.
import webpush from 'npm:web-push@3.6.7';
import ece from 'npm:http_ece@1.2.0';
import { createECDH, randomBytes, createPublicKey, verify } from 'node:crypto';
import assert from 'node:assert/strict';

for (const provider of ['https://fcm.googleapis.com', 'https://web.push.apple.com']) {
Deno.test(`existing Web Push library encrypts and signs audience-bound VAPID for ${provider}`, () => {
  const receiver = createECDH('prime256v1'); receiver.generateKeys();
  const auth = randomBytes(16), vapid = webpush.generateVAPIDKeys();
  const subscription = { endpoint: `${provider}/local-only`, keys: {
    p256dh: receiver.getPublicKey().toString('base64url'), auth: auth.toString('base64url'),
  } };
  const payload = JSON.stringify({ type: 'gaze', notificationId: 'local-test', body: 'Someone sent you a Gayze.', url: '/notifications' });
  const details = webpush.generateRequestDetails(subscription, payload, {
    vapidDetails: { subject: 'mailto:local-test@example.com', publicKey: vapid.publicKey, privateKey: vapid.privateKey }, TTL: 300,
  });
  assert.equal(details.method, 'POST');
  assert.equal(details.headers['Content-Encoding'], 'aes128gcm');
  assert(!details.body.toString().includes('Someone sent you'));
  assert.equal(ece.decrypt(details.body, { version: 'aes128gcm', privateKey: receiver, authSecret: auth }).toString(), payload);
  const jwt = details.headers.Authorization.match(/t=([^,]+)/)[1];
  const [header, claims, signature] = jwt.split('.');
  const decoded = JSON.parse(Buffer.from(claims, 'base64url').toString());
  assert.equal(decoded.aud, provider); assert.equal(decoded.sub, 'mailto:local-test@example.com');
  assert(decoded.exp > Date.now()/1000 && decoded.exp <= Date.now()/1000 + 86400);
  const raw = Buffer.from(vapid.publicKey, 'base64url');
  const key = createPublicKey({ key: { kty: 'EC', crv: 'P-256', x: raw.subarray(1,33).toString('base64url'), y: raw.subarray(33).toString('base64url') }, format: 'jwk' });
  assert(verify('sha256', Buffer.from(`${header}.${claims}`), { key, dsaEncoding: 'ieee-p1363' }, Buffer.from(signature, 'base64url')));
});
}
