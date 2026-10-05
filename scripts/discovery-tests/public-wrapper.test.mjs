/**
 * GAYZE — public.discover_right_now radius cap: migration test.
 *
 * Executes the REAL migration file
 *   supabase/migrations/20260930090000_discover_right_now_radius_cap.sql
 * inside PGlite (real Postgres) against a faithful stand-in of
 * private.discover_right_now that models the behaviour the operator confirmed
 * the live private function enforces: caller exclusion, is_paused = false,
 * expires_at > now(), mode/intent filtering, radius filtering, expiry ordering.
 *
 * PostGIS is not available here, so st_dwithin is modelled as
 * `distance_m <= p_radius_m`. That preserves the property under test — the
 * radius value the private function receives — which is exactly what the
 * migration changes.
 *
 * private.discover_right_now is NEVER modified by this test or the migration.
 *
 * Run: node scripts/discovery-tests/public-wrapper.test.mjs
 */
import { PGlite } from '@electric-sql/pglite';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

const REPO = fileURLToPath(new URL('../..', import.meta.url)).replace(/\/$/, '');
const MIGRATION = `${REPO}/supabase/migrations/20260930090000_discover_right_now_radius_cap.sql`;
const migrationSql = fs.readFileSync(MIGRATION, 'utf8');

let failures = 0;
const assert = (cond, msg) => {
  if (!cond) { console.error('  \u2717 FAIL:', msg); failures += 1; process.exitCode = 1; }
  else console.log('  \u2713', msg);
};
const section = (t) => console.log(`\n=== ${t} ===`);

const CALLER_ID = 99;
const SIG = 'public.discover_right_now(integer, text, text)';

/** The live private function, as described by the operator (PostGIS modelled). */
const PRIVATE_FN = `
  create function private.discover_right_now(
    p_radius_m integer default 5000,
    p_mode     text    default null,
    p_intent   text    default null
  )
  returns table (
    intent_id    int,
    user_id      int,
    display_name text,
    mode         text,
    intent       text,
    expires_at   timestamptz,
    distance_m   double precision
  )
  language sql volatile security definer set search_path to 'public', 'private'
  as $$
    select i.intent_id, i.user_id, pr.display_name, i.mode, i.intent, i.expires_at, i.distance_m
    from   public.intents i
    join   public.profiles pr on pr.id = i.user_id
    where  i.user_id <> auth.uid()                    -- caller exclusion
      and  coalesce(i.is_paused, false) = false       -- paused exclusion
      and  i.expires_at > now()                       -- expiry exclusion
      and  (p_mode   is null or lower(i.mode)   = lower(p_mode))
      and  (p_intent is null or lower(i.intent) = lower(p_intent))
      and  i.distance_m <= p_radius_m                 -- st_dwithin stand-in
    order  by i.expires_at asc;
  $$;
`;

/**
 * The live public wrapper as the operator reported it (pre-change).
 *
 * It must be written with RETURNS TABLE(...) rather than
 * `returns setof private.discover_right_now`: a function declared
 * RETURNS TABLE creates NO named composite type, so that form is not valid SQL.
 * This is exactly why the migration derives the return shape from the live
 * catalog instead of restating it.
 */
const LIVE_PUBLIC_FN = `
  create function public.discover_right_now(
    p_radius_m integer default 5000,
    p_mode     text    default null,
    p_intent   text    default null
  )
  returns table (
    intent_id    int,
    user_id      int,
    display_name text,
    mode         text,
    intent       text,
    expires_at   timestamptz,
    distance_m   double precision
  )
  language sql volatile security definer set search_path to 'public', 'private'
  as $$
    select * from private.discover_right_now(p_radius_m, p_mode, p_intent);
  $$;
`;

