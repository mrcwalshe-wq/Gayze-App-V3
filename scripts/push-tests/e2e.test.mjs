import { createServer } from 'vite';
import { newDb, baseSchema, migrationSql, addUsers, uuid, makeClient, assert, REPO } from './lib.mjs';

const A = uuid(1), B = uuid(2), C = uuid(3);
const VAPID = 'BEEwOKTZtTD1IvFia4YFeyfXS0GpxRKAMbIcqxB-dUeYWdPWU-_dYygdycwOWSdSADX0S62EtvUajF7fAFzaKxY';

// ---------- database with the REAL migration ----------
const db = await newDb(); await baseSchema(db); await addUsers(db, A, B, C);
await db.exec(migrationSql());

// ---------- session + fake browser device ----------
let ctx = { role: 'anon', sub: null };            // who is signed in on this device
const signIn = (u) => { ctx = { role: 'authenticated', sub: u }; };
const dropSessionUncleanly = () => { ctx = { role: 'anon', sub: null }; };

const localStore = new Map();
globalThis.window = globalThis;
globalThis.localStorage = { getItem: (k) => localStore.get(k) ?? null, setItem: (k, v) => localStore.set(k, String(v)), removeItem: (k) => localStore.delete(k) };
globalThis.PushManager = function PushManager() {};
globalThis.Notification = { permission: 'granted', requestPermission: async () => 'granted' };

const device = { sub: null, n: 0, revoked: new Set(), unsubMode: 'ok', reuseEndpoint: null };
const mkSub = () => {
  const endpoint = device.reuseEndpoint ?? `https://push.example/ep-${++device.n}`;
  const s = {
    endpoint,
    getKey: (name) => new TextEncoder().encode(name === 'p256dh' ? 'p256dh-key' : 'auth-key').buffer,
    async unsubscribe() {
      if (device.unsubMode === 'throw') throw new Error('unsubscribe exploded');
      if (device.unsubMode === 'false') return false;
      if (device.unsubMode === 'hang') return new Promise(() => {});
      device.revoked.add(endpoint); if (device.sub === s) device.sub = null; return true;
    },
  };
  return s;
};
const registration = { pushManager: { getSubscription: async () => device.sub, subscribe: async () => (device.sub = mkSub()) } };
Object.defineProperty(globalThis, 'navigator', { configurable: true, value: {
  userAgent: 'Mozilla/5.0 (test)', platform: 'Linux', maxTouchPoints: 0,
  serviceWorker: { register: async () => registration, ready: Promise.resolve(registration), getRegistration: async () => registration, addEventListener() {}, removeEventListener() {} },
} });

// ---------- edge function under test, wired to the same database ----------
const adminClient = makeClient(db, () => ({ role: 'service' }));
const webpushSends = [];
globalThis.__webpush = async (sub, payload) => {
  webpushSends.push({ endpoint: sub.endpoint, payload: JSON.parse(payload) });
  if (device.revoked.has(sub.endpoint)) { const e = new Error('gone'); e.statusCode = 410; throw e; }
};
const envVars = { SUPABASE_URL: 'http://x', SUPABASE_SERVICE_ROLE_KEY: 'svc', VAPID_PUBLIC_KEY: VAPID, VAPID_PRIVATE_KEY: 'priv', VAPID_SUBJECT: 'mailto:a@b.c', PUSH_DISPATCH_SECRET: 'dispatch-secret' };
globalThis.Deno = { env: { get: (k) => envVars[k] }, serve: (h) => { globalThis.__handler = h; } };
globalThis.__admin = adminClient;

