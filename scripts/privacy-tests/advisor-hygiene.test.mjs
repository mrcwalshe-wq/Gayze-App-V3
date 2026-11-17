/**
 * Advisor hygiene migrations (20261116210000, 20261116210100) run in real Postgres (PGlite), under the same role + claim
 * mechanism as PostgREST. The schema below mirrors the production definitions the migrations touch, read from the live
 * project on 16 Nov 2026: the 24 foreign keys the advisor listed, the profile_photos / conversation_members /
 * safety_checkins policies, gayze_send_log and private.call_live_status.
 *   node --test scripts/privacy-tests/advisor-hygiene.test.mjs
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync } from 'node:fs';
import { PGlite } from '@electric-sql/pglite';

const read = (name) => readFileSync(new URL(`../../supabase/migrations/${name}`, import.meta.url), 'utf8');
const hygiene = read('20261116210000_advisor_hygiene.sql');
const postgis = read('20261116210100_postgis_reference_table_writes.sql');

const A = '00000000-0000-4000-8000-00000000000a';
const B = '00000000-0000-4000-8000-00000000000b';
const CONV = '22222222-2222-4222-8222-222222222222';

// [table, foreign key columns, referenced table, nullable] exactly as the advisor reported them.
const FKS = [
  ['admin_broadcasts', ['created_by'], 'auth.users', false],
  ['album_photos', ['owner_id'], 'auth.users', false],
  ['album_shares', ['owner_id'], 'auth.users', false],
  ['call_sessions', ['caller_id'], 'auth.users', false],
  ['call_sessions', ['conversation_id'], 'public.conversations', false],
  ['call_signals', ['recipient_id'], 'auth.users', false],
  ['call_signals', ['sender_id'], 'auth.users', false],
  ['conversation_archives', ['conversation_id'], 'public.conversations', false],
  ['conversation_key_envelopes', ['user_id', 'device_id'], 'public.identity_devices', false],
  ['gathering_rsvps', ['user_id'], 'auth.users', false],
  ['gatherings', ['host_id'], 'auth.users', false],
  ['gayze_notifications', ['actor_id'], 'auth.users', true],
  ['gazes', ['from_user_id'], 'public.profiles', false],
  ['member_notices', ['actor_id'], 'auth.users', true],
  ['message_user_state', ['user_id'], 'auth.users', false],
  ['messages', ['unsent_by'], 'auth.users', true],
  ['past_meets', ['revoked_by'], 'auth.users', true],
  ['past_meets', ['user_b'], 'auth.users', false],
  ['peer_identity_verifications', ['peer_user_id'], 'auth.users', false],
  ['qr_meet_tokens', ['consumed_by'], 'auth.users', true],
  ['reliability_events', ['counterparty_user_id'], 'auth.users', false],
  ['reliability_events', ['source_event_id'], 'public.past_meets', true],
  ['scheduled_messages', ['conversation_id'], 'public.conversations', false],
  ['stories', ['user_id'], 'auth.users', false],
];
const EXPECTED_INDEXES = [
  'admin_broadcasts_created_by_idx', 'album_photos_owner_id_idx', 'album_shares_owner_id_idx', 'call_sessions_caller_id_idx',
  'call_sessions_conversation_id_idx', 'call_signals_recipient_id_idx', 'call_signals_sender_id_idx',
  'conversation_archives_conversation_id_idx', 'conversation_key_envelopes_user_device_idx', 'gathering_rsvps_user_id_idx',
  'gatherings_host_id_idx', 'gayze_notifications_actor_id_idx', 'gazes_from_user_id_idx', 'member_notices_actor_id_idx',
  'message_user_state_user_id_idx', 'messages_unsent_by_idx', 'past_meets_revoked_by_idx', 'past_meets_user_b_idx',
  'peer_identity_verifications_peer_user_id_idx', 'qr_meet_tokens_consumed_by_idx', 'reliability_events_counterparty_user_id_idx',
  'reliability_events_source_event_id_idx', 'scheduled_messages_conversation_id_idx', 'stories_user_id_idx',
];

function fkSchema() {
  const tables = new Map();
  for (const [table, cols, , nullable] of FKS) {
    const t = tables.get(table) ?? new Map();
    for (const col of cols) t.set(col, nullable);
    tables.set(table, t);
  }
  let sql = '';
  for (const [table, cols] of tables) {
    const body = [...cols].map(([col, nullable]) => `${col} uuid${nullable ? '' : ' not null'}`).join(', ');
    sql += table === 'past_meets'
      ? `alter table public.past_meets add column revoked_by uuid, add column user_b uuid not null;\n`
      : `create table public.${table} (id uuid primary key default gen_random_uuid(), ${body});\n`;
  }
  for (const [table, cols, ref] of FKS) {
    const target = ref === 'public.identity_devices' ? `${ref} (user_id, device_id)` : `${ref} (id)`;
    sql += `alter table public.${table} add constraint ${table}_${cols.length > 1 ? 'user_device' : cols[0]}_fkey foreign key (${cols.join(', ')}) references ${target};\n`;
  }
  return sql;
}

const SCHEMA = `
create role anon nologin; create role authenticated nologin; create role service_role nologin;
create schema auth; create schema private;
create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
create table auth.users (id uuid primary key);
create table public.conversations (id uuid primary key);
create table public.profiles (id uuid primary key);
create table public.identity_devices (user_id uuid, device_id uuid, primary key (user_id, device_id));
create table public.past_meets (id uuid primary key default gen_random_uuid());
${fkSchema()}

-- profile_photos, with the three policies as they are in production today.
create table public.profile_photos (id uuid primary key default gen_random_uuid(), user_id uuid not null, storage_path text not null,
  sort_order integer default 0, is_primary boolean default false, created_at timestamptz default now(), updated_at timestamptz default now());
alter table public.profile_photos enable row level security;
create policy profile_photos_select_visible on public.profile_photos for select to authenticated using (user_id = auth.uid());
create policy profile_photos_insert_own on public.profile_photos for insert to authenticated with check (user_id = auth.uid());
create policy profile_photos_update_own on public.profile_photos for update to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy profile_photos_delete_own on public.profile_photos for delete to authenticated using (user_id = auth.uid());

-- gayze_send_log: three columns, two indexes, no key, RLS on with no policy and no API grants.
create table public.gayze_send_log (from_user_id uuid not null, to_user_id uuid not null, sent_at timestamptz not null default now());
create index gayze_send_log_from_to_idx on public.gayze_send_log (from_user_id, to_user_id, sent_at desc);
create index gayze_send_log_from_idx on public.gayze_send_log (from_user_id, sent_at desc);
alter table public.gayze_send_log enable row level security;

create function private.call_live_status(p_status text, p_hung_up timestamptz) returns text language sql immutable as
  $$ select case when p_hung_up is not null then 'ended' else p_status end $$;

-- conversation_members and safety_checkins, with every policy production has on them.
create table public.conversation_members (conversation_id uuid not null, user_id uuid not null, primary key (conversation_id, user_id));
create function private.user_conversation_ids() returns setof uuid language sql stable security definer set search_path = public as
  $$ select conversation_id from public.conversation_members where user_id = auth.uid() $$;
alter table public.conversation_members enable row level security;
create policy conversation_members_member_read on public.conversation_members for select to authenticated
  using (conversation_id in (select private.user_conversation_ids()));
create policy member_self_all on public.conversation_members for all to authenticated using (false) with check (false);
create table public.safety_checkins (id uuid primary key default gen_random_uuid(), user_id uuid not null, note text);
alter table public.safety_checkins enable row level security;
create policy checkins_self_all on public.safety_checkins for all to authenticated using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
create policy "users create own safety checkins" on public.safety_checkins for insert to authenticated with check (user_id = (select auth.uid()));
create policy "users read own safety checkins" on public.safety_checkins for select to authenticated using (user_id = (select auth.uid()));
create policy "users update own safety checkins" on public.safety_checkins for update to authenticated using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));

create table public.spatial_ref_sys (srid integer primary key, auth_name text);
insert into public.spatial_ref_sys values (4326, 'EPSG');

grant usage on schema public, auth, private to authenticated, anon, service_role;
grant execute on function auth.uid() to authenticated, anon, service_role;
grant all on public.profile_photos, public.conversation_members, public.safety_checkins, public.spatial_ref_sys to authenticated, anon;
`;

async function createDb() {
  const db = new PGlite();
  await db.exec(SCHEMA);
  await db.exec(`
    insert into auth.users values ('${A}'), ('${B}');
    insert into public.conversations values ('${CONV}');
    insert into public.conversation_members values ('${CONV}', '${A}');
    insert into public.gayze_send_log(from_user_id, to_user_id, sent_at)
      select '${A}', '${B}', now() - (n || ' hours')::interval from generate_series(1, 12) n;
  `);
  return db;
}
const as = (db, userId, action) => db.transaction(async (tx) => {
  await tx.exec(userId ? 'set local role authenticated' : 'set local role anon');
  await tx.query("select set_config('request.jwt.claim.sub', $1, true)", [userId ?? '']);
  return action(tx);
});
const q = async (db, user, sql, params = []) => (await as(db, user, (tx) => tx.query(sql, params))).rows;
const outcome = async (db, user, sql, params = []) => {
  try { const r = await as(db, user, (tx) => tx.query(sql, params)); return `ok:${r.affectedRows ?? 0}:${r.rows.length}`; }
  catch (error) { return `error:${String(error.message).replace(/"[^"]*"/g, '"…"')}`; }
};

// The advisor's "unindexed foreign keys" rule: a foreign key is covered when some index starts with exactly its columns.
const UNINDEXED_FKS = `
  select c.conrelid::regclass::text || '.' || c.conname fk
  from pg_constraint c join pg_namespace n on n.oid = c.connamespace
  where c.contype = 'f' and n.nspname = 'public'
    and not exists (
      select 1 from pg_index i
      where i.indrelid = c.conrelid
        and (i.indkey::int2[])[0:cardinality(c.conkey) - 1] @> c.conkey
        and (i.indkey::int2[])[0:cardinality(c.conkey) - 1] <@ c.conkey)
  order by 1`;
const count = async (db, sql) => Number((await db.query(`select count(*) n from (${sql}) x`)).rows[0].n);

test('(a) every foreign key the advisor listed gets its covering index: 24 unindexed before, 0 after', async () => {
  const db = await createDb();
  assert.equal(await count(db, UNINDEXED_FKS), 24);
  await db.exec(hygiene);
  assert.deepEqual((await db.query(UNINDEXED_FKS)).rows, []);
  const present = new Set((await db.query("select indexname from pg_indexes where schemaname = 'public'")).rows.map((r) => r.indexname));
  for (const name of EXPECTED_INDEXES) assert.ok(present.has(name), `missing index ${name}`);
  assert.equal(EXPECTED_INDEXES.length, 24);
});

test('the migration applies cleanly twice and leaves the same objects', async () => {
  const db = await createDb();
  const snapshot = async () => JSON.stringify((await db.query(`
    select 'index' kind, indexname name, indexdef def from pg_indexes where schemaname = 'public'
    union all select 'policy', tablename || '.' || policyname, coalesce(qual, '') || ' / ' || coalesce(with_check, '') from pg_policies where schemaname = 'public'
    union all select 'constraint', conname, pg_get_constraintdef(oid) from pg_constraint where connamespace = 'public'::regnamespace
    order by 1, 2`)).rows);
  await db.exec(hygiene);
  const once = await snapshot();
  await db.exec(hygiene);
  assert.equal(await snapshot(), once);
  assert.equal(Number((await db.query('select count(*) n from public.gayze_send_log')).rows[0].n), 12);
});

test('(b) profile_photos: the owner can add, change and remove their photo; another member cannot', async () => {
  const run = async (migrated) => {
    const db = await createDb();
    if (migrated) await db.exec(hygiene);
    const results = [];
    results.push(await outcome(db, A, "insert into public.profile_photos(user_id, storage_path) values ($1, 'a/1.jpg')", [A]));
    results.push(await outcome(db, B, "insert into public.profile_photos(user_id, storage_path) values ($1, 'a/forged.jpg')", [A]));
    results.push(await outcome(db, B, "update public.profile_photos set storage_path = 'b/stolen.jpg' where user_id = $1", [A]));
    results.push(await outcome(db, A, 'update public.profile_photos set user_id = $1 where user_id = $2', [B, A])); // cannot give it away
    results.push(await outcome(db, A, "update public.profile_photos set sort_order = 3 where user_id = $1", [A]));
    results.push(await outcome(db, B, 'delete from public.profile_photos where user_id = $1', [A]));
    results.push(await outcome(db, null, "insert into public.profile_photos(user_id, storage_path) values ($1, 'anon.jpg')", [A]));
    results.push(await outcome(db, A, 'delete from public.profile_photos where user_id = $1', [A]));
    return { db, results };
  };
  const before = await run(false);
  const after = await run(true);
  assert.deepEqual(after.results, before.results, 'every decision is the same before and after the rewrite');
  const [ownInsert, forgedInsert, foreignUpdate, giveAway, ownUpdate, foreignDelete, anonInsert, ownDelete] = after.results;
  assert.equal(ownInsert, 'ok:1:0');
  assert.match(forgedInsert, /row-level security/);
  assert.equal(foreignUpdate, 'ok:0:0');
  assert.match(giveAway, /row-level security/);
  assert.equal(ownUpdate, 'ok:1:0');
  assert.equal(foreignDelete, 'ok:0:0');
  assert.match(anonInsert, /row-level security/);
  assert.equal(ownDelete, 'ok:1:0');

  // The advisor's condition: no bare auth.uid() left in these three policies.
  const policies = (await after.db.query(`select policyname, cmd, roles::text roles, coalesce(qual, '') || ' ' || coalesce(with_check, '') expr
    from pg_policies where tablename = 'profile_photos' and policyname like 'profile_photos_%_own' order by 1`)).rows;
  assert.equal(policies.length, 3);
  for (const p of policies) {
    assert.equal(p.roles, '{authenticated}');
    assert.equal(p.expr.replace(/\(\s*select auth\.uid\(\)( as uid)?\s*\)/gi, '').includes('auth.uid()'), false, `${p.policyname} still calls auth.uid() per row`);
  }
});

test('(c) gayze_send_log has a primary key, keeps its rows, and the cooldown trigger\'s insert still works', async () => {
  const db = await createDb();
  await db.exec(hygiene);
  const pk = (await db.query("select pg_get_constraintdef(oid) def from pg_constraint where conrelid = 'public.gayze_send_log'::regclass and contype = 'p'")).rows;
  assert.deepEqual(pk, [{ def: 'PRIMARY KEY (id)' }]);
  // The exact statement gayze_enforce_send_cooldown() runs.
  await db.query('insert into public.gayze_send_log(from_user_id, to_user_id, sent_at) values ($1, $2, now())', [A, B]);
  const rows = (await db.query('select count(*) n, count(distinct id) ids, min(id) lo from public.gayze_send_log')).rows[0];
  assert.deepEqual([Number(rows.n), Number(rows.ids), Number(rows.lo)], [13, 13, 1]);
  await assert.rejects(q(db, A, 'select 1 from public.gayze_send_log'), /permission denied/);
});

test('(d) private.call_live_status has a fixed, empty search_path and still answers the same', async () => {
  const db = await createDb();
  const answers = async () => (await db.query(`select private.call_live_status('answered', null) a, private.call_live_status('answered', now()) b,
    private.call_live_status('ringing', null) c, private.call_live_status(null, null) d`)).rows[0];
  const before = await answers();
  await db.exec(hygiene);
  assert.deepEqual(await answers(), before);
  assert.deepEqual(before, { a: 'answered', b: 'ended', c: 'ringing', d: null });
  const config = (await db.query("select proconfig::text c from pg_proc where oid = 'private.call_live_status(text, timestamptz)'::regprocedure")).rows[0].c;
  assert.match(config, /^\{"?search_path=(""|\\"\\")"?\}$/);
});

test('removing the redundant policies changes no decision on conversation_members or safety_checkins', async () => {
  const run = async (migrated) => {
    const db = await createDb();
    await db.query("insert into public.safety_checkins(user_id, note) values ($1, 'a-own'), ($2, 'b-own')", [A, B]);
    if (migrated) await db.exec(hygiene);
    const checks = [
      [A, 'select * from public.conversation_members'],
      [B, 'select * from public.conversation_members'],
      [null, 'select * from public.conversation_members'],
      [B, `insert into public.conversation_members values ('${CONV}', '${B}')`],          // joining a chat yourself
      [A, `insert into public.conversation_members values ('${CONV}', '${B}')`],          // adding someone
      [A, `update public.conversation_members set user_id = '${B}' where user_id = '${A}'`],
      [A, `delete from public.conversation_members where user_id = '${A}'`],
      [A, 'select * from public.safety_checkins'],
      [B, 'select * from public.safety_checkins'],
      [null, 'select * from public.safety_checkins'],
      [A, `insert into public.safety_checkins(user_id, note) values ('${A}', 'mine')`],
      [A, `insert into public.safety_checkins(user_id, note) values ('${B}', 'forged')`],
      [A, "update public.safety_checkins set note = 'edited'"],
      [A, `update public.safety_checkins set user_id = '${B}' where user_id = '${A}'`],
      [A, 'delete from public.safety_checkins'],
      [B, 'select * from public.safety_checkins'],
    ];
    const results = [];
    for (const [user, sql] of checks) results.push(`${user ? user.slice(-1) : 'anon'} | ${sql.slice(0, 60)} => ${await outcome(db, user, sql)}`);
    return { db, results };
  };
  const before = await run(false);
  const after = await run(true);
  assert.deepEqual(after.results, before.results);
  const left = (await after.db.query("select tablename || '.' || policyname p from pg_policies where tablename in ('conversation_members', 'safety_checkins') order by 1")).rows.map((r) => r.p);
  assert.deepEqual(left, ['conversation_members.conversation_members_member_read', 'safety_checkins.checkins_self_all']);
  // Spot checks on the shared result, so "identical" cannot mean "identically broken".
  const rowsSeen = (line) => Number(line.split(':').pop());
  assert.equal(rowsSeen(after.results[0]), 1, 'a member sees the membership rows of their chat');
  assert.equal(rowsSeen(after.results[1]), 0, 'a non-member sees none');
  assert.match(after.results[3], /row-level security/, 'nobody can add themselves to a chat');
  assert.deepEqual([rowsSeen(after.results[7]), rowsSeen(after.results[8])], [1, 1], 'each member sees only their own check-in');
  assert.match(after.results[11], /row-level security/, 'a check-in cannot be filed in someone else\'s name');
  assert.match(after.results[14], /ok:2:0$/, 'a member can still delete their own check-ins (the FOR ALL policy)');
  after.results.forEach((line) => console.log('   ' + line));
});

test('the PostGIS reference-table migration is safe to run twice and never removes read access', async () => {
  const db = await createDb();
  await db.exec(postgis);
  await db.exec(postgis);
  assert.equal((await q(db, A, 'select srid from public.spatial_ref_sys')).length, 1);
  assert.equal((await q(db, null, 'select srid from public.spatial_ref_sys')).length, 1);
  // Here the test database's superuser owns the table, so the revoke takes effect (on the hosted project it cannot; see the file).
  await assert.rejects(q(db, A, "insert into public.spatial_ref_sys values (1, 'x')"), /permission denied/);
  await assert.rejects(q(db, null, 'delete from public.spatial_ref_sys'), /permission denied/);
});