async function newDb() {
  const db = new PGlite();
  await db.exec(`
    create role anon nologin;
    create role authenticated nologin;
    create schema private;
    create schema auth;
    create function auth.uid() returns int language sql stable as
      $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::int $$;
    create table public.profiles (id int primary key, display_name text);
    create table public.intents (
      intent_id  int primary key,
      user_id    int,
      mode       text,
      intent     text,
      expires_at timestamptz,
      is_paused  boolean,
      distance_m double precision
    );
    -- A spread of distances spanning every boundary under test, plus rows that
    -- must never be returned regardless of radius.
    insert into public.profiles values
      (10,'A'),(20,'B'),(30,'C'),(40,'D'),(50,'E'),(60,'F'),(70,'G'),(${CALLER_ID},'ME');
    insert into public.intents values
      (1, 10, 'social',  'Coffee', now() + interval '1 hour', false,    0),
      (2, 20, 'social',  'Coffee', now() + interval '2 hour', false,  500),
      (3, 30, 'private', 'Chill',  now() + interval '3 hour', false, 2000),
      (4, 40, 'social',  'Walk',   now() + interval '4 hour', false, 4999),
      (5, 50, 'private', 'Drinks', now() + interval '5 hour', false, 5000),
      (6, 60, 'social',  'Coffee', now() + interval '6 hour', false, 9000),
      (7, 70, 'private', 'Chill',  now() + interval '7 hour', false,25000),
      (8, 10, 'social',  'Coffee', now() - interval '1 hour', false,  100),  -- expired
      (9, 20, 'social',  'Coffee', now() + interval '1 hour', true,    100),  -- paused
      (10, ${CALLER_ID}, 'social', 'Coffee', now() + interval '1 hour', false, 100); -- caller's own
    ${PRIVATE_FN}
    ${LIVE_PUBLIC_FN}
  `);
  await db.exec(`select set_config('request.jwt.claim.sub', '${CALLER_ID}', false)`);
  return db;
}

const discover = async (db, radius, mode = null, intent = null) => {
  const { rows } = await db.query(
    'select intent_id from public.discover_right_now($1, $2, $3) order by intent_id',
    [radius, mode, intent],
  );
  return rows.map((r) => r.intent_id);
};
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

process.on('uncaughtException', (err) => {
  console.error('\nUNEXPECTED ERROR:', err?.message?.split('\n')[0] ?? err);
  process.exit(1);
});

// ---------------------------------------------------------------------------
section('[1] Baseline: the LIVE (unmodified) public wrapper');
const db = await newDb();

const readSignature = (d) => d.query(`
  select pg_get_function_arguments(oid) as args,
         pg_get_function_result(oid)    as result_type,
         prosecdef, provolatile, proconfig,
         (select lanname from pg_language l where l.oid = p.prolang) as language,
         (select rolname from pg_roles r where r.oid = p.proowner)  as owner
  from pg_proc p where oid = '${SIG}'::regprocedure`).then((r) => r.rows[0]);

const preSignature = await readSignature(db);
console.log('  live signature :', preSignature.args);
console.log('  live result    :', preSignature.result_type);
const before = {};
for (const r of [null, -100, 0, 500, 2000, 4999, 5000, 5001, 10000, 25000]) {
  before[r] = await discover(db, r);
}
assert(same(before[5000], [1, 2, 3, 4, 5]),
  `live @5000m returns the 5 in-range live intents (${before[5000]})`);
assert(same(before[10000], [1, 2, 3, 4, 5, 6]),
  `BEFORE the fix, 10000m leaks the 9 km intent (${before[10000]})`);
assert(same(before[25000], [1, 2, 3, 4, 5, 6, 7]),
  `BEFORE the fix, 25000m leaks the 25 km intent (${before[25000]})`);
assert(same(before[null], []), 'live @NULL returns nothing');
assert(same(before[0], [1]), 'live @0 returns only the intent at exactly 0 m');