const vite = await createServer({
  root: REPO, configFile: false, logLevel: 'error', appType: 'custom', server: { middlewareMode: true, hmr: false, ws: false },
  define: { 'import.meta.env.VITE_VAPID_PUBLIC_KEY': JSON.stringify(VAPID) },
  plugins: [{
    name: 'mocks', enforce: 'pre',
    resolveId(id) {
      if (/supabaseClient$/.test(id)) return '\0mock-supabase-client';
      if (id === 'npm:@supabase/supabase-js@2') return '\0mock-sbjs';
      if (id === 'npm:web-push@3.6.7') return '\0mock-webpush';
    },
    load(id) {
      if (id === '\0mock-supabase-client') return `export const isSupabaseConfigured = true; export const supabase = globalThis.__clientSb;`;
      if (id === '\0mock-sbjs') return `export const createClient = () => globalThis.__admin;`;
      if (id === '\0mock-webpush') return `export default { setVapidDetails(){}, sendNotification: (s,p,o) => globalThis.__webpush(s,p,o) };`;
    },
  }],
});

const callEdge = async (body, headers = {}) => {
  const res = await globalThis.__handler(new Request('http://edge/send-push', { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify(body) }));
  return { status: res.status, body: await res.json() };
};
// the browser client: same DB, real role + JWT subject, and functions.invoke -> the real edge handler
globalThis.__clientSb = makeClient(db, () => ctx, {
  invoke: async (name, body) => {
    const token = ctx.sub ? `tok:${ctx.sub}` : 'nope';
    const r = await callEdge(body, { Authorization: `Bearer ${token}` });
    return { data: r.body, error: r.status >= 400 ? { message: r.body.error } : null };
  },
});
await vite.ssrLoadModule(`${REPO}/supabase/functions/send-push/index.ts`);
const push = await vite.ssrLoadModule(`${REPO}/src/services/pushService.ts`);

const rows = async (where = '', p = []) => (await db.query(`select user_id, endpoint from push_subscriptions ${where} order by created_at, endpoint`, p)).rows;
const dispatchMessage = (sender, conv) => callEdge({ event: 'message', conversationId: conv, senderId: sender, senderName: 'X' }, { 'x-gayze-dispatch-secret': 'dispatch-secret' });
const convAB = (await db.query(`insert into conversations default values returning id`)).rows[0].id;
await db.query(`insert into conversation_members values ($1,$2),($1,$3)`, [convAB, A, B]);

console.log('\n=== Scenario 1: clean shared-device hand-off (A -> B) ===');
signIn(A);
let r = await push.subscribeToPush();
assert(r.ok, 'A enables push');
const epA = device.sub?.endpoint;
let rs = await rows();
assert(rs.length === 1 && rs[0].user_id === A && rs[0].endpoint === epA, `subscription row belongs to User A (${epA})`);
assert(await push.isDeviceSubscribed(), 'UI reports device subscribed for A');

// A sends to B while only A is registered: B has no device -> nothing; A's device must not get B's message
webpushSends.length = 0;
let d = await dispatchMessage(A, convAB);
assert(d.body.delivered === 0 && webpushSends.length === 0, 'B-bound message is NOT delivered to A\'s device (B has no subscription)');

// A signs out through the real sign-out release, THEN the session is removed
await push.releasePushOnSignOut();
dropSessionUncleanly();
assert(device.sub === null && device.revoked.has(epA), 'A signs out -> PushManager subscription removed (endpoint revoked)');
assert((await rows('where user_id=$1', [A])).length === 0, 'A signs out -> A\'s push_subscriptions row removed');
assert(localStore.get('gayze_push_pending_revoke') === undefined, 'confirmed clean -> no pending-revoke marker');

signIn(B);
assert(!(await push.isDeviceSubscribed()), 'B signs in: device does not read as subscribed');
r = await push.subscribeToPush();
assert(r.ok, 'B enables push on the same device');
const epB = device.sub.endpoint;
rs = await rows();
assert(rs.length === 1 && rs[0].user_id === B && rs[0].endpoint === epB, `B\'s endpoint registered against User B (${epB})`);

