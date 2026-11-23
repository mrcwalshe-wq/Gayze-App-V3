/**
 * Apple alert push for ordinary notifications (supabase/functions/send-push/alert.ts), with an injected fetch.
 *   npx tsx --test scripts/push-tests/apns-alert.test.ts
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { generateKeyPairSync } from 'node:crypto';
import { alertForNotice, alertPayload, sendAlertPush } from '../../supabase/functions/send-push/alert.ts';
import { providerJwt, sendVoipPush } from '../../supabase/functions/send-push/voip.ts';

const { privateKey } = generateKeyPairSync('ec', { namedCurve: 'P-256' });
const pem = privateKey.export({ type: 'pkcs8', format: 'pem' }) as string;
const cfg = { keyPem: pem, keyId: 'KEYID12345', teamId: 'TEAMID1234', topic: 'com.gayze.app' };
const ID = '11111111-1111-4111-8111-111111111111';
const USER = '22222222-2222-4222-8222-222222222222';
const CONV = '33333333-3333-4333-8333-333333333333';
const INTEREST = '44444444-4444-4444-8444-444444444444';
const notice = (category: string, event_key: string, url = '/notifications') => ({ id: ID, user_id: USER, category, event_key, url });

function recorder(status = 200, text = '') {
  const seen: { url: string; headers: Record<string, string>; body: any }[] = [];
  const f = (async (url: string, init: RequestInit) => { seen.push({ url, headers: init.headers as Record<string, string>, body: JSON.parse(String(init.body)) }); return new Response(text, { status }); }) as unknown as typeof fetch;
  return { seen, f };
}

test('a received Gayze carries the buttons and the interest id; no name or message text', () => {
  const alert = alertForNotice(notice('gaze', `interest:${INTEREST}:received`), null)!;
  assert.equal(alert.category, 'GAYZE_GAZE');
  assert.equal(alert.data.interestId, INTEREST);
  assert.equal(alert.data.notificationId, ID);
  assert.equal(alert.data.url, `/notifications?notification=${ID}&recipient=${USER}`);
  assert.equal(alert.body, 'Someone sent you a Gayze.');
  assert.deepEqual(Object.keys(alertPayload(alert)).sort(), ['aps', 'interestId', 'notificationId', 'type', 'url']);
});

test('a Gayze with another kind of key gets no buttons, and a declined one says so', () => {
  assert.equal(alertForNotice(notice('gaze', ID), null)!.category, undefined);
  assert.equal(alertForNotice(notice('gaze', `interest:${INTEREST}:declined`), null)!.title, 'Gayze update');
  // A key that only looks like an interest id is not trusted as one.
  assert.equal(alertForNotice(notice('gaze', 'interest:not-a-uuid:received'), null)!.category, undefined);
});

test('a message goes to its chat and groups by chat; generic words only', () => {
  const alert = alertForNotice(notice('message', ID, `/messages/${CONV}`), CONV)!;
  assert.equal(alert.threadId, `m-${CONV}`);
  assert.equal(alert.data.conversationId, CONV);
  assert.equal(alert.data.url, `/messages/${CONV}?notification=${ID}&recipient=${USER}`);
  assert.equal(alert.body, 'Someone sent you a message.');
});

test('calls ring through the VoIP push, so no alert is sent for a call; unknown categories send nothing', () => {
  assert.equal(alertForNotice(notice('call', `${CONV}:audio`), null), null);
  assert.equal(alertForNotice(notice('something_new', 'x'), null), null);
  assert.equal(alertForNotice(notice('missed_call', 'x'), null)!.title, 'Missed call');
});

test('the request goes to the right host with the alert headers', async () => {
  const { seen, f } = recorder();
  const alert = alertForNotice(notice('gaze', `interest:${INTEREST}:received`), null)!;
  assert.equal(await sendAlertPush(cfg, 'abcd', 'sandbox', alert, f, Date.UTC(2026, 10, 23, 12, 0, 0)), 'sent');
  assert.equal(await sendAlertPush(cfg, 'abcd', 'production', alert, f, Date.UTC(2026, 10, 23, 12, 0, 0)), 'sent');
  assert.equal(seen[0].url, 'https://api.sandbox.push.apple.com/3/device/abcd');
  assert.equal(seen[1].url, 'https://api.push.apple.com/3/device/abcd');
  assert.equal(seen[0].headers['apns-push-type'], 'alert');
  assert.equal(seen[0].headers['apns-topic'], 'com.gayze.app');
  assert.equal(seen[0].headers['apns-collapse-id'], `g-${ID}`);
  assert.equal(Number(seen[0].headers['apns-expiration']), Math.floor(Date.UTC(2026, 10, 23, 12, 0, 0) / 1000) + 4 * 3600);
  assert.equal(seen[0].body.aps.category, 'GAYZE_GAZE');
  assert.equal(seen[0].body.aps.alert.title, 'New Gayze');
});

test('VoIP and alert pushes share one provider token, so Apple never sees two within 20 minutes', async () => {
  const at = Date.UTC(2026, 10, 23, 12, 7, 0);
  const a = await providerJwt(cfg, at);
  const b = await providerJwt(cfg, at + 9 * 60_000);       // same half hour
  assert.equal(a, b);
  const { seen, f } = recorder();
  await sendAlertPush(cfg, 't1', 'production', { title: 'x', body: 'y', data: {} }, f, at + 60_000);
  await sendVoipPush({ ...cfg, topic: 'com.gayze.app.voip' }, 't1', 'production', { callId: 'c', callerId: 'u', callerName: 'n', callType: 'audio', conversationId: 'k', startedAtMs: 1 }, f);
  assert.equal(seen[0].headers.authorization.startsWith('bearer '), true);
  assert.notEqual(await providerJwt(cfg, at + 31 * 60_000), a);   // a new half hour gets a new token
});

test('dead tokens are reported so they can be removed; other failures are not', async () => {
  const alert = { title: 'x', body: 'y', data: {} };
  assert.equal(await sendAlertPush(cfg, 't', 'production', alert, recorder(410, '{"reason":"Unregistered"}').f), 'bad_token');
  assert.equal(await sendAlertPush(cfg, 't', 'production', alert, recorder(400, '{"reason":"BadDeviceToken"}').f), 'bad_token');
  assert.equal(await sendAlertPush(cfg, 't', 'production', alert, recorder(400, '{"reason":"PayloadEmpty"}').f), 'failed');
  assert.equal(await sendAlertPush(cfg, 't', 'production', alert, recorder(429, '').f), 'failed');
});

test('long or multi-line text cannot break the payload', () => {
  const p = alertPayload({ title: 'a\nb'.repeat(60), body: 'z'.repeat(500), data: { type: 'x' } }) as any;
  assert.equal(p.aps.alert.title.includes('\n'), false);
  assert.ok(p.aps.alert.title.length <= 80 && p.aps.alert.body.length <= 160);
});
