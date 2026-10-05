/**
 * Profile / "About you" migration tests.
 *
 * Runs the REAL `supabase/migrations/20261001090000_profile_about_you.sql`
 * inside PGlite (real Postgres) against a stand-in legacy `profiles` schema,
 * and proves:
 *   [1] the migration is additive-only (statement scan),
 *   [2] existing rows and columns are preserved byte-for-byte,
 *   [3] `profile_intimacy` defaults + constraints + owner-only RLS,
 *   [4] `get_profile_intimacy` enforces the visibility setting,
 *   [5] the migration is idempotent.
 *
 * Run: node scripts/profile-tests/migration.test.mjs
 */
import fs from 'node:fs';
import path from 'node:path';
import url from 'node:url';
import { PGlite } from '@electric-sql/pglite';

const HERE = path.dirname(url.fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..', '..');
const MIGRATION = path.join(ROOT, 'supabase', 'migrations', '20261001090000_profile_about_you.sql');
const migrationSql = fs.readFileSync(MIGRATION, 'utf8');

let failures = 0;
function assert(cond, msg) {
  if (!cond) { console.error('  ✗ FAIL:', msg); failures += 1; process.exitCode = 1; }
  else console.log('  ✓', msg);
}
const section = (t) => console.log(`\n=== ${t} ===`);

/** Strip comments while respecting dollar-quoted bodies. */
function stripComments(source) {
  let out = '';
  let i = 0;
  let dollarTag = null;
  while (i < source.length) {
    if (dollarTag) {
      if (source.startsWith(dollarTag, i)) { out += dollarTag; i += dollarTag.length; dollarTag = null; continue; }
      out += source[i]; i += 1; continue;
    }
    const dollar = source.slice(i).match(/^\$[A-Za-z_0-9]*\$/);
    if (dollar) { dollarTag = dollar[0]; out += dollarTag; i += dollarTag.length; continue; }
    if (source.startsWith('--', i)) { while (i < source.length && source[i] !== '\n') i += 1; continue; }
    if (source.startsWith('/*', i)) { const end = source.indexOf('*/', i + 2); i = end === -1 ? source.length : end + 2; continue; }
    if (source[i] === "'") {
      out += "'"; i += 1;
      while (i < source.length) { out += source[i]; if (source[i] === "'") { i += 1; break; } i += 1; }
      continue;
    }
    out += source[i]; i += 1;
  }
  return out;
}

/** Split top-level statements on semicolons outside dollar-quoted bodies and strings. */
function splitStatements(source) {
  const clean = stripComments(source);
  const parts = [];
  let current = '';
  let dollarTag = null;
  let inString = false;
  for (let i = 0; i < clean.length; i += 1) {
    const ch = clean[i];
    if (dollarTag) {
      current += ch;
      if (clean.startsWith(dollarTag, i)) { current += dollarTag.slice(1); i += dollarTag.length - 1; dollarTag = null; }
      continue;
    }
    if (inString) {
      current += ch;
      if (ch === "'") inString = false;
      continue;
    }
    const dollar = clean.slice(i).match(/^\$[A-Za-z_0-9]*\$/);
    if (dollar) { dollarTag = dollar[0]; current += dollarTag; i += dollarTag.length - 1; continue; }
    if (ch === "'") { inString = true; current += ch; continue; }
    if (ch === ';') { if (current.trim()) parts.push(current.trim()); current = ''; continue; }
    current += ch;
  }
  if (current.trim()) parts.push(current.trim());
  return parts;
}

// ---------------------------------------------------------------------------
section('[1] The migration is additive-only');
// ---------------------------------------------------------------------------
{
  const statements = splitStatements(migrationSql);
  const exec = statements.join(';\n');
  assert(!/discover_right_now/i.test(exec), 'migration never mentions discover_right_now');
  assert(!/private\./i.test(exec), 'migration never touches the private schema');
  assert(!/\b(drop\s+table|truncate|alter\s+table\s+\S+\s+drop|drop\s+column|alter\s+column)\b/i.test(exec),
    'no table is dropped and no existing column is dropped or altered');

  const allowed = [
    /^alter\s+table\s+public\.profiles\s+add\s+column/i,
    /^comment\s+on\s+(column|table|function)\s/i,
    /^create\s+table\s+if\s+not\s+exists\s+public\.profile_intimacy/i,
    /^alter\s+table\s+public\.profile_intimacy\s+enable\s+row\s+level\s+security/i,
    /^drop\s+policy\s+if\s+exists\s+profile_intimacy_owner\s+on\s+public\.profile_intimacy/i,
    /^create\s+policy\s+profile_intimacy_owner\s+on\s+public\.profile_intimacy/i,
    /^grant\s+select,\s*insert,\s*update\s+on\s+public\.profile_intimacy/i,
    /^create\s+or\s+replace\s+function\s+public\.get_profile_intimacy/i,
    /^revoke\s+execute\s+on\s+function\s+public\.get_profile_intimacy/i,
    /^grant\s+execute\s+on\s+function\s+public\.get_profile_intimacy/i,
  ];
  const unexpected = statements.filter((s) => !allowed.some((re) => re.test(s)));
  assert(unexpected.length === 0,
    `every statement matches the additive allow-list (unexpected: ${unexpected.map((s) => s.split(/\s+/).slice(0, 6).join(' ')).join(' | ') || 'none'})`);

  const profileAlt = statements.find((s) => /^alter\s+table\s+public\.profiles/i.test(s));
  assert(profileAlt && /^alter\s+table\s+public\.profiles\s+add\s+column/i.test(profileAlt) && !/drop/i.test(profileAlt),
    'the only change to `profiles` is ADD COLUMN');
  assert(!/create\s+or\s+replace\s+function\s+(?!public\.get_profile_intimacy)/i.test(exec.replace(/get_profile_intimacy/g, 'get_profile_intimacy')),
    'the only function created is get_profile_intimacy');
}

// ---------------------------------------------------------------------------
const db = new PGlite();
await db.exec(`
  do $$
  begin
    if not exists (select 1 from pg_roles where rolname = 'anon') then create role anon nologin; end if;
    if not exists (select 1 from pg_roles where rolname = 'authenticated') then create role authenticated nologin; end if;
    if not exists (select 1 from pg_roles where rolname = 'service_role') then create role service_role nologin; end if;
  end $$;

  create schema auth;
  create function auth.uid() returns uuid language sql stable as
    $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;

  -- Legacy profiles schema exactly as the client uses it today.
  create table public.profiles (
    id                   uuid primary key,
    handle               text,
    display_name         text,
    bio                  text,
    age                  int,
    interests            text[],
    neighborhood         text,
    privacy_setting      text,
    identity_public_key  text,
    reliability_score    int default 0,
    verified_peers_count int default 0,
    safety_verified      boolean default false,
    location             text,
    avatar_path          text,
    updated_at           timestamptz default now()
  );

  -- The live get_my_conversations() shape (member rows of MY conversations).
  create table public.__connected_peers (me uuid, peer uuid);
  create function public.get_my_conversations()
  returns table (
    conversation_id uuid, conversation_created_at timestamptz, user_id uuid,
    display_name text, neighborhood text, avatar_path text
  ) language sql stable security definer as
    $$ select null::uuid, null::timestamptz, cp.peer, null::text, null::text, null::text
       from public.__connected_peers cp where cp.me = auth.uid() $$;

  -- An existing user whose data must survive untouched.
  insert into public.profiles (id, handle, display_name, bio, age, interests, neighborhood, privacy_setting, reliability_score, verified_peers_count, safety_verified)
  values ('11111111-1111-1111-1111-111111111111', 'chris-b', 'Chris', 'Existing bio', 42,
          array['Meet','Drinks','Hookup · Outdoor'], 'Bermondsey', 'neighborhood', 95, 7, true);
`);

const OWNER = '11111111-1111-1111-1111-111111111111';
const STRANGER = '22222222-2222-2222-2222-222222222222';
const CONNECTED = '33333333-3333-3333-3333-333333333333';

// ---------------------------------------------------------------------------
section('[2] Applies to a legacy database — existing data preserved');
// ---------------------------------------------------------------------------
{
  let ok = true;
  try { await db.exec(migrationSql); } catch (error) { ok = false; console.error('    migration error:', error.message); }
  assert(ok, 'migration applied cleanly to a legacy schema');

  const { rows } = await db.query(`
    select handle, display_name, bio, age, interests, neighborhood, privacy_setting,
           reliability_score, verified_peers_count, safety_verified,
           pronouns, height_cm, body_type, hobbies, boundaries, my_setup, availability
    from public.profiles where id = '${OWNER}'`);
  const r = rows[0];
  assert(r.display_name === 'Chris' && r.bio === 'Existing bio' && r.age === 42,
    'existing scalar values are byte-identical');
  assert(JSON.stringify(r.interests) === JSON.stringify(['Meet', 'Drinks', 'Hookup · Outdoor']),
    `existing interests (the looking-for selections) are preserved verbatim (${JSON.stringify(r.interests)})`);
  assert(r.reliability_score === 95 && r.verified_peers_count === 7 && r.safety_verified === true,
    'backend-owned trust counters are untouched');
  assert(r.pronouns === null && r.height_cm === null && r.body_type === null
      && r.hobbies === null && r.boundaries === null && r.my_setup === null && r.availability === null,
    'all new columns are NULL/unset for existing users — nothing is invented');
}

// ---------------------------------------------------------------------------
section('[3] profile_intimacy — defaults, constraints, owner-only RLS');
// ---------------------------------------------------------------------------
{
  const rel = await db.query(`select relrowsecurity from pg_class where relname = 'profile_intimacy'`);
  assert(rel.rows[0]?.relrowsecurity === true, 'RLS is enabled on profile_intimacy');

  const policies = await db.query(`select polname, pg_get_expr(polqual, polrelid) as using_expr
    from pg_policy where polrelid = 'public.profile_intimacy'::regclass`);
  assert(policies.rows.length === 1 && policies.rows[0].polname === 'profile_intimacy_owner',
    'exactly one policy: profile_intimacy_owner');
  assert(String(policies.rows[0].using_expr).includes('auth.uid()'),
    'the owner policy is scoped to auth.uid() = user_id');

  const inserted = await db.query(`
    insert into public.profile_intimacy (user_id, intimacy_role, intimacy_prefs)
    values ('${OWNER}', 'Versatile', array['Kissing']) returning intimacy_visibility`);
  assert(inserted.rows[0].intimacy_visibility === 'connections',
    `sensitive preferences default to 'connections' — never public`);

  let rejected = false;
  try {
    await db.query(`insert into public.profile_intimacy (user_id, intimacy_visibility) values ('${STRANGER}', 'public')`);
  } catch { rejected = true; }
  assert(rejected, "visibility CHECK rejects values outside everyone/connections/private");
}

// ---------------------------------------------------------------------------
section('[4] get_profile_intimacy enforces the visibility setting');
// ---------------------------------------------------------------------------
{
  const setCaller = (id) => db.exec(`select set_config('request.jwt.claim.sub', '${id}', false)`);
  const visible = async (caller, target) => {
    await setCaller(caller);
    const { rows } = await db.query(`select * from public.get_profile_intimacy('${target}')`);
    return rows.length;
  };

  // Owner always sees their own row, whatever the visibility.
  await db.exec(`update public.profile_intimacy set intimacy_visibility = 'private' where user_id = '${OWNER}'`);
  assert(await visible(OWNER, OWNER) === 1, "owner sees their own row under 'private'");

  // Stranger + not connected.
  await db.exec(`insert into public.profiles (id, display_name) values ('${STRANGER}', 'B'), ('${CONNECTED}', 'C')`);
  await db.exec(`insert into public.__connected_peers (me, peer) values ('${CONNECTED}', '${OWNER}')`);

  assert(await visible(STRANGER, OWNER) === 0, "stranger sees NOTHING under 'private'");
  await db.exec(`update public.profile_intimacy set intimacy_visibility = 'connections' where user_id = '${OWNER}'`);
  assert(await visible(STRANGER, OWNER) === 0, "unconnected stranger sees nothing under 'connections'");
  assert(await visible(CONNECTED, OWNER) === 1,
    "connected peer (shared conversation) sees the row under 'connections'");

  await db.exec(`update public.profile_intimacy set intimacy_visibility = 'everyone' where user_id = '${OWNER}'`);
  assert(await visible(STRANGER, OWNER) === 1, "everyone — any caller sees the row");

  await db.exec(`update public.profile_intimacy set intimacy_visibility = 'private' where user_id = '${OWNER}'`);
  assert(await visible(CONNECTED, OWNER) === 0, "connection does NOT override 'private'");

  // No row -> empty result, not an error.
  assert(await visible(STRANGER, STRANGER) === 0, 'a user with no intimacy row gets an empty result');

  // The table itself is unreachable directly (RLS owner-only) even though the
  // SECURITY DEFINER read path is granted to authenticated.
  const grants = await db.query(`
    select grantee, privilege_type from information_schema.role_table_grants
    where table_name = 'profile_intimacy' and privilege_type = 'SELECT'`);
  assert(grants.rows.some((g) => g.grantee === 'authenticated'), 'authenticated can use the read path');
  const fnGrants = await db.query(`
    select grantee, privilege_type from information_schema.routine_privileges
    where routine_name = 'get_profile_intimacy' and privilege_type = 'EXECUTE'`);
  assert(fnGrants.rows.some((g) => g.grantee === 'authenticated'),
    'execute on get_profile_intimacy is granted to authenticated');
  assert(!fnGrants.rows.some((g) => g.grantee === 'anon'),
    'anon cannot execute get_profile_intimacy');
}

// ---------------------------------------------------------------------------
section('[5] The migration is idempotent');
// ---------------------------------------------------------------------------
{
  let ok = true;
  try { await db.exec(migrationSql); await db.exec(migrationSql); } catch (error) { ok = false; console.error('    rerun error:', error.message); }
  assert(ok, 'applying the migration again is a clean no-op');
  const count = await db.query(`select count(*)::int as n from pg_policy where polrelid = 'public.profile_intimacy'::regclass`);
  assert(count.rows[0].n === 1, 'still exactly one policy after re-runs');
}

console.log('');
if (failures > 0) {
  console.error(`PROFILE MIGRATION TESTS: ${failures} FAILED`);
  process.exitCode = 1;
} else {
  console.log('PROFILE MIGRATION TESTS: ALL PASSED');
}
