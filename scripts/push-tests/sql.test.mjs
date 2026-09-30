import { newDb, baseSchema, migrationSql, addUsers, uuid, assert } from './lib.mjs';
const A = uuid(1), B = uuid(2), C = uuid(3);
const asUser = async (db, sub, fn) => db.transaction(async (tx) => {
  await tx.query('set local role authenticated'); await tx.query("select set_config('request.jwt.claim.sub',$1,true)", [sub]); return fn(tx);
});
const tryq = async (fn) => { try { return { ok: true, v: await fn() }; } catch (e) { return { ok: false, e }; } };

console.log('\n[1] Fresh project with base schema: migration applies, re-applies (idempotent)');
{
  const db = await newDb(); await baseSchema(db); await addUsers(db, A, B, C);
  await db.exec(migrationSql());
  assert(true, 'migration applied cleanly');
  await db.exec(migrationSql());
  assert(true, 'migration is re-runnable (finds its own objects, does not collide)');
  const trg = await db.query(`select tgname from pg_trigger where tgname='messages_notify_push'`);
  assert(trg.rows.length === 1, 'messages trigger installed on real messages table');
  const inter = await db.query(`select tgname from pg_trigger where tgname='interests_notify_push'`);
  assert(inter.rows.length === 0, 'no speculative interests trigger');
  const rls = await db.query(`select relname, relrowsecurity, relforcerowsecurity from pg_class where relname in ('push_subscriptions','notification_preferences','notification_dispatch_log')`);
  assert(rls.rows.length === 3 && rls.rows.every((r) => r.relrowsecurity && r.relforcerowsecurity), 'RLS enabled+forced on all 3 tables');
  const pol = await db.query(`select tablename, policyname, cmd, qual, with_check from pg_policies where schemaname='public' order by 1,2`);
  assert(!pol.rows.some((r) => r.tablename === 'notification_dispatch_log'), 'dispatch log has no authenticated policies');
  assert(pol.rows.filter((r) => r.tablename === 'push_subscriptions').length === 4, 'push_subscriptions: exactly select/insert/update/delete own-row policies');
}

console.log('\n[2] Existing application functions are never overwritten');
{
  const db = await newDb(); await baseSchema(db);
  await db.exec(`create function public.touch_updated_at() returns trigger language plpgsql as $$ begin new.touched := 42; return new; end $$;`);
  const before = (await db.query(`select prosrc from pg_proc where proname='touch_updated_at'`)).rows[0].prosrc;
  await db.exec(migrationSql());
  const after = (await db.query(`select prosrc from pg_proc where proname='touch_updated_at'`)).rows[0].prosrc;
  assert(before === after, 'pre-existing public.touch_updated_at() left byte-for-byte untouched');
  const own = await db.query(`select 1 from pg_proc where proname='gayze_push_set_updated_at'`);
  assert(own.rows.length === 1, 'push tables use their own gayze_push_set_updated_at()');

  const db2 = await newDb(); await baseSchema(db2);
  await db2.exec(`create function public.sweep_expiring_intents() returns int language sql as $$ select 7 $$;`);
  const r = await tryq(() => db2.exec(migrationSql()));
  assert(!r.ok && /refusing to overwrite/.test(r.e.message), 'migration REFUSES when a foreign function of the same signature exists');
  const still = await db2.query(`select public.sweep_expiring_intents() as v`);
  assert(still.rows[0].v === 7, 'foreign function intact after refusal');
  const tbl = await db2.query(`select 1 from pg_class where relname='push_subscriptions'`);
  assert(tbl.rows.length === 0, 'refusal happens before any table is created (preflight)');

  const db3 = await newDb(); await baseSchema(db3);
  await db3.exec(`create table public.push_subscriptions (x int);`);
  const r3 = await tryq(() => db3.exec(migrationSql()));
  assert(!r3.ok && /refusing to reuse/.test(r3.e.message), 'migration REFUSES a foreign push_subscriptions table');
}