// ---------------------------------------------------------------------------
section('[2] Apply the REAL migration file');
let applyError = null;
try {
  await db.exec(migrationSql);
} catch (err) {
  applyError = err;
}
assert(applyError === null,
  `migration applied cleanly${applyError ? ` — ERROR: ${applyError.message.split('\n')[0]}` : ''}`);

section('[2b] Signature, return shape, security model and search_path preserved');
{
  const r = await readSignature(db);
  // Compared against the catalog values read in section [1], not a hardcoded
  // string: Postgres renders defaults canonically (DEFAULT NULL::text).
  assert(r.args === preSignature.args,
    `signature byte-identical to the live one (${r.args})`);
  assert(r.result_type === preSignature.result_type,
    `return shape byte-identical to the live one (${r.result_type})`);
  assert(r.result_type.startsWith('TABLE(') && r.result_type.includes('distance_m double precision'),
    'return shape is still the full TABLE(...) column list');
  assert(r.prosecdef === true && r.prosecdef === preSignature.prosecdef, 'still SECURITY DEFINER');
  assert(r.provolatile === 'v' && r.provolatile === preSignature.provolatile,
    'still VOLATILE (deliberately not "improved" to STABLE)');
  assert(JSON.stringify(r.proconfig) === JSON.stringify(preSignature.proconfig)
      && JSON.stringify(r.proconfig) === JSON.stringify(['search_path=public, private']),
    `search_path unchanged (${JSON.stringify(r.proconfig)})`);
  assert(r.language === 'sql' && r.language === preSignature.language, 'still LANGUAGE sql');
  assert(r.owner === preSignature.owner, `owner unchanged (${r.owner})`);
}
{
  const { rows } = await db.query(
    `select pg_get_functiondef('private.discover_right_now(integer, text, text)'::regprocedure) as d`);
  assert(rows[0].d.includes('i.distance_m <= p_radius_m'),
    'private.discover_right_now body is untouched (still the original radius predicate)');
  assert(!rows[0].d.includes('least('), 'no clamp was injected into the private function');
}

// ---------------------------------------------------------------------------
section('[3] Radius behaviour AFTER the change');
const after = {};
for (const r of [null, -100, 0, 500, 2000, 4999, 5000, 5001, 10000, 25000]) {
  after[r] = await discover(db, r);
}

assert(same(after[10000], after[5000]),
  `10000m now behaves EXACTLY as 5000m (${after[10000]})`);
assert(same(after[25000], after[5000]),
  `25000m now behaves EXACTLY as 5000m (${after[25000]})`);
assert(same(after[5001], after[5000]),
  `5001m now behaves EXACTLY as 5000m (${after[5001]})`);
assert(!after[10000].includes(6) && !after[25000].includes(6),
  'the 9 km intent is no longer reachable at any requested radius');
assert(!after[10000].includes(7) && !after[25000].includes(7),
  'the 25 km intent is no longer reachable at any requested radius');

assert(same(after[500], before[500]),
  `500m UNCHANGED (${after[500]})`);
assert(same(after[2000], before[2000]),
  `2000m UNCHANGED (${after[2000]})`);
assert(same(after[4999], before[4999]),
  `4999m UNCHANGED (${after[4999]})`);
assert(same(after[5000], before[5000]),
  `5000m UNCHANGED (${after[5000]})`);
assert(same(after[0], before[0]),
  `0m UNCHANGED (${after[0]})`);
// Negative input IS a deliberate behaviour change, exactly as specified:
// the live function returned nothing for a negative radius (no distance can be
// <= -100); the capped function clamps to 0 and therefore behaves as a 0 m
// request. Asserting "unchanged" here would be asserting the bug stays.
assert(!same(before[-100], after[-100]),
  `negative DOES change, as specified: live returned ${JSON.stringify(before[-100])}, capped returns ${JSON.stringify(after[-100])}`);
assert(same(after[-100], after[0]),
  `negative now clamps to 0 and matches the 0 m result exactly (${after[-100]})`);
