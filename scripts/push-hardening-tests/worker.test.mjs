import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync } from 'node:fs';
import { loadModule } from '../recovery-tests/load-module.mjs';
import { worker, appClient, payload, noticeId, roomId } from './workerFixture.mjs';

test('failed display leaves no receipt; replay safely displays after restart', async () => {
  const receipts = new Map(), first = worker({ receipts }); first.failDisplay = true;
  await assert.rejects(first.push(), /display unavailable/); assert.equal(receipts.size, 0); assert.equal(first.writes.length, 0);
  const retry = worker({ receipts }); await retry.push();
  assert.equal(retry.displays.length, 1); assert.equal(receipts.size, 1); assert.equal(retry.displays[0].options.silent, false);
});

test('same-worker failure recovers and concurrent replay displays quietly into one stable OS tag', async () => {
  const w = worker(); w.failDisplay = true; await assert.rejects(w.push()); w.failDisplay = false;
  await Promise.all([w.push(), w.push({ ...payload, tag: 'do-not-trust-changing-tag' })]);
  assert.equal(w.displays.length, 2); assert.equal(w.notifications.size, 1);
  assert.equal(w.displays[1].options.tag, `gayze-${noticeId}`); assert.equal(w.displays[1].options.silent, true);
  assert(w.displays.every(n => n.options.renotify === false));
});

test('worker restart replay remains user-visible without duplicating the foreground toast', async () => {
  const receipts = new Map(), notifications = new Map(), app = appClient();
  const first = worker({ receipts, notifications, clients: [app.client] }); await first.push();
  const next = worker({ receipts, notifications, clients: [app.client] }); await next.push();
  assert.equal(next.displays.length, 1); assert.equal(next.displays[0].options.silent, true); assert.equal(notifications.size, 1);
  assert.equal(app.messages.filter(m => m.type === 'PRESENT_MESSAGE').length, 1);
});

test('receipt storage failure and unavailable page clients never suppress display', async () => {
  const w = worker(); w.failStorage = true; w.failClients = true;
  await w.push(); await w.push(); assert.equal(w.displays.length, 2); assert.equal(w.notifications.size, 1);
  assert.equal(w.displays[1].options.silent, true);
});

test('different stable notification IDs remain different notifications', async () => {
  const w = worker(); await w.push(); await w.push({ ...payload, notificationId: roomId });
  assert.equal(w.notifications.size, 2); assert.equal(w.displays[1].options.silent, false);
});

for (const focused of [true, false]) test(`click routes existing ${focused ? 'focused' : 'unfocused'} ready app with acknowledgement`, async () => {
  const app = appClient({ focused }), w = worker({ clients: [app.client] }); await w.click();
  assert.equal(app.focuses, 1); assert.equal(w.opens.length, 0); assert.equal(app.navigations.length, 0);
  assert.equal(app.messages.at(-1).url, payload.url); assert(app.messages.at(-1).navigationExpiresAt > Date.now());
});

test('no existing window cold-launches the exact stable conversation, even with a missing/stale URL', async () => {
  for (const url of [undefined, '/profile', 'https://evil.example/']) {
    const w = worker(); await w.click({ ...payload, url });
    assert.equal(w.opens[0], `https://gayze.co.uk${payload.url}`);
  }
});

test('focus failure or matchAll failure still opens the correct conversation', async () => {
  const app = appClient({ failFocus: true }), w = worker({ clients: [app.client] }); await w.click();
  assert.equal(w.opens[0], `https://gayze.co.uk${payload.url}`);
  const noClients = worker(); noClients.failClients = true; await noClients.click();
  assert.equal(noClients.opens[0], `https://gayze.co.uk${payload.url}`);
});

test('unready/old SPA falls back to navigation; unusable client falls back to a new window', async () => {
  for (const navigate of [true, false]) {
    const app = appClient({ acknowledge: false, navigate }), w = worker({ clients: [app.client] }); await w.click();
    assert.equal((navigate ? app.navigations : w.opens)[0], `https://gayze.co.uk${payload.url}`);
  }
});

test('foreign windows and malicious fallback destinations never redirect off origin', async () => {
  const foreign = appClient(); foreign.client.url = 'https://evil.example/';
  const w = worker({ clients: [foreign.client] }); await w.click({ type: 'message', conversationId: 'invalid', url: 'https://evil.example/' });
  assert.equal(foreign.focuses, 0); assert.equal(w.opens[0], 'https://gayze.co.uk/messages');
});

test('Apple endpoint variants accepted; lookalikes, non-provider hosts and SSRF vectors rejected', async () => {
  const { allowedEndpoint } = await loadModule('supabase/functions/send-push/handler.ts');
  for (const url of ['https://web.push.apple.com/a', 'https://alternate.push.apple.com/a', 'https://region.web.push.apple.com/a', 'https://WEB.PUSH.APPLE.COM/a']) assert.equal(allowedEndpoint(url), true, url);
  for (const url of ['https://push.apple.com.evil.test/a', 'https://evilpush.apple.com/a', 'https://evil.apple.com/a', 'https://evil.test/a',
    'http://web.push.apple.com/a', 'https://user@web.push.apple.com/a', 'https://web.push.apple.com:8443/a', 'https://web.push.apple.com/a#x', 'https://127.0.0.1/a', 'https://[::1]/a']) assert.equal(allowedEndpoint(url), false, url);
});

test('App accepts click routing before acknowledging it and cold links retain pending login target', () => {
  const source = readFileSync('src/App.tsx', 'utf8');
  const handler = source.slice(source.indexOf("if (data.type === 'NOTIFICATION_CLICK'"), source.indexOf("if (data.type === 'PUSH_SUBSCRIPTION_CHANGED'"));
  assert(handler.indexOf('requestConversationOpen') < handler.indexOf('postMessage({ handled: true })'));
  assert.match(handler, /rememberNotificationPath/); assert.match(handler, /navigationExpiresAt/);
});

test('hanging focus and failed navigation are bounded and fall back to openWindow', async () => {
  for (const mode of ['focus', 'navigate']) {
    const app = appClient({ acknowledge: false });
    if (mode === 'focus') app.client.focus = () => new Promise(() => {});
    else app.client.navigate = async () => { throw new Error('client disappeared'); };
    const w = worker({ clients: [app.client] }); await w.click(); assert.equal(w.opens[0], `https://gayze.co.uk${payload.url}`);
  }
});

test('OS tag evidence keeps restart replay quiet even when receipt storage is unavailable', async () => {
  const notifications = new Map(), first = worker({ notifications }); first.failStorage = true; await first.push();
  const resumed = worker({ notifications }); resumed.failStorage = true; await resumed.push();
  assert.equal(resumed.displays.length, 1); assert.equal(resumed.displays[0].options.silent, true); assert.equal(notifications.size, 1);
});
