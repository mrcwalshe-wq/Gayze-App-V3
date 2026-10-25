// Member notices, gathering host/RSVP behaviour, broadcast targeting and insights definitions,
// run against the REAL migrations on PGlite (Supabase-style roles and default grants).
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { adminDb, as, addUser, uuid, REPO } from '../admin-tests/lib.mjs';

const mig = (n) => fs.readFileSync(`${REPO}/supabase/migrations/${n}`, 'utf8');
const denied = /permission denied|must be owner/i;

async function noticeDb() {
  const db = await adminDb();
  await db.exec(`
    alter table auth.sessions add column created_at timestamptz default now();
    alter table public.profiles add column neighborhood text, add column interests jsonb;
    alter table public.intents add column intent text, add column mode text, add column starts_at timestamptz,
      add column travel_willingness text, add column can_host text;
    alter table public.messages add column sender_id uuid;
    create table public.gazes (id uuid primary key default gen_random_uuid(), from_user_id uuid, created_at timestamptz default now());
    create table public.interests (id uuid primary key default gen_random_uuid(), from_user_id uuid, status text, created_at timestamptz default now());
    create table public.stories (id uuid primary key default gen_random_uuid(), user_id uuid, created_at timestamptz default now());
    create table public.safety_checkins (id uuid primary key default gen_random_uuid(), created_at timestamptz default now());
    create table public.notification_preferences (user_id uuid primary key, push_enabled boolean, messages boolean, intent_activity boolean, connections boolean, intent_expiry boolean, safety boolean);
    create table public.gatherings (id uuid primary key default gen_random_uuid(), host_id uuid, title text, category text, capacity int default 3, scheduled_at timestamptz default now() + interval '1 day', created_at timestamptz default now());
    create table public.gathering_rsvps (gathering_id uuid, user_id uuid, status text, created_at timestamptz default now(), updated_at timestamptz default now(), primary key (gathering_id, user_id));
    alter table public.gathering_rsvps enable row level security;
    create policy "users manage own gathering rsvps" on public.gathering_rsvps for all using (user_id = (select auth.uid()));
    create table public.__dispatch (payload jsonb);
    create function public.gayze_notification_http_dispatch(p_payload jsonb) returns void language sql as $$ insert into public.__dispatch values (p_payload) $$;
  `);
  await db.exec(mig('20261026090000_member_notices_and_insights.sql'));
  await db.exec(mig('20261026090500_admin_insights_fix_can_host.sql'));
  await db.exec(mig('20261026120000_insights_definitions_and_privacy.sql'));
  await db.exec(mig('20261026140000_audience_allows_explicit_self.sql'));
  await db.exec(mig('20261026150000_gathering_join_requests.sql'));
  return db;
}
const claims = (u) => ({ sub: u, role: 'authenticated' });
const rpc = (db, u, sql, params) => as(db, 'authenticated', claims(u), sql, params);

async function gathering(db, host, capacity = 3) {
  const id = uuid(900 + Math.floor(Math.random() * 90));
  await db.query("insert into public.gatherings (id, host_id, title, category, capacity) values ($1,$2,'Arts night','arts',$3)", [id, host, capacity]);
  return id;
}

const status = async (db, g, u) => (await db.query('select status from public.gathering_rsvps where gathering_id=$1 and user_id=$2', [g, u])).rows[0]?.status;
const overview = async (db, u, g) => (await rpc(db, u, 'select * from public.get_gathering_rsvp_overview(array[$1::uuid])', [g])).rows[0];

test('gathering host: always going, cannot leave, repeated calls change nothing', async () => {
  const db = await noticeDb();
  const host = await addUser(db, 1); const g = await gathering(db, host);
  assert.equal((await rpc(db, host, 'select public.request_to_join_gathering($1) r', [g])).rows[0].r, 'attending');
  for (let i = 0; i < 3; i++) {
    assert.equal((await rpc(db, host, 'select public.leave_gathering($1) r', [g])).rows[0].r, 'attending', 'host cannot leave');
    assert.equal((await rpc(db, host, 'select public.toggle_gathering_rsvp($1) r', [g])).rows[0].r, true, 'legacy toggle never removes the host');
  }
  assert.equal((await db.query('select count(*)::int c from public.gathering_rsvps where gathering_id=$1', [g])).rows[0].c, 1);
  assert.equal((await db.query('select count(*)::int c from public.member_notices')).rows[0].c, 0, 'the host joining their own gathering notifies nobody');
});