assert(same(after[null], before[null]),
  `NULL UNCHANGED — still returns nothing (${after[null].length} rows)`);
{
  // This is the property the proposed least(greatest(...)) form alone breaks.
  const naive = await db.query(
    `select least(greatest(NULL::integer, 0), 5000) as v,
            (case when NULL::integer is null then null
                  else least(greatest(NULL::integer, 0), 5000) end) as guarded`);
  assert(Number(naive.rows[0].v) === 0 && naive.rows[0].guarded === null,
    'verified: bare least/greatest turns NULL into 0; the migration\'s CASE keeps it NULL');
}

// ---------------------------------------------------------------------------
section('[4] Exclusions and filters still enforced (unchanged)');
{
  const all = after[25000];
  assert(!all.includes(8), 'expired intent still excluded even at a 25 km request');
  assert(!all.includes(9), 'paused intent still excluded even at a 25 km request');
  assert(!all.includes(10), "the caller's own intent still excluded");
}
for (const radius of [5000, 10000, 25000]) {
  const social = await discover(db, radius, 'social', null);
  const priv = await discover(db, radius, 'private', null);
  assert(same(social, social.filter((id) => [1, 2, 4].includes(id))),
    `mode=social @${radius} returns only social intents (${social})`);
  assert(same(priv, priv.filter((id) => [3, 5].includes(id))),
    `mode=private @${radius} returns only private intents (${priv})`);
}
{
  const coffee = await discover(db, 25000, null, 'Coffee');
  assert(same(coffee, [1, 2]), `intent=Coffee filter unchanged (${coffee})`);
  const walk = await discover(db, 25000, null, 'Walk');
  assert(same(walk, [4]), `intent=Walk filter unchanged (${walk})`);
}
{
  const socialBefore = await (async () => {
    const fresh = await newDb();
    const r = await discover(fresh, 5000, 'social', null);
    await fresh.close();
    return r;
  })();
  const socialAfter = await discover(db, 5000, 'social', null);
  assert(same(socialAfter, socialBefore),
    `mode filter at 5000m identical before and after (${socialAfter})`);
}
{
  const { rows } = await db.query(
    'select intent_id, expires_at from public.discover_right_now(25000, null, null)');
  const times = rows.map((r) => new Date(r.expires_at).getTime());
  const sorted = [...times].sort((a, b) => a - b);
  assert(same(times, sorted), 'expiry ordering preserved (ascending expires_at)');
}

