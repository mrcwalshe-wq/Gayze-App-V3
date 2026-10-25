import test from 'node:test';
import assert from 'node:assert/strict';
import { adminDb, as, addUser, uuid } from './lib.mjs';

const denied = /permission denied|must be owner/i;

test('privileged admin functions and tables are unreachable from anon/authenticated', async () => {
  const db = await adminDb();
  const u = await addUser(db, 1);
  const fns = [
    'admin_dashboard_metrics()', "admin_list_accounts_v2('', 10, 0, 'created_desc')", `admin_account_detail('${u}')`,
    `admin_set_suspension('${u}', true, 'x', '${u}')`, 'admin_delivery_failures(10)', 'admin_failed_jobs(10)',
    "admin_bootstrap_owner('user1@example.test')", "admin_rate_hit('a','b',10)", `admin_revoke_sessions('${u}')`,
    "admin_list_reports(null, 10, 0)", `admin_update_report('${u}', 'resolved')`, "admin_audit_search(null, null, 10, 0)",
    `admin_profile_photo_problems('${u}')`, 'admin_auth_events(10)', 'admin_cron_status()',
  ];
  for (const role of ['anon', 'authenticated']) {
    for (const fn of fns) {
      await assert.rejects(as(db, role, { sub: u, role }, `select public.${fn}`), denied, `${role} must not run ${fn}`);
    }
    for (const t of ['app_admins', 'admin_audit_log', 'account_restrictions', 'admin_rate_window']) {
      await assert.rejects(as(db, role, { sub: u, role }, `select * from public.${t}`), denied, `${role} must not read ${t}`);
      await assert.rejects(as(db, role, { sub: u, role }, `insert into public.${t} default values`), denied);
    }
  }
  // service_role (the Edge Function) can.
  const r = await as(db, 'service_role', null, 'select public.admin_dashboard_metrics() m');
  assert.equal(r.rows[0].m.registrations.total, 1);
});

test('owner bootstrap: only exactly-one, verified, active, identified account; single owner; audited', async () => {
  const db = await adminDb();
  await assert.rejects(db.query("select public.admin_bootstrap_owner('nobody@example.test')"), /found_0/);
  await assert.rejects(db.query("select public.admin_bootstrap_owner('')"), /email_required/);
  await addUser(db, 2, { email: 'unverified@example.test', verified: false });
  await assert.rejects(db.query("select public.admin_bootstrap_owner('unverified@example.test')"), /not_verified/);
  await addUser(db, 3, { email: 'banned@example.test', banned: new Date(Date.now() + 86400e3).toISOString() });
  await assert.rejects(db.query("select public.admin_bootstrap_owner('banned@example.test')"), /banned/);
  await addUser(db, 4, { email: 'noident@example.test', provider: null });
  await assert.rejects(db.query("select public.admin_bootstrap_owner('noident@example.test')"), /no_identity/);
  await db.query("insert into auth.users (id, email, email_confirmed_at) values ($1,'dup@example.test',now()), ($2,'DUP@example.test',now())", [uuid(5), uuid(6)]);
  await assert.rejects(db.query("select public.admin_bootstrap_owner('dup@example.test')"), /found_2/);

  const owner = await addUser(db, 7, { email: 'Owner@Example.test' });
  const res = await db.query("select public.admin_bootstrap_owner('owner@example.test') r");
  assert.equal(res.rows[0].r.userId, owner);
  assert.deepEqual((await db.query('select user_id, role from public.app_admins')).rows, [{ user_id: owner, role: 'owner' }]);
  const audit = (await db.query("select * from public.admin_audit_log where action = 'owner.bootstrap'")).rows;
  assert.equal(audit.length, 1);
  assert.equal(audit[0].target_id, owner);
  assert.equal(audit[0].outcome, 'success');
  assert.ok(audit[0].metadata.db_session_user && audit[0].metadata.at);

  await addUser(db, 8, { email: 'second@example.test' });
  await assert.rejects(db.query("select public.admin_bootstrap_owner('second@example.test')"), /owner_already_exists/);
  await assert.rejects(db.query("insert into public.app_admins (user_id, role) values ($1,'owner')", [uuid(8)]), /duplicate key|unique/i);
});