console.log('\n[3] messages trigger vs. the actual messages table');
{
  const db = await newDb(); // NO base schema at all
  await db.exec(migrationSql());
  assert((await db.query(`select 1 from pg_trigger where tgname='messages_notify_push'`)).rows.length === 0, 'no messages table -> migration succeeds, trigger skipped (warning)');

  const db2 = await newDb();
  await db2.exec(`create table public.messages (id uuid primary key, conversation_id uuid);`); // missing sender_id
  await db2.exec(migrationSql());
  assert((await db2.query(`select 1 from pg_trigger where tgname='messages_notify_push'`)).rows.length === 0, 'messages lacking sender_id -> trigger skipped, not guessed');

  const db3 = await newDb();
  await db3.exec(`create table public.messages_real (id uuid primary key, conversation_id uuid, sender_id uuid); create view public.messages as select * from public.messages_real;`);
  await db3.exec(migrationSql());
  assert((await db3.query(`select 1 from pg_trigger where tgname='messages_notify_push'`)).rows.length === 0, 'messages is a VIEW -> trigger skipped');
}

console.log('\n[4] Message trigger dispatches, and can never block a message insert');
{
  const db = await newDb(); await baseSchema(db); await addUsers(db, A, B);
  await db.exec(migrationSql());
  await db.query(`insert into profiles values ($1,'Alex')`, [A]);
  const conv = (await db.query(`insert into conversations default values returning id`)).rows[0].id;
  // no vault secrets yet -> warning, insert still fine
  await db.query(`insert into messages(conversation_id,sender_id,ciphertext) values ($1,$2,'x')`, [conv, A]);
  assert((await db.query('select count(*)::int c from __net_calls')).rows[0].c === 0, 'unconfigured vault -> no dispatch, message insert still succeeds');
    'configured -> one dispatch to /functions/v1/send-push (never the bare /send-push form)');
  assert(calls.length === 1 && calls[0].url === 'https://x.functions.supabase.co/functions/v1/send-push',
  await db.query(`insert into vault.decrypted_secrets values ('gayze_functions_url','https://x.functions.supabase.co'),('gayze_push_dispatch_secret','s3cret')`);
  await db.query(`insert into messages(conversation_id,sender_id,ciphertext) values ($1,$2,'y')`, [conv, A]);
  const calls = (await db.query('select * from __net_calls')).rows;
  assert(calls.length === 1 && calls[0].url === 'https://x.functions.supabase.co/send-push', 'configured -> one dispatch to /send-push');
  assert(calls[0].body.event === 'message' && calls[0].body.senderName === 'Alex' && !('ciphertext' in calls[0].body), 'payload has sender name + ids, NO ciphertext');
  assert(calls[0].headers['x-gayze-dispatch-secret'] === 's3cret', 'dispatch secret read from vault');
  await db.query(`insert into messages(conversation_id,sender_id,ciphertext) values ($1,$2,'z')`, [conv, B]); // sender without profile
  assert((await db.query('select count(*)::int c from __net_calls')).rows[0].c === 2, 'sender without profile row still dispatches ("Someone")');

  const db2 = await newDb({ netFails: true }); await baseSchema(db2); await addUsers(db2, A);
  await db2.exec(migrationSql());
  await db2.query(`insert into vault.decrypted_secrets values ('gayze_functions_url','u'),('gayze_push_dispatch_secret','s')`);
  const cv = (await db2.query(`insert into conversations default values returning id`)).rows[0].id;
  const r = await tryq(() => db2.query(`insert into messages(conversation_id,sender_id,ciphertext) values ($1,$2,'x')`, [cv, A]));
  assert(r.ok, 'pg_net throwing does NOT abort the message insert');

  // even a broken profiles table can't break it
  const db3 = await newDb(); await baseSchema(db3); await addUsers(db3, A);
  await db3.exec(migrationSql()); await db3.exec('drop table public.profiles');
  const cv3 = (await db3.query(`insert into conversations default values returning id`)).rows[0].id;
}+
      `${why}: ${secret} -> ${expected} (got ${rows[0]?.url ?? 'no dispatch'})`);
    assert(rows.length === 1 && rows[0].url === expected,
    const rows = (await db.query('select url from __net_calls')).rows;
    await db.query(`select public.request_push_dispatch('{"event":"message"}'::jsonb)`);
    await db.query(`insert into vault.decrypted_secrets values ('gayze_functions_url',$1),('gayze_push_dispatch_secret','s')`, [secret]);
    await db.exec(migrationSql());
    const db = await newDb(); await baseSchema(db); await addUsers(db, A);
  for (const [secret, expected, why] of cases) {
  ];
    ['https://x.supabase.co//',                   'https://x.supabase.co/functions/v1/send-push', 'repeated trailing slashes are stripped'],
    ['https://x.functions.supabase.co/functions/v1/', 'https://x.functions.supabase.co/functions/v1/send-push', 'trailing slash after /functions/v1 is stripped'],
    ['https://x.supabase.co/',                    'https://x.supabase.co/functions/v1/send-push', 'trailing slash is stripped before joining'],
    ['https://x.supabase.co/functions/v1',        'https://x.supabase.co/functions/v1/send-push', 'base already ends /functions/v1 -> do not double it'],
    ['https://x.functions.supabase.co',           'https://x.functions.supabase.co/functions/v1/send-push', 'functions host -> /functions/v1/send-push (same canonical form)'],
    ['https://x.supabase.co',                     'https://x.supabase.co/functions/v1/send-push', 'project URL -> /functions/v1/send-push (the required form)'],
  const cases = [
  // already carries /functions/v1.
  // never construct the bare '<base>/send-push' form except when the base
  // The builder must land on a REACHING route for every secret shape, and must
  //   <fnhost>/functions/v1/send-push             REACHES the function
  //   <fnhost>/send-push                          REACHES the function
  //   <project>/send-push                         gateway 404 (the old bug)
  //   <project>/functions/v1/send-push            REACHES the function
  // Live-verified routes (unauthenticated probes of the deployed project):
console.log('\n[4b] Dispatch URL normalisation — every plausible gayze_functions_url value');
  assert((await tryq(() => db3.query(`insert into messages(conversation_id,sender_id,ciphertext) values ($1,$2,'x')`, [cv3, A]))).ok, 'dropped profiles table does NOT abort the message insert');
}

console.log('\n[5] RLS: shared-device endpoint ownership (RLS is unchanged)');
{
  const db = await newDb(); await baseSchema(db); await addUsers(db, A, B);
  await db.exec(migrationSql());
  const ins = (tx, uid, ep) => tx.query(`insert into push_subscriptions(user_id,endpoint,p256dh,auth) values ($1,$2,'k','a')`, [uid, ep]);
  await asUser(db, A, (tx) => ins(tx, A, 'https://push/E1'));
  assert((await asUser(db, B, (tx) => tx.query('select * from push_subscriptions'))).rows.length === 0, 'B cannot SELECT A\'s subscription');
  const d = await asUser(db, B, (tx) => tx.query(`delete from push_subscriptions where endpoint='https://push/E1' returning id`));
  assert(d.rows.length === 0, 'B cannot DELETE A\'s subscription');
  const u = await asUser(db, B, (tx) => tx.query(`update push_subscriptions set user_id=$1 where endpoint='https://push/E1' returning id`, [B]));
  assert(u.rows.length === 0, 'B cannot steal/UPDATE A\'s subscription');
  const forge = await tryq(() => asUser(db, B, (tx) => ins(tx, A, 'https://push/E9')));
  assert(!forge.ok && /row-level security/.test(forge.e.message), 'B cannot INSERT a row owned by A');
  const up = await tryq(() => asUser(db, B, (tx) => tx.query(`insert into push_subscriptions(user_id,endpoint,p256dh,auth) values ($1,'https://push/E1','k','a') on conflict (endpoint) do update set user_id=excluded.user_id`, [B])));
  assert(!up.ok, 'B cannot take over A\'s endpoint via upsert (this is why the client mints a fresh endpoint)');
  // clean sign-out path: A deletes own row, B registers the SAME endpoint string
  await asUser(db, A, (tx) => tx.query(`delete from push_subscriptions where endpoint='https://push/E1'`));
  const b1 = await tryq(() => asUser(db, B, (tx) => ins(tx, B, 'https://push/E1')));
  assert(b1.ok, 'after A\'s clean release, endpoint can be registered against B');
  const owners = (await db.query(`select user_id from push_subscriptions where endpoint='https://push/E1'`)).rows;
  assert(owners.length === 1 && owners[0].user_id === B, 'endpoint has exactly one owner: B');
  // auth.uid() is what authenticates: anon/authenticated cannot call privileged functions
  for (const fn of ['push_category_enabled(gen_random_uuid(),\'message\')', 'request_push_dispatch(\'{}\'::jsonb)', 'sweep_expiring_intents()', 'sweep_expired_safety_checkins()', 'on_message_notify_push()']) {
    const r = await tryq(() => asUser(db, A, (tx) => tx.query(`select public.${fn}`)));
    assert(!r.ok && /permission denied/.test(r.e.message), `authenticated cannot execute ${fn.split('(')[0]}`);
  }
  const log = await asUser(db, A, (tx) => tx.query('select * from notification_dispatch_log'));
  assert(log.rows.length === 0, 'authenticated sees nothing in dispatch log');
  const logIns = await tryq(() => asUser(db, A, (tx) => tx.query(`insert into notification_dispatch_log(user_id,category,dedupe_key) values ($1,'x','y')`, [A])));
  assert(!logIns.ok, 'authenticated cannot write the dispatch log');
}

console.log('\n[6] Exactly-once ledger + preferences');
{
  const db = await newDb(); await baseSchema(db); await addUsers(db, A, B);
  await db.exec(migrationSql());
  const claim = () => tryq(() => db.query(`insert into notification_dispatch_log(user_id,category,dedupe_key) values ($1,'connection','conv-1')`, [A]));
  assert((await claim()).ok, 'first claim of (user, connection, conversation) succeeds');
  const second = await claim();
  assert(!second.ok && second.e.code === '23505', 'second claim is a unique_violation (23505)');
  assert((await db.query(`select public.push_category_enabled($1,'connection') v`, [A])).rows[0].v === true, 'no prefs row -> default on');
  await db.query(`insert into notification_preferences(user_id,connections) values ($1,false)`, [A]);
  assert((await db.query(`select public.push_category_enabled($1,'connection') v`, [A])).rows[0].v === false, 'connections=false -> blocked');
  assert((await db.query(`select public.push_category_enabled($1,'message') v`, [A])).rows[0].v === true, 'other categories unaffected');
  await db.query(`update notification_preferences set push_enabled=false where user_id=$1`, [A]);
  assert((await db.query(`select public.push_category_enabled($1,'message') v`, [A])).rows[0].v === false, 'master switch off -> everything blocked');
  assert((await db.query(`select public.push_category_enabled($1,'test') v`, [A])).rows[0].v === false, '...including test (master off)');
}

console.log('\n[7] Sweeps use only evidenced columns, are bounded, and fire once');
{
  const db = await newDb(); await baseSchema(db); await addUsers(db, A, B);
  await db.exec(migrationSql());
  await db.query(`insert into vault.decrypted_secrets values ('gayze_functions_url','u'),('gayze_push_dispatch_secret','s')`);
  await db.query(`insert into safety_checkins(user_id,status,expires_at) values
    ($1,'active', now() - interval '2 days'),      -- historical, never closed: must NOT notify
    ($1,'active', now() - interval '5 minutes'),   -- just expired: notify once
    ($2,'ended',  now() - interval '5 minutes'),   -- ended by user: never
    ($2,'active', now() + interval '10 minutes')   -- still running: never`, [A, B]);
  const n1 = (await db.query('select public.sweep_expired_safety_checkins() n')).rows[0].n;
  const n2 = (await db.query('select public.sweep_expired_safety_checkins() n')).rows[0].n;
  assert(n1 === 1 && n2 === 0, `safety sweep: 1 push, then 0 on re-run (got ${n1}, ${n2}); historical/ended/running ignored`);
  await db.query(`insert into intents(user_id,expires_at,is_paused) values ($1, now()+interval '10 minutes', false), ($1, now()+interval '10 minutes', true), ($2, now()+interval '5 hours', false)`, [A, B]);
  const i1 = (await db.query('select public.sweep_expiring_intents() n')).rows[0].n;
  const i2 = (await db.query('select public.sweep_expiring_intents() n')).rows[0].n;
  assert(i1 === 1 && i2 === 0, `intent sweep: only the active expiring intent, once (got ${i1}, ${i2})`);

  const db2 = await newDb(); await db2.exec(migrationSql());
  assert((await db2.query('select public.sweep_expiring_intents() n')).rows[0].n === 0 && (await db2.query('select public.sweep_expired_safety_checkins() n')).rows[0].n === 0, 'missing base tables -> sweeps are safe no-ops');
}
console.log(process.exitCode ? '\nSQL TESTS: FAILURES' : '\nSQL TESTS: ALL PASSED');