webpushSends.length = 0;
d = await dispatchMessage(A, convAB);   // A -> B
assert(d.body.delivered === 1 && webpushSends.length === 1 && webpushSends[0].endpoint === epB, 'message A->B is delivered to B\'s endpoint only');
webpushSends.length = 0;
d = await dispatchMessage(B, convAB);   // B -> A
assert(d.body.delivered === 0 && webpushSends.length === 0, 'message B->A: A has no device -> nothing sent; B\'s device never receives A-bound traffic');

console.log('\n=== Scenario 1b: endpoint string re-used by the push service after A\'s clean release ===');
await push.releasePushOnSignOut(); dropSessionUncleanly();
device.revoked.clear(); device.reuseEndpoint = 'https://push.example/STABLE';
signIn(A); await push.subscribeToPush(); await push.releasePushOnSignOut(); dropSessionUncleanly();
device.revoked.clear();
signIn(B); r = await push.subscribeToPush();
rs = await rows();
assert(r.ok && rs.length === 1 && rs[0].user_id === B && rs[0].endpoint === 'https://push.example/STABLE', 'same endpoint string can be registered against B once A\'s row is gone');
await push.releasePushOnSignOut(); dropSessionUncleanly(); device.reuseEndpoint = null; device.revoked.clear();

console.log('\n=== Scenario 2: UNCLEAN hand-off (A\'s session just disappears, no cleanup ran) ===');
signIn(A); r = await push.subscribeToPush(); const epA2 = device.sub.endpoint;
dropSessionUncleanly();                       // e.g. remote sign-out / crash / storage cleared
signIn(B);
assert(!(await push.isDeviceSubscribed()), 'B does not see A\'s leftover subscription as their own');
await push.resyncSubscription(null);
assert((await rows('where user_id=$1', [B])).length === 0, 'resync does NOT silently enrol B on A\'s leftover subscription');
r = await push.subscribeToPush();
const epB2 = device.sub.endpoint;
assert(r.ok && epB2 !== epA2, 'B enabling push gets a FRESH endpoint (no row-claiming, RLS untouched)');
assert(device.revoked.has(epA2), 'A\'s leftover endpoint was revoked with the push service');
rs = await rows();
assert(rs.some((x) => x.user_id === A && x.endpoint === epA2) && rs.some((x) => x.user_id === B && x.endpoint === epB2), 'DB: A\'s stale row is A\'s, B\'s new row is B\'s');
webpushSends.length = 0;
d = await dispatchMessage(A, convAB);   // -> B
assert(d.body.delivered === 1 && webpushSends.every((s) => s.endpoint === epB2), 'B gets only B-bound traffic on the device');
webpushSends.length = 0;
d = await dispatchMessage(B, convAB);   // -> A (stale endpoint)
assert(d.body.delivered === 0 && webpushSends.length === 1 && webpushSends[0].endpoint === epA2, 'A-bound message targets only A\'s stale endpoint, which is dead (410)...');
assert((await rows('where user_id=$1', [A])).length === 0, '...and the stale row is pruned');
await push.releasePushOnSignOut(); dropSessionUncleanly();

console.log('\n=== Scenario 3: cleanup failures never block sign-out, and are retried ===');
signIn(A); await push.subscribeToPush(); const epA3 = device.sub.endpoint;
device.unsubMode = 'throw';
let t0 = Date.now(); await push.releasePushOnSignOut(); let el = Date.now() - t0;
assert(el < 1000, `unsubscribe throwing -> releasePushOnSignOut resolves (${el}ms), sign-out proceeds`);
assert((await rows('where user_id=$1', [A])).length === 0, 'server row still removed even though browser unsubscribe failed');
assert(localStore.get('gayze_push_pending_revoke') === '1', 'pending-revoke marker left for retry');
dropSessionUncleanly();
device.unsubMode = 'ok';
await push.finishPendingPushRevoke();
assert(device.sub === null && device.revoked.has(epA3) && localStore.get('gayze_push_pending_revoke') === undefined, 'next app start (nobody signed in) finishes revoking the subscription');