test('audit log is append-only', async () => {
  const db = await adminDb();
  await db.query("insert into public.admin_audit_log (action, outcome) values ('x.test','success')");
  await assert.rejects(db.query("update public.admin_audit_log set action = 'tampered'"), /append-only/);
  await assert.rejects(db.query('delete from public.admin_audit_log'), /append-only/);
  await assert.rejects(db.query("insert into public.admin_audit_log (action, outcome) values ('x','bogus')"), /check/i);
});

test('suspension: pre-request hook blocks suspended users, allows everyone else', async () => {
  const db = await adminDb();
  const bad = await addUser(db, 1), good = await addUser(db, 2);
  await db.query('insert into public.intents (user_id, expires_at) values ($1, now() + interval \'1 hour\')', [bad]);
  await db.query("insert into public.push_subscriptions (user_id, endpoint) values ($1,'https://x')", [bad]);
  await db.query('select public.admin_set_suspension($1, true, $2, $3)', [bad, 'abuse', good]);

  await assert.rejects(as(db, 'authenticated', { sub: bad, role: 'authenticated' }, 'select public.gayze_pre_request()'), /account_suspended/);
  await as(db, 'authenticated', { sub: good, role: 'authenticated' }, 'select public.gayze_pre_request()');
  await as(db, 'anon', { role: 'anon' }, 'select public.gayze_pre_request()');
  await as(db, 'anon', null, 'select public.gayze_pre_request()');
  await as(db, 'service_role', { role: 'service_role' }, 'select public.gayze_pre_request()');
  await as(db, 'authenticated', { sub: 'not-a-uuid' }, 'select public.gayze_pre_request()'); // malformed claim never blocks others

  // Side effects of suspending.
  assert.equal((await db.query('select is_paused from public.intents where user_id=$1', [bad])).rows[0].is_paused, true);
  assert.equal((await db.query('select count(*)::int n from public.push_subscriptions where user_id=$1', [bad])).rows[0].n, 0);
  assert.equal((await db.query('select reason from public.account_restrictions where user_id=$1', [bad])).rows[0].reason, 'abuse');

  // Reinstating removes the restriction but does not resurrect paused intents or deleted subscriptions.
  await db.query('select public.admin_set_suspension($1, false, null, $2)', [bad, good]);
  await as(db, 'authenticated', { sub: bad, role: 'authenticated' }, 'select public.gayze_pre_request()');
  assert.equal((await db.query('select is_paused from public.intents where user_id=$1', [bad])).rows[0].is_paused, true);
  assert.equal((await db.query('select count(*)::int n from public.push_subscriptions where user_id=$1', [bad])).rows[0].n, 0);
});

test('my_account_status is for signed-in users only', async () => {
  const db = await adminDb();
  const u = await addUser(db, 1);
  assert.equal((await as(db, 'authenticated', { sub: u }, 'select public.my_account_status() s')).rows[0].s, 'active');
  await assert.rejects(as(db, 'anon', { role: 'anon' }, 'select public.my_account_status()'), denied);
});

test('rate limiter counts per actor and bucket', async () => {
  const db = await adminDb();
  const hit = async (a, b, limit) => (await db.query('select public.admin_rate_hit($1,$2,$3) ok', [a, b, limit])).rows[0].ok;
  assert.equal(await hit('a', 'read', 2), true);
  assert.equal(await hit('a', 'read', 2), true);
  assert.equal(await hit('a', 'read', 2), false);
  assert.equal(await hit('b', 'read', 2), true);
  assert.equal(await hit('a', 'write', 2), true);
});