test('join requests: the guest asks, the host decides; counts and lists follow the rules', async () => {
  const db = await noticeDb();
  const host = await addUser(db, 1); const a = await addUser(db, 2); const b = await addUser(db, 3); const c = await addUser(db, 4);
  const g = await gathering(db, host, 3);
  await rpc(db, host, 'select public.request_to_join_gathering($1)', [g]);

  // A asks. Idempotent: asking again changes nothing and notifies once.
  assert.equal((await rpc(db, a, 'select public.request_to_join_gathering($1) r', [g])).rows[0].r, 'requested');
  assert.equal((await rpc(db, a, 'select public.request_to_join_gathering($1) r', [g])).rows[0].r, 'requested');
  let n = (await db.query("select * from public.member_notices where user_id=$1", [host])).rows;
  assert.equal(n.length, 1); assert.equal(n[0].title, 'Request to join'); assert.match(n[0].body, /User 2 wants to join Arts night/);
  assert.equal(await status(db, a, a) ?? await status(db, g, a), 'requested');

  // Not going until accepted: the count does not move, and A cannot see who else is going.
  let ov = await overview(db, a, g);
  assert.equal(ov.attending_count, 1); assert.equal(ov.my_status, 'requested'); assert.deepEqual(ov.pending, []); assert.deepEqual(ov.attendees, []);
  // The host sees the request and the name.
  ov = await overview(db, host, g);
  assert.equal(ov.pending.length, 1); assert.equal(ov.pending[0].userId, a); assert.equal(ov.pending[0].name, 'User 2');

  // Only the host can decide.
  await assert.rejects(rpc(db, b, 'select public.respond_to_gathering_request($1,$2,true)', [g, a]), /only the host/);
  await assert.rejects(rpc(db, a, 'select public.respond_to_gathering_request($1,$2,true)', [g, a]), /only the host/);
  assert.equal(await status(db, g, a), 'requested');

  // Accept: the guest is going, is told once, and everybody's count is right.
  assert.equal((await rpc(db, host, 'select public.respond_to_gathering_request($1,$2,true) r', [g, a])).rows[0].r, 'attending');
  assert.equal((await rpc(db, host, 'select public.respond_to_gathering_request($1,$2,true) r', [g, a])).rows[0].r, 'attending', 'accepting twice is a no-op');
  const told = (await db.query("select title from public.member_notices where user_id=$1", [a])).rows;
  assert.deepEqual(told.map((r) => r.title), ['You\'re in']);
  ov = await overview(db, a, g);
  assert.equal(ov.attending_count, 2); assert.equal(ov.my_status, 'attending');
  assert.deepEqual(ov.attendees.map((x) => x.name), ['User 1', 'User 2'], 'accepted guests see who is going, host first');
  assert.deepEqual((await overview(db, c, g)).attendees, [], 'a non-guest sees a count, never names');
  assert.equal((await overview(db, c, g)).attending_count, 2);

  // Decline: stays declined, the guest is told once, and cannot ask again.
  await rpc(db, b, 'select public.request_to_join_gathering($1)', [g]);
  assert.equal((await rpc(db, host, 'select public.respond_to_gathering_request($1,$2,false) r', [g, b])).rows[0].r, 'declined');
  assert.equal((await rpc(db, b, 'select public.request_to_join_gathering($1) r', [g])).rows[0].r, 'declined');
  assert.equal((await db.query("select count(*)::int c from public.member_notices where user_id=$1", [b])).rows[0].c, 1);

  // A can leave and the count drops; rejoining is a fresh request, not an automatic seat.
  assert.equal((await rpc(db, a, 'select public.leave_gathering($1) r', [g])).rows[0].r, 'cancelled');
  assert.equal((await overview(db, host, g)).attending_count, 1);
  assert.equal((await rpc(db, a, 'select public.request_to_join_gathering($1) r', [g])).rows[0].r, 'requested');
});