signIn(A); await push.subscribeToPush();
device.unsubMode = 'hang';
t0 = Date.now(); await push.releasePushOnSignOut(400); el = Date.now() - t0;
assert(el >= 350 && el < 1500, `hanging unsubscribe is bounded by the timeout (${el}ms)`);
assert(localStore.get('gayze_push_pending_revoke') === '1', 'timeout leaves pending-revoke marker');
device.unsubMode = 'ok'; dropSessionUncleanly(); await push.finishPendingPushRevoke();
assert(device.sub === null, 'hung subscription revoked on next start');

signIn(A); await push.subscribeToPush(); dropSessionUncleanly();   // SIGNED_OUT event path (no JWT left)
await push.revokeLocalPushSubscription();
assert(device.sub === null, 'SIGNED_OUT path: browser subscription revoked without a session');
await db.query('delete from push_subscriptions');

console.log('\n=== Scenario 4: connection push (mutual interest) ===');
const conv2 = (await db.query(`insert into conversations default values returning id`)).rows[0].id;
await db.query(`insert into conversation_members values ($1,$2),($1,$3)`, [conv2, A, B]);
// B has a device; A (the caller who completes the match) does not need one
signIn(B); device.unsubMode = 'ok'; await push.subscribeToPush(); const epBc = device.sub.endpoint;
webpushSends.length = 0;
signIn(A);
await push.requestConnectionPush(conv2);
assert(webpushSends.length === 1 && webpushSends[0].endpoint === epBc && webpushSends[0].payload.type === 'connection', 'mutual created by A -> exactly one push, to B\'s device');
assert(webpushSends[0].payload.url === `/messages/${conv2}` && !/A|Alex/.test(webpushSends[0].payload.body.replace(/and someone nearby are both interested/,'')), 'deep-links to the conversation; no names in body');
await push.requestConnectionPush(conv2);
signIn(B); await push.requestConnectionPush(conv2);
assert(webpushSends.length === 1, 'duplicate / retried / OTHER-SIDE calls send nothing more (exactly once per conversation)');
assert((await db.query(`select count(*)::int c from notification_dispatch_log where category='connection'`)).rows[0].c === 1, 'one ledger row');

// preferences respected
const conv3 = (await db.query(`insert into conversations default values returning id`)).rows[0].id;
await db.query(`insert into conversation_members values ($1,$2),($1,$3)`, [conv3, A, B]);
await db.query(`insert into notification_preferences(user_id, connections) values ($1,false)`, [B]);
webpushSends.length = 0; signIn(A);
let e = await callEdge({ action: 'connection', conversationId: conv3 }, { Authorization: `Bearer tok:${A}` });
assert(webpushSends.length === 0 && e.body.delivered === 0, 'B has connections=false -> no push');
await db.query(`update notification_preferences set connections=true, push_enabled=false where user_id=$1`, [B]);
const conv3b = (await db.query(`insert into conversations default values returning id`)).rows[0].id;
await db.query(`insert into conversation_members values ($1,$2),($1,$3)`, [conv3b, A, B]);
e = await callEdge({ action: 'connection', conversationId: conv3b }, { Authorization: `Bearer tok:${A}` });
assert(webpushSends.length === 0, 'B master switch off -> no push');
await db.query('delete from notification_preferences');