test('account directory: search, pagination clamps, whitelisted sort, hostile input', async () => {
  const db = await adminDb();
  for (let i = 1; i <= 30; i++) await addUser(db, i, { email: `person${i}@example.test` });
  const list = async (q, l, o, s) => (await db.query('select public.admin_list_accounts_v2($1,$2,$3,$4) r', [q, l, o, s])).rows[0].r;
  assert.equal((await list('', 10, 0, 'created_desc')).rows.length, 10);
  assert.equal((await list('', 100000, 0, 'created_desc')).limit, 100);
  assert.equal((await list('', -5, -5, 'created_desc')).limit, 1);
  assert.equal((await list('', 10, -5, 'created_desc')).offset, 0);
  assert.equal((await list('person17', 10, 0, 'created_desc')).total, 1);
  assert.equal((await list(uuid(5), 10, 0, 'created_desc')).total, 1);
  assert.equal((await list("'; drop table public.profiles; --", 10, 0, "x'; drop table auth.users; --")).total, 0);
  assert.equal((await list('%', 10, 0, 'bogus')).total, 0, 'wildcards are not special-cased into everything');
  assert.equal((await db.query('select count(*)::int n from public.profiles')).rows[0].n, 30);
  const r = (await list('person1@', 10, 0, 'reports_desc')).rows[0];
  assert.ok(!('password' in r) && !('encrypted_password' in r));
});

test('revoke sessions, reports, photo problems, auth events', async () => {
  const db = await adminDb();
  const u = await addUser(db, 1);
  await db.query('insert into auth.sessions (user_id) values ($1),($1)', [u]);
  assert.equal((await db.query('select public.admin_revoke_sessions($1) n', [u])).rows[0].n, 2);

  const rid = (await db.query("insert into public.reports (reporter_id, reported_id, reason) values ($1,$1,'spam') returning id", [u])).rows[0].id;
  assert.deepEqual((await db.query("select public.admin_update_report($1,'resolved') r", [rid])).rows[0].r, { id: rid, from: 'open', to: 'resolved' });
  await assert.rejects(db.query("select public.admin_update_report($1,'nonsense')", [rid]), /invalid_status/);
  await assert.rejects(db.query("select public.admin_update_report($1,'open')", [uuid(99)]), /report_not_found/);
  assert.equal((await db.query("select public.admin_list_reports('resolved', 10, 0) r")).rows[0].r.total, 1);

  await db.query("insert into public.profile_photos (user_id, storage_path, sort_order, is_primary) values ($1,'u/a.jpg',0,true),($1,'u/b.jpg',1,false)", [u]);
  await db.query("insert into storage.objects (bucket_id, name) values ('profile-photos','u/a.jpg')");
  const p = (await db.query('select public.admin_profile_photo_problems($1) r', [u])).rows[0].r;
  assert.equal(p.photoRows, 2);
  assert.equal(p.missingFiles.length, 1);
  assert.equal(p.missingFiles[0].sortOrder, 1);

  assert.equal((await db.query('select public.admin_auth_events(10) r')).rows[0].r.available, false);
  await db.query("insert into auth.audit_log_entries (payload) values ('{\"action\":\"login\",\"actor_username\":\"secret@example.test\"}')");
  const ev = (await db.query('select public.admin_auth_events(10) r')).rows[0].r;
  assert.equal(ev.available, true);
  assert.ok(!JSON.stringify(ev).includes('secret@example.test'), 'no email in auth events');
});

test('audit search filters and caps', async () => {
  const db = await adminDb();
  for (let i = 0; i < 5; i++) await db.query("insert into public.admin_audit_log (action, outcome, target_id) values ('accounts.suspend', $1, $2)", [i % 2 ? 'denied' : 'success', `t${i}`]);
  const s = async (q, o, l, off) => (await db.query('select public.admin_audit_search($1,$2,$3,$4) r', [q, o, l, off])).rows[0].r;
  assert.equal((await s(null, null, 1000, 0)).limit, 200);
  assert.equal((await s(null, 'denied', 50, 0)).total, 2);
  assert.equal((await s('t3', null, 50, 0)).total, 1);
  assert.equal((await s("' or 1=1 --", null, 50, 0)).total, 0);
});

