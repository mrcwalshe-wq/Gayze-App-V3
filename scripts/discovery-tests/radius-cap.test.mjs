/**
 * GAYZE discovery radius ceiling — SQL regression test.
 *
 * Runs the REAL DDL from
 *   supabase/migrations/20260930090000_discover_right_now_radius_cap.sql
 * inside PGlite (a real Postgres) and asserts:
 *
 *   [1] the migration is ADDITIVE ONLY — it cannot touch the live
 *       discover_right_now, whose DDL is not in this repository;
 *   [2] the clamp DDL enforces max 5 km for every hostile input;
 *   [3] the exclusion/ceiling semantics the live function must have, checked
 *       against a faithful geometry-free reference query.
 *
 * The full `discover_right_now` body needs PostGIS + the live schema, neither of
 * which exists here, so that half is specified by supabase/pending/ and must be
 * verified against the real project by an operator. Nothing in this file claims
 * the live RPC was executed.
 *
 * Run: node scripts/discovery-tests/radius-cap.test.mjs
 */
import { PGlite } from '@electric-sql/pglite';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

const REPO = fileURLToPath(new URL('../..', import.meta.url)).replace(/\/$/, '');
const MIGRATION = `${REPO}/supabase/migrations/20260930090000_discover_right_now_radius_cap.sql`;
const RECIPE = `${REPO}/supabase/pending/discover_right_now_radius_cap.recipe.sql`;
const MIGRATIONS_DIR = `${REPO}/supabase/migrations`;
const sql = fs.readFileSync(MIGRATION, 'utf8');

let failures = 0;
const assert = (cond, msg) => {
  if (!cond) { console.error('  \u2717 FAIL:', msg); failures += 1; process.exitCode = 1; }
  else console.log('  \u2713', msg);
};
const section = (t) => console.log(`\n=== ${t} ===`);

/**
 * Strip SQL comments, respecting dollar-quoting, so the safety assertions test
 * the EXECUTABLE statements and not the explanatory prose. Without this, a
 * comment such as "does NOT create ... discover_right_now" would itself trip a
 * `create|replace ... discover_right_now` pattern.
 */
function stripSqlComments(source) {
  let out = '';
  let i = 0;
  let inDollar = false;
  while (i < source.length) {
    if (source.startsWith('$$', i)) {
      inDollar = !inDollar;
      out += '$$';
      i += 2;
      continue;
    }
    if (!inDollar && source.startsWith('--', i)) {
      while (i < source.length && source[i] !== '\n') i += 1;
      continue;
    }
    if (!inDollar && source.startsWith('/*', i)) {
      const end = source.indexOf('*/', i + 2);
      i = end === -1 ? source.length : end + 2;
      continue;
    }
    out += source[i];
    i += 1;
  }
  return out;
}

/** Pull one `create or replace function ... $$ ... $$;` block out of the file. */
function extractFunction(source, name) {
  const start = source.indexOf(`create or replace function public.${name}(`);
  if (start === -1) throw new Error(`function ${name} not found in migration`);
  const end = source.indexOf('$$;', start);
  if (end === -1) throw new Error(`unterminated body for ${name}`);
  return source.slice(start, end + 3);
}

// ---------------------------------------------------------------------------
section('[1] SAFETY \u2014 the migration cannot alter the live discover_right_now');
// This is the point of the whole file. The live function's DDL is unknown to
// this repo, so the migration must not create, replace, drop or re-grant it.
// Assertions run against the comment-stripped, i.e. EXECUTABLE, SQL.
const exec = stripSqlComments(sql);
assert(!/discover_right_now/i.test(exec),
  'the executable SQL never mentions discover_right_now at all');
assert(!/create\s+(or\s+replace\s+)?function\s+public\.discover_right_now/i.test(exec),
  'migration does NOT create or replace public.discover_right_now');
assert(!/drop\s+function/i.test(exec), 'migration drops no function');
assert(!/alter\s+function/i.test(exec), 'migration alters no function');
assert(!/drop\s+(table|policy|view|trigger)/i.test(exec),
  'migration drops no table, policy, view or trigger');