// authorisation
const conv4 = (await db.query(`insert into conversations default values returning id`)).rows[0].id;
await db.query(`insert into conversation_members values ($1,$2),($1,$3)`, [conv4, A, B]);
webpushSends.length = 0;
e = await callEdge({ action: 'connection', conversationId: conv4 }, { Authorization: `Bearer tok:${C}` });
assert(e.body.reason === 'not_a_direct_member' && webpushSends.length === 0, 'non-member C cannot trigger a connection push');
e = await callEdge({ action: 'connection', conversationId: conv4 });
assert(e.status === 401, 'unauthenticated -> 401');
e = await callEdge({ action: 'connection', conversationId: conv4 }, { Authorization: 'Bearer garbage' });
assert(e.status === 401, 'invalid JWT -> 401');
e = await callEdge({ action: 'connection', conversationId: 'not-a-uuid' }, { Authorization: `Bearer tok:${A}` });
assert(e.body.reason === 'invalid_conversation', 'malformed conversation id rejected');
e = await callEdge({ action: 'connection', conversationId: conv4, toUserId: C }, { Authorization: `Bearer tok:${A}` });
const led = (await db.query(`select user_id from notification_dispatch_log where dedupe_key=$1`, [conv4])).rows;
assert(led.length === 1 && [A, B].includes(led[0].user_id) && webpushSends.every((s) => s.endpoint === epBc), 'recipient comes from conversation_members, never from the request body (toUserId=C ignored)');
const grp = (await db.query(`insert into conversations default values returning id`)).rows[0].id;
await db.query(`insert into conversation_members values ($1,$2),($1,$3),($1,$4)`, [grp, A, B, C]);
e = await callEdge({ action: 'connection', conversationId: grp }, { Authorization: `Bearer tok:${A}` });
assert(e.body.reason === 'not_a_direct_member', 'group conversation is not a "connection"');
e = await callEdge({ event: 'connection', toUserId: B }, { 'x-gayze-dispatch-secret': 'dispatch-secret' });
assert(e.status === 400, 'no secondary server-side "connection" event path exists (single source of truth)');
e = await callEdge({ event: 'message', conversationId: convAB, senderId: A }, { 'x-gayze-dispatch-secret': 'wrong' });
assert(e.status === 403, 'dispatch path still requires the secret');

// submit_interest wiring
const svc = await vite.ssrLoadModule(`${REPO}/src/services/supabaseService.ts`);
const convWire = (await db.query(`insert into conversations default values returning id`)).rows[0].id;
await db.query(`insert into conversation_members values ($1,$2),($1,$3)`, [convWire, A, B]);
globalThis.__clientSb.rpc = async (name) => name === 'submit_interest' ? { data: { mutual: true, conversation_id: convWire }, error: null } : { data: null, error: { message: 'x' } };
webpushSends.length = 0; signIn(A);
const res = await svc.submitInterest(B, undefined);
await new Promise((r2) => setTimeout(r2, 300));
assert(res.sent && res.mutual && res.conversation_id === convWire, 'submitInterest return value unchanged');
assert(webpushSends.length === 1 && webpushSends[0].payload.conversationId === convWire, 'submitInterest(mutual) triggers exactly one connection push');
globalThis.__clientSb.rpc = async () => ({ data: { mutual: false, conversation_id: null }, error: null });
webpushSends.length = 0;
const res2 = await svc.submitInterest(B, undefined);
await db.query('delete from notification_preferences'); await db.query('delete from push_subscriptions'); await db.query('delete from notification_dispatch_log');
  'master switch off -> test push refused with the honest reason (not "no device")');
assert(!ts.ok && webpushSends.length === 0 && /switched off/.test(ts.reason),
ts = await push.sendTestNotification();
await db.query(`insert into notification_preferences(user_id, push_enabled) values ($1,false)`, [B]);
assert(webpushSends.length === 2 && webpushSends[1].endpoint === epB7, 'test action can only target the JWT user (toUserId ignored)');
e = await callEdge({ action: 'test', toUserId: A }, { Authorization: `Bearer tok:${B}` });
  'system notification copy + destination');
assert(webpushSends[0].payload.type === 'test' && webpushSends[0].payload.url === '/profile' && webpushSends[0].payload.body === 'Your Gayze push notifications are now enabled.',
assert(ts.ok && webpushSends.length === 1 && webpushSends[0].endpoint === epB7, 'test push reaches the signed-in user\'s own device');
let ts = await push.sendTestNotification();
signIn(B); await push.subscribeToPush(); const epB7 = device.sub.endpoint;
console.log('\n=== Scenario 7: system (test) notification ===');
await db.query('delete from notification_dispatch_log');
  'submitInterest(mutual) sends the CONNECTION push only — never a second interest push for the same call');