test('legacy 3-arg directory function coexists with v2 without ambiguity and stays service-only', async () => {
  const db = await adminDb();
  const u = await addUser(db, 1);
  assert.equal((await db.query("select public.admin_list_accounts('', 10, 0) r")).rows[0].r.total, 1);
  assert.equal((await db.query("select public.admin_list_accounts_v2('', 10, 0, 'created_desc') r")).rows[0].r.total, 1);
  assert.equal((await db.query("select public.admin_list_accounts_v2(p_query => '', p_limit => 10, p_offset => 0, p_sort => 'created_desc') r")).rows[0].r.total, 1);
  for (const role of ['anon', 'authenticated']) {
    await assert.rejects(as(db, role, { sub: u }, "select public.admin_list_accounts('', 10, 0)"), denied);
    await assert.rejects(as(db, role, { sub: u }, "select public.admin_list_accounts_v2('', 10, 0, 'x')"), denied);
  }
  // No dependents on the legacy function: nothing in pg_depend or other function bodies references it.
  const deps = await db.query("select count(*)::int n from pg_proc where prosrc ilike '%admin_list_accounts(%' and proname not like 'admin_list_accounts%'");
  assert.equal(deps.rows[0].n, 0);
});

test('pre-request hook enablement migration is reversible and idempotent', async () => {
  const fs = await import('node:fs');
  const { REPO } = await import('./lib.mjs');
  const db = await adminDb();
  const enable = fs.readFileSync(`${REPO}/supabase/migrations/20261025111000_enable_pre_request.sql`, 'utf8');
  const cfg = async () => (await db.query("select coalesce(array_to_string(rolconfig, ','), '') c from pg_roles where rolname='authenticator'")).rows[0].c;
  assert.equal(await cfg(), '');
  await db.exec(enable); await db.exec(enable);
  assert.match(await cfg(), /pgrst\.db_pre_request=public\.gayze_pre_request/);
  await db.exec("alter role authenticator reset pgrst.db_pre_request");
  assert.equal(await cfg(), '', 'rollback statement removes the hook');
});

test('suspended members cannot write anywhere (direct writes and definer RPCs); everyone else can', async () => {
  const db = await adminDb();
  const bad = await addUser(db, 1), good = await addUser(db, 2);
  const conv = (await db.query('insert into public.conversations default values returning id')).rows[0].id;
  // A SECURITY DEFINER function stands in for submit_interest/accept_interest: it bypasses RLS.
  await db.exec(`create function public.fake_definer_send(c uuid) returns void language sql security definer as $$ insert into public.messages (conversation_id) values (c) $$;
                 grant execute on function public.fake_definer_send(uuid) to authenticated;`);
  await db.query('select public.admin_set_suspension($1, true, $2, $3)', [bad, 'abuse', good]);

  const writes = [
    ['insert into public.messages (conversation_id) values ($1)', [conv]],
    ['insert into public.intents (user_id, expires_at) values ($1, now() + interval \'1 hour\')', [bad]],
    ['update public.profiles set display_name = \'x\' where id = $1', [bad]],
    ['insert into public.push_subscriptions (user_id, endpoint) values ($1, \'https://x\')', [bad]],
    ['select public.fake_definer_send($1)', [conv]],
  ];
  for (const [sql, params] of writes) {
    await assert.rejects(as(db, 'authenticated', { sub: bad, role: 'authenticated' }, sql, params), /account_suspended/, sql);
  }
  // Active member: same statements succeed.
  await as(db, 'authenticated', { sub: good, role: 'authenticated' }, 'insert into public.messages (conversation_id) values ($1)', [conv]);
  await as(db, 'authenticated', { sub: good, role: 'authenticated' }, 'select public.fake_definer_send($1)', [conv]);
  // Service role / no-subject callers (admin function, cron, sign-up trigger) are never blocked.
  await as(db, 'service_role', { role: 'service_role' }, 'insert into public.messages (conversation_id) values ($1)', [conv]);
  await db.query('insert into public.messages (conversation_id) values ($1)', [conv]);
  await db.query('select public.admin_set_suspension($1, true, $2, $3)', [bad, 'again', good]); // admin path still works while suspended
  // Clients cannot call the guard directly.
  await assert.rejects(as(db, 'authenticated', { sub: good }, 'select public.gayze_block_suspended_writes()'), denied);
  // Reinstating restores writes, without resurrecting the paused intent.
  await db.query('select public.admin_set_suspension($1, false, null, $2)', [bad, good]);
  await as(db, 'authenticated', { sub: bad, role: 'authenticated' }, 'insert into public.messages (conversation_id) values ($1)', [conv]);
  assert.equal((await db.query('select count(*)::int n from public.intents where user_id=$1 and is_paused=false', [bad])).rows[0].n, 0);
});