test('join requests: capacity, the full notice, legacy toggle, and no way around approval', async () => {
  const db = await noticeDb();
  const host = await addUser(db, 1); const a = await addUser(db, 2); const b = await addUser(db, 3); const c = await addUser(db, 4);
  const g = await gathering(db, host, 2);
  await rpc(db, host, 'select public.request_to_join_gathering($1)', [g]);
  await rpc(db, a, 'select public.request_to_join_gathering($1)', [g]);
  await rpc(db, b, 'select public.request_to_join_gathering($1)', [g]);
  assert.equal((await db.query("select count(*)::int c from public.member_notices where kind='gathering_full'")).rows[0].c, 0, 'not full yet');
  await rpc(db, host, 'select public.respond_to_gathering_request($1,$2,true)', [g, a]);        // 2 of 2
  assert.equal((await db.query("select count(*)::int c from public.member_notices where kind='gathering_full'")).rows[0].c, 1, 'full notice at capacity');
  await assert.rejects(rpc(db, host, 'select public.respond_to_gathering_request($1,$2,true)', [g, b]), /full/, 'the host cannot over-fill');
  await assert.rejects(rpc(db, c, 'select public.request_to_join_gathering($1)', [g]), /full/, 'nobody can ask once it is full');
  assert.equal((await db.query("select count(*)::int c from public.gathering_rsvps where gathering_id=$1 and status='attending'", [g])).rows[0].c, 2);

  // An older app calling the old function cannot get a seat.
  const g2 = await gathering(db, host, 5);
  assert.equal((await rpc(db, c, 'select public.toggle_gathering_rsvp($1) r', [g2])).rows[0].r, false);
  assert.equal(await status(db, g2, c), 'requested', 'legacy toggle only asks');
  assert.equal((await rpc(db, c, 'select public.toggle_gathering_rsvp($1) r', [g2])).rows[0].r, false);
  assert.equal(await status(db, g2, c), 'cancelled', 'second legacy toggle withdraws');

  // The table itself is closed: no direct insert, update, delete or read.
  await assert.rejects(rpc(db, c, "insert into public.gathering_rsvps (gathering_id, user_id, status) values ($1, $2, 'attending')", [g2, c]), denied);
  await assert.rejects(rpc(db, a, "update public.gathering_rsvps set status='attending'"), denied);
  await assert.rejects(rpc(db, a, 'delete from public.gathering_rsvps'), denied);
  assert.equal((await rpc(db, a, 'select count(*)::int c from public.gathering_rsvps')).rows[0].c, 0, 'rows are invisible to direct reads');
  await assert.rejects(as(db, 'anon', null, 'select * from public.get_gathering_rsvp_overview()'), denied);
  assert.ok((await db.query('select count(*)::int c from public.__dispatch')).rows[0].c >= 3, 'every notice is handed to push dispatch');
});

test('notices: members read and mark only their own; direct writes are denied; unread clears once', async () => {
  const db = await noticeDb();
  const u1 = await addUser(db, 1); const u2 = await addUser(db, 2);
  await db.query("insert into public.member_notices (user_id, kind, title, body, dedupe_key) values ($1,'broadcast','Hello','World','x1'),($2,'broadcast','Hello','World','x1')", [u1, u2]);
  const mine = (await rpc(db, u1, 'select * from public.get_my_notices(50)')).rows;
  assert.equal(mine.length, 1); assert.equal(mine[0].read_at, null);
  assert.equal((await rpc(db, u1, 'select public.mark_notices_read(null) n')).rows[0].n, 1);
  assert.equal((await rpc(db, u1, 'select public.mark_notices_read(null) n')).rows[0].n, 0, 'second call is a no-op');
  assert.equal((await db.query('select count(*)::int c from public.member_notices where user_id=$1 and read_at is null', [u2])).rows[0].c, 1, "other member's notice untouched");
  // Cannot read others' rows through the table either.
  assert.equal((await rpc(db, u1, "select count(*)::int c from public.member_notices")).rows[0].c, 1);
  await assert.rejects(rpc(db, u1, "insert into public.member_notices (user_id, kind, title, body) values ($1,'broadcast','x','y')", [u2]), denied);
  await assert.rejects(rpc(db, u1, 'update public.member_notices set read_at = null'), denied);
  await assert.rejects(rpc(db, u1, 'delete from public.member_notices'), denied);
  await assert.rejects(as(db, 'anon', null, 'select * from public.get_my_notices(5)'), denied);
  // Same dedupe key cannot create a second notice (retry safety).
  await assert.rejects(db.query("insert into public.member_notices (user_id, kind, title, body, dedupe_key) values ($1,'broadcast','Hello','World','x1')", [u1]), /unique|duplicate/i);
});