assert(webpushSends.length === 1 && webpushSends[0].payload.type === 'connection' && webpushSends[0].payload.conversationId === conv5,
const res5 = await svc.submitInterest(B, uuid(8));
globalThis.__clientSb.rpc = async (name) => name === 'submit_interest' ? { data: { mutual: true, conversation_id: conv5 }, error: null } : { data: null, error: { message: 'x' } };
await db.query(`insert into conversation_members values ($1,$2),($1,$3)`, [conv5, A, B]);
const conv5 = (await db.query(`insert into conversations default values returning id`)).rows[0].id;
assert(res4.sent && webpushSends.length === 1 && webpushSends[0].payload.type === 'intent', 'submitInterest(non-mutual, intentId) triggers exactly one interest push');
const res4 = await svc.submitInterest(B, intentB2);
const intentB2 = (await db.query(`insert into intents(user_id,expires_at,is_paused) values ($1, now()+interval '1 hour', false) returning id`, [B])).rows[0].id;
assert(res3.sent && !res3.mutual && webpushSends.length === 0, 'repeat submitInterest from A is deduped at the ledger (already claimed)');
const res3 = await svc.submitInterest(B, intentB);
  : { data: null, error: { message: 'x' } };
  ? { data: { mutual: false, conversation_id: null }, error: null }
globalThis.__clientSb.rpc = async (name, args) => name === 'submit_interest'
// submitInterest wiring: non-mutual + intentId fires the interest push; mutual fires the connection push instead (one event, one notification).
assert(webpushSends.length === 0 && e.body.delivered === 0, 'intent_activity=false -> no interest push');
await db.query(`insert into notification_preferences(user_id, intent_activity) values ($1,false)`, [B]);
// Preference gate.
assert(e.status === 401, 'interest push requires authentication');
e = await callEdge({ action: 'interest', intentId: intentB });
assert(webpushSends.length === 2, 'recipient comes from intents.user_id — body toUserId is ignored');
e = await callEdge({ action: 'interest', intentId: intentB, toUserId: C }, { Authorization: `Bearer tok:${A}` });
assert(e.body.reason === 'not_eligible', 'unknown intent id -> nothing');
e = await callEdge({ action: 'interest', intentId: uuid(9) }, { Authorization: `Bearer tok:${A}` });
assert(e.body.reason === 'invalid_intent', 'malformed intent id rejected');
e = await callEdge({ action: 'interest', intentId: 'not-a-uuid' }, { Authorization: `Bearer tok:${A}` });
assert(e.body.reason === 'not_eligible' && webpushSends.length === 2, 'own intent -> rejected (no self-push)');
e = await callEdge({ action: 'interest', intentId: intentA }, { Authorization: `Bearer tok:${A}` });
assert(webpushSends.length === 2 && webpushSends[1].endpoint === epB6, 'a DIFFERENT responder is a different event -> B notified once more');
e = await callEdge({ action: 'interest', intentId: intentB }, { Authorization: `Bearer tok:${C}` });
signIn(C);
assert((await db.query(`select count(*)::int c from notification_dispatch_log where category='intent'`)).rows[0].c === 1, 'one interest ledger row');
assert(e.body.reason === 'already_sent' && webpushSends.length === 1, 'retry / repeat interest from the same caller is suppressed (exactly once per (intent, caller))');
assert(!/(A\b|Alex)/.test(ip.body), 'no sender identity in the intent push body');
  'intent push deep-links to /right-now and never names the sender or the intent');
assert(ip.url === '/right-now' && ip.intentId === intentB && ip.body === 'Someone responded to your active intent.',
const ip = webpushSends[0].payload;
  'A responds to B\'s intent -> exactly one "someone is interested" push to B\'s device');