// ---------------------------------------------------------------------------
section('[5] The pre-flight guard refuses to run against a drifted function');
{
  const drifted = await newDb();
  // Simulate drift: someone changed the wrapper to STABLE since inspection.
  // The RETURNS clause is spelled out because a RETURNS TABLE function creates
  // no named composite type to reference.
  await drifted.exec(`
    create or replace function public.discover_right_now(
      p_radius_m integer default 5000, p_mode text default null, p_intent text default null)
    returns table (
      intent_id int, user_id int, display_name text, mode text,
      intent text, expires_at timestamptz, distance_m double precision)
    language sql stable security definer set search_path to 'public','private'
    as $$ select * from private.discover_right_now(p_radius_m, p_mode, p_intent); $$;
  `);
  let blocked = null;
  try { await drifted.exec(migrationSql); } catch (err) { blocked = err; }
  assert(blocked !== null, 'migration ABORTS when volatility has drifted');
  assert(/volatility/i.test(String(blocked?.message)),
    `abort message names the problem (${String(blocked?.message).split('\n')[0]})`);
  const { rows } = await drifted.query(
    `select provolatile from pg_proc where oid = '${SIG}'::regprocedure`);
  assert(rows[0].provolatile === 's',
    'the drifted function was left exactly as it was (no partial application)');
  await drifted.close();
}
{
  const missing = await newDb();
  await missing.exec(`drop function public.discover_right_now(integer, text, text)`);
  let blocked = null;
  try { await missing.exec(migrationSql); } catch (err) { blocked = err; }
  assert(blocked !== null && /does not exist/i.test(String(blocked?.message)),
    'migration ABORTS when the public wrapper is absent');
  await missing.close();
}
{
  // Body drift: the wrapper no longer delegates to the private function.
  // Postgres itself refuses `create or replace` across a different RETURNS TABLE
  // column list (SQLSTATE 42P13, "Row type defined by OUT parameters is
  // different"), so the fixture has to DROP first.
  const driftedBody = await newDb();
  await driftedBody.exec(`drop function public.discover_right_now(integer, text, text)`);
  await driftedBody.exec(`
    create function public.discover_right_now(
      p_radius_m integer default 5000, p_mode text default null, p_intent text default null)
    returns table (intent_id int, distance_m double precision)
    language sql volatile security definer set search_path to 'public','private'
    as $$ select i.intent_id, i.distance_m from public.intents i
          where i.distance_m <= p_radius_m $$;
  `);
  let blocked = null;
  try { await driftedBody.exec(migrationSql); } catch (err) { blocked = err; }
  assert(blocked !== null && /exactly 1 occurrence/i.test(String(blocked?.message)),
    `migration ABORTS when the body has drifted (${String(blocked?.message).split('\n')[0]})`);
  const { rows } = await driftedBody.query(
    `select pg_get_functiondef(oid) as d from pg_proc where oid = '${SIG}'::regprocedure`);
  assert(rows[0].d.includes('public.intents i'),
    'the drifted function was left exactly as it was');
  await driftedBody.close();
}

section('[5b] The migration is idempotent');
{
  const twice = await newDb();
  await twice.exec(migrationSql);
  const first = await discover(twice, 25000);
  let secondError = null;
  try { await twice.exec(migrationSql); } catch (err) { secondError = err; }
  assert(secondError === null,
    `applying the migration a second time is a clean no-op${secondError ? ` — ERROR: ${secondError.message.split('\n')[0]}` : ''}`);
  assert(same(await discover(twice, 25000), first),
    'results are unchanged by the second application');
  const { rows } = await twice.query(
    `select (length(pg_get_functiondef(oid)) - length(replace(pg_get_functiondef(oid),'least(greatest(p_radius_m, 0), 5000)','')))
            / length('least(greatest(p_radius_m, 0), 5000)') as n
     from pg_proc where oid = '${SIG}'::regprocedure`);
  assert(Number(rows[0].n) === 1, `the clamp appears exactly once, not twice (found ${rows[0].n})`);
  await twice.close();
}

// ---------------------------------------------------------------------------
section('[6] The migration cannot touch the private function');
{
  const exec = migrationSql.replace(/--.*$/gm, '');
  assert(!/create\s+(or\s+replace\s+)?function\s+private\./i.test(exec),
    'migration issues no CREATE against private.*');
  assert(!/(drop|alter)\s+function[^;]*private\./i.test(exec),
    'migration issues no DROP/ALTER against private.*');
  const ddl = exec.match(/\b(create|alter|drop)\s+(or\s+replace\s+)?(function|table|schema|view|policy)\s+[\w.]+/gi) || [];
  assert(ddl.length === 0,
    `migration contains no static DDL at all (found ${ddl.length}) - the only write is the verified rewrite of the public wrapper`);
  assert(/v_oid := 'public\.discover_right_now\(integer, text, text\)'::regprocedure/.test(exec),
    'the only object the migration targets is public.discover_right_now');
}

console.log('');
if (failures > 0) {
  console.error(`PUBLIC WRAPPER TESTS: ${failures} FAILED`);
  process.exitCode = 1;
} else {
  console.log('PUBLIC WRAPPER TESTS: ALL PASSED');
  console.log('  (verified against a modelled private function in PGlite,');
  console.log('   NOT against the live project \u2014 PostGIS st_dwithin is modelled');
  console.log('   as distance_m <= p_radius_m)');
}