assert(!/alter\s+table/i.test(exec), 'migration alters no table');
{
  // Grants only ever touch the new helper, never a pre-existing object.
  const grantTargets = [...exec.matchAll(/(?:revoke|grant)[\s\S]*?on\s+(?:function\s+)?([\w.]+)/gi)]
    .map((m) => m[1]);
  assert(grantTargets.length > 0, 'the migration does state its grants explicitly');
  assert(grantTargets.every((t) => /clamp_discovery_radius_m/i.test(t)),
    `every revoke/grant targets only the new helper (${grantTargets.join(', ')})`);
}
{
  // Exactly one object is created, and it is the new helper.
  const created = exec.match(/create\s+(or\s+replace\s+)?(function|table|view|policy|index)\s+\S+/gi) || [];
  assert(created.length === 1, `exactly one object is created (found ${created.length}: ${created.join(', ')})`);
  assert(/clamp_discovery_radius_m/i.test(created[0] || ''), 'the one created object is clamp_discovery_radius_m');
}
assert(fs.existsSync(RECIPE), 'the operator recipe exists at supabase/pending/');
assert(!fs.readdirSync(MIGRATIONS_DIR).some((f) => /recipe/i.test(f)),
  'the recipe is NOT in supabase/migrations/, so the CLI will never auto-apply it');
{
  const recipe = fs.readFileSync(RECIPE, 'utf8');
  assert(/pg_get_functiondef/.test(recipe), 'recipe tells the operator to capture the live definition first');
  assert(/clamp_discovery_radius_m\(p_radius_m\)/.test(recipe), 'recipe applies the clamp to the radius argument');
  assert(/DO NOT AUTO-APPLY/.test(recipe), 'recipe is clearly marked do-not-auto-apply');
}

// ---------------------------------------------------------------------------
section('[2] The real clamp DDL enforces max 5 km (run in Postgres)');
const clampDdl = extractFunction(sql, 'clamp_discovery_radius_m');
assert(clampDdl.includes('least(') && clampDdl.includes('5000'),
  'clamp_discovery_radius_m caps at 5000 m');

const db = new PGlite();
await db.exec(clampDdl);

const cap = async (value) => {
  const { rows } = await db.query('select public.clamp_discovery_radius_m($1) as m', [value]);
  return Number(rows[0].m);
};

const cases = [
  ['5 km (the ceiling) is honoured', 5000, 5000],
  ['1 km is honoured', 1000, 1000],
  ['3 km is honoured', 3000, 3000],
  ['10 km CANNOT be requested -> 5 km', 10000, 5000],
  ['25 km CANNOT be requested -> 5 km', 25000, 5000],
  ['1000 km collapses to 5 km', 1000000, 5000],
  ['5001 m collapses to 5 km', 5001, 5000],
  ['0 m rises to the 100 m floor', 0, 100],
  ['negative radius rises to the 100 m floor', -500, 100],
  ['1 m rises to the 100 m floor', 1, 100],
];
for (const [label, input, expected] of cases) {
  const got = await cap(input);
  assert(got === expected, `${label} (${input} -> ${got})`);
}
{
  const got = await cap(null);
  assert(got === 5000, `null radius defaults to 5 km (got ${got})`);
}
for (const special of ['NaN', 'Infinity', '-Infinity']) {
  const { rows } = await db.query(
    `select public.clamp_discovery_radius_m($1::double precision) as m`, [special],
  );
  assert(Number(rows[0].m) === 5000, `${special} radius falls back to 5 km (got ${rows[0].m})`);
}
{
  const { rows } = await db.query(
    `select max(public.clamp_discovery_radius_m(x)) as worst
       from unnest(array[
         1,50,100,999,1000,3000,4999,5000,5001,10000,25000,1000000,
         'NaN'::double precision,'Infinity'::double precision,'-Infinity'::double precision
       ]) as x`,
  );
  assert(Number(rows[0].worst) === 5000,
    `across 16 hostile/edge inputs the returned radius never exceeds 5000 m (max ${rows[0].worst})`);
}