test('admin broadcast functions are service_role only; audience excludes suspended members and admins', async () => {
  const db = await noticeDb();
  const owner = await addUser(db, 1); const a = await addUser(db, 2); const b = await addUser(db, 3); const s = await addUser(db, 4);
  await db.query("insert into public.app_admins (user_id, role) values ($1,'owner')", [owner]);
  await db.query("insert into public.account_restrictions (user_id, status, reason, created_by) values ($1,'suspended','test',$2)", [s, owner]);
  const calls = ["admin_audience_count('{\"scope\":\"all\"}')", `admin_send_broadcast('${owner}','t','b','/','{"scope":"all"}')`, 'admin_list_broadcasts(5)', 'admin_insights(30, \'UTC\')', 'admin_activity_events()', "admin_resolve_audience('{\"scope\":\"all\"}')"];
  for (const role of ['anon', 'authenticated']) for (const c of calls) await assert.rejects(as(db, role, { sub: a, role }, `select * from public.${c}`), denied, `${role} ${c}`);

  assert.equal((await as(db, 'service_role', null, "select public.admin_audience_count('{\"scope\":\"all\"}') n")).rows[0].n, 2, 'owner and suspended excluded');
  assert.equal((await as(db, 'service_role', null, `select public.admin_audience_count('{"scope":"user","user":"${s}"}') n`)).rows[0].n, 0, 'cannot message a suspended member');
  assert.equal((await as(db, 'service_role', null, `select public.admin_audience_count('{"scope":"user","user":"${owner}"}') n`)).rows[0].n, 1, 'the owner can send themselves a test');
  for (const scope of ['all', 'active', 'inactive', 'push', 'intent']) {
    const rows = (await as(db, 'service_role', null, `select user_id from public.admin_resolve_audience('{"scope":"${scope}","days":9999}')`)).rows.map((r) => r.user_id);
    assert.ok(!rows.includes(owner) && !rows.includes(s), `bulk audience "${scope}" never includes admins or suspended members`);
  }
  await assert.rejects(as(db, 'service_role', null, `select public.admin_send_broadcast('${owner}','t','b','/','{"scope":"user","user":"${s}"}')`), /empty_audience/);
  await assert.rejects(as(db, 'service_role', null, `select public.admin_audience_count('{"scope":"everyone"}')`), /invalid_audience/);

  const sent = (await as(db, 'service_role', null, `select public.admin_send_broadcast('${owner}','Hi','Body','/later','{"scope":"all"}') r`)).rows[0].r;
  assert.equal(sent.recipients, 2);
  const got = (await db.query("select user_id, kind, url from public.member_notices where broadcast_id=$1 order by user_id", [sent.broadcastId])).rows;
  assert.deepEqual(got.map((r) => r.user_id), [a, b]); assert.ok(got.every((r) => r.kind === 'broadcast' && r.url === '/later'));
  const direct = (await as(db, 'service_role', null, `select public.admin_send_broadcast('${owner}','Hi','Body','/','{"scope":"user","user":"${a}"}') r`)).rows[0].r;
  assert.equal(direct.recipients, 1);
  assert.equal((await db.query("select kind from public.member_notices where broadcast_id=$1", [direct.broadcastId])).rows[0].kind, 'admin_message');
  // Length and link guards live in the table, not only in the API.
  await assert.rejects(as(db, 'service_role', null, `select public.admin_send_broadcast('${owner}','${'x'.repeat(81)}','b','/','{"scope":"all"}')`), /check/i);
  await assert.rejects(as(db, 'service_role', null, `select public.admin_send_broadcast('${owner}','t','b','//evil.example','{"scope":"all"}')`), /check/i);
});