assert(webpushSends.length === 1 && webpushSends[0].endpoint === epB6 && webpushSends[0].payload.type === 'intent',
e = await callEdge({ action: 'interest', intentId: intentB }, { Authorization: `Bearer tok:${A}` });
signIn(B); await push.subscribeToPush(); const epB6 = device.sub.endpoint;
const intentA = (await db.query(`insert into intents(user_id,expires_at,is_paused) values ($1, now()+interval '1 hour', false) returning id`, [A])).rows[0].id;
const intentB = (await db.query(`insert into intents(user_id,expires_at,is_paused) values ($1, now()+interval '1 hour', false) returning id`, [B])).rows[0].id;
console.log('\n=== Scenario 6: interest push (someone responds to your live intent) ===');
await db.query('delete from push_subscriptions'); await db.query('delete from notification_dispatch_log');
device.revoked.delete(epB5b);
assert(left.length === 1 && left[0].endpoint === epB5a, 'stale prune removes ONLY the dead endpoint row; the healthy device is untouched');
const left = await rows('where user_id=$1', [B]);
assert(d.body.delivered === 1 && webpushSends.some((s) => s.endpoint === epB5a), 'second device dead (410) -> first device still receives');
device.revoked.add(epB5b);
// Stale prune must touch ONLY the dead device's row.
assert(d.body.delivered === 0 && webpushSends.length === 0, 'master push_enabled=false -> no push either');
await db.query(`update notification_preferences set messages=true, push_enabled=false where user_id=$1`, [B]);
assert(d.body.delivered === 0 && webpushSends.length === 0, 'messages=false -> no push despite an active message');
await db.query(`insert into notification_preferences(user_id, messages) values ($1,false)`, [B]);
// Preferences gate the message category (server-side, not UI).
}
  assert(!/(ciphertext|nonce|plainText|p256dh|swarmSecret|cipher)/i.test(JSON.stringify(mp)), 'no E2EE material anywhere in the push payload');
    `payload carries ONLY ${allowed.join('/')} — no ciphertext, nonce, keys or message text (got: ${keys.join('/')})`);
  assert(JSON.stringify(keys) === JSON.stringify(allowed),
  const allowed = ['body', 'conversationId', 'tag', 'title', 'type', 'url'];
  const keys = Object.keys(mp).sort();
{
  'message notification deep-links to the conversation and tags per-conversation');
assert(mp.url === `/messages/${convAB}` && mp.conversationId === convAB && mp.tag === `gayze-message-${convAB}`,
  `message push copy is "sender sent you a message" (got: ${JSON.stringify(mp.body)})`);
assert(mp.type === 'message' && mp.title === 'New message' && mp.body === 'X sent you a message',
const mp = webpushSends[0].payload;
assert(webpushSends.every((s) => [epB5a, epB5b].includes(s.endpoint)) && new Set(webpushSends.map((s) => s.endpoint)).size === 2, 'exactly one send per device, no duplicates');
assert(d.body.delivered === 2 && webpushSends.length === 2, 'one message -> one push PER eligible device (B has two)');
d = await dispatchMessage(A, convAB);
await db.query(`insert into push_subscriptions(user_id,endpoint,p256dh,auth) values ($1,$2,'k','a')`, [B, epB5b]);
const epB5b = 'https://push.example/ep-B-second-device';
signIn(B); device.unsubMode = 'ok'; await push.subscribeToPush(); const epB5a = device.sub.endpoint;
await db.query('delete from push_subscriptions'); await db.query('delete from notification_dispatch_log'); await db.query('delete from notification_preferences');
// B runs TWO devices; A sends one message.
console.log('\n=== Scenario 5: message push — E2EE exclusion, multi-device, preferences ===');
await new Promise((r2) => setTimeout(r2, 200));
assert(res2.sent && !res2.mutual && webpushSends.length === 0, 'non-mutual interest sends no connection push');

await vite.close();
console.log(process.exitCode ? '\nE2E TESTS: FAILURES' : '\nE2E TESTS: ALL PASSED');
process.exit(process.exitCode || 0);