// ---------------------------------------------------------------------------
// Reference semantics. This models what the LIVE function must do once the
// recipe is applied. It is a specification test, NOT a test of the live RPC.
// ---------------------------------------------------------------------------
section('[3] Required discovery semantics (reference query, NOT the live RPC)');
await db.exec(`
  create table intents (
    id int primary key, user_id int, mode text, intent text,
    expires_at timestamptz, is_paused boolean, distance_m double precision
  );
  insert into intents values
    (1, 20, 'social',  'Coffee', now() + interval '1 hour', false, 400),
    (2, 30, 'private', 'Chill',  now() + interval '1 hour', false, 4800),
    (3, 40, 'social',  'Coffee', now() - interval '1 hour', false, 100),  -- expired
    (4, 50, 'social',  'Coffee', now() + interval '1 hour', true,  100),  -- paused
    (5, 99, 'social',  'Coffee', now() + interval '1 hour', false, 300),  -- the caller
    (6, 60, 'private', 'Chill',  now() + interval '1 hour', false, 9000), -- beyond 5 km
    (7, 70, 'social',  'Coffee', now() + interval '1 hour', false, 12000);-- beyond 10 km
`);

const discover = async ({ radius, mode = null, callerId = 99 } = {}) => {
  const { rows } = await db.query(
    `select i.id from intents i
      where i.user_id <> $2
        and i.expires_at > now()
        and coalesce(i.is_paused, false) = false
        and ($3::text is null or lower(i.mode) = lower($3))
        and i.distance_m <= public.clamp_discovery_radius_m($1)
      order by i.distance_m`,
    [radius, callerId, mode],
  );
  return rows.map((r) => r.id);
};

assert(JSON.stringify(await discover({ radius: 5000 })) === JSON.stringify([1, 2]),
  'at 5 km only the two live, unpaused, not-own intents are returned');
assert(JSON.stringify(await discover({ radius: 10000 })) === JSON.stringify([1, 2]),
  'requesting 10 km returns exactly the same 5 km result set');
assert(JSON.stringify(await discover({ radius: 25000 })) === JSON.stringify([1, 2]),
  'requesting 25 km returns exactly the same 5 km result set');
assert(JSON.stringify(await discover({ radius: 1000 })) === JSON.stringify([1]),
  'requesting 1 km genuinely narrows the result set');
assert(JSON.stringify(await discover({ radius: 3000 })) === JSON.stringify([1]),
  'requesting 3 km genuinely narrows the result set');
assert(!(await discover({ radius: 5000 })).includes(3), 'the expired intent is never returned');
assert(!(await discover({ radius: 5000 })).includes(4), 'the paused intent is never returned');
assert(!(await discover({ radius: 5000 })).includes(5), "the caller's own intent is never returned");
assert(!(await discover({ radius: 25000 })).includes(6),
  'an intent at 9 km is still excluded when 25 km is requested');
assert(!(await discover({ radius: 25000 })).includes(7),
  'an intent at 12 km is still excluded when 25 km is requested');
assert(JSON.stringify(await discover({ radius: 5000, mode: 'private' })) === JSON.stringify([2]),
  'the mode filter works (private only)');
assert(JSON.stringify(await discover({ radius: 5000, mode: 'social' })) === JSON.stringify([1]),
  'the mode filter works (social only)');
{
  const { rows } = await db.query(
    `select max(i.distance_m) as worst from intents i
      where i.distance_m <= public.clamp_discovery_radius_m(25000)`,
  );
  assert(Number(rows[0].worst) <= 5000,
    `nothing further than 5 km survives a 25 km request (worst ${rows[0].worst} m)`);
}

console.log('');
if (failures > 0) {
  console.error(`DISCOVERY RADIUS TESTS: ${failures} FAILED`);
  process.exitCode = 1;
} else {
  console.log('DISCOVERY RADIUS TESTS: ALL PASSED');
  console.log('  (live RPC NOT executed \u2014 see supabase/pending/ for the operator step)');
}