test('insights: definitions are consistent, stories are not double counted, windows add up, small groups are hidden', async () => {
  const db = await noticeDb();
  const ids = []; for (let i = 1; i <= 6; i++) ids.push(await addUser(db, i));
  // Ages: 6 members aged 20-24 (a group of 6), one aged 50 (a group of 1).
  for (const id of ids) await db.query("update public.profiles set age = 22, neighborhood = 'Soho', interests = '[\"Hiking\",\"Art\"]'::jsonb where id=$1", [id]);
  await db.query("update public.profiles set age = 50, neighborhood = 'Rare Place', interests = '[\"Sailing\"]'::jsonb where id=$1", [ids[0]]);
  for (const id of ids) { await db.query("update auth.users set created_at = now() - interval '2 days' where id=$1", [id]); }
  // One intent = one story, as in production.
  await db.query("insert into public.intents (user_id, intent, mode, expires_at) values ($1,'Drinks','social', now() + interval '1 hour'), ($1,'Hookup · Car','private', now() + interval '1 hour')", [ids[1]]);
  await db.query("insert into public.stories (user_id) select user_id from public.intents");
  await db.query("insert into auth.sessions (user_id) values ($1)", [ids[2]]);
  const d = (await as(db, 'service_role', null, "select public.admin_insights(7, 'UTC') r")).rows[0].r;

  const sum = (rows) => rows.reduce((a, r) => a + r.n, 0);
  assert.equal(sum(d.signupsByDay), d.totals.newInPeriod, 'daily sign-ups add up to the period total');
  assert.equal(d.signupsByDay.length, 7);
  assert.equal(sum(d.activityByHour), 2, 'two intents are two actions, not four (stories are not counted)');
  assert.equal(d.totals.activeInPeriod, 2, 'active = signed in or acted: member 2 acted, member 3 signed in');
  assert.equal(d.totals.active7d, d.totals.activeInPeriod, 'same definition across windows');
  assert.ok(d.definitions.active && d.definitions.window && d.definitions.privacy, 'definitions travel with the data');
  assert.equal(d.minGroupSize, 5);

  assert.deepEqual(d.audience.ageBands, [{ label: '18-24', n: 5 }], 'the group of one is hidden, not shown or merged into a visible total');
  assert.deepEqual(d.audience.neighbourhoods, [{ label: 'Soho', n: 5 }]);
  assert.deepEqual(d.audience.topInterests.map((x) => x.label).sort(), ['Art', 'Hiking'], 'interests are read from profiles and suppressed below 5');
  assert.ok(d.intents.topVariants.every((v) => v.n >= 5 || v.label.startsWith('Other')), 'rare intent variants are not itemised');

  // Privacy: nothing identifying or sensitive anywhere in the payload.
  const text = JSON.stringify(d);
  assert.doesNotMatch(text, /@/, 'no email addresses');
  assert.doesNotMatch(text, /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i, 'no member ids');
  assert.doesNotMatch(text, /intimacy|User \d|Rare Place/i, 'no sensitive fields, names or rare places');
});

test('k-suppression: small groups merge into Other only when Other itself is large enough', async () => {
  const db = await noticeDb();
  const f = async (rows) => (await as(db, 'service_role', null, 'select public.admin_k_suppress($1::jsonb, 5) r', [JSON.stringify(rows)])).rows[0].r;
  assert.deepEqual(await f([{ label: 'a', n: 9 }, { label: 'b', n: 2 }, { label: 'c', n: 2 }]), [{ label: 'a', n: 9 }], '2+2 < 5: dropped');
  assert.deepEqual(await f([{ label: 'a', n: 9 }, { label: 'b', n: 3 }, { label: 'c', n: 3 }]), [{ label: 'a', n: 9 }, { label: 'Other (small groups)', n: 6 }]);
  assert.deepEqual(await f([]), []);
});
