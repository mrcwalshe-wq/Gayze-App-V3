/**
 * GAYZE discovery radius ceiling — SQL regression test.
 *
 * Runs the REAL DDL from
 *   supabase/migrations/20260930090000_discover_right_now_radius_cap.sql
 * inside PGlite (a real Postgres) and asserts the 5 km ceiling is enforced
 * server-side, so a 10 km / 25 km request can never succeed.
 *
 * The full `discover_right_now` body needs PostGIS + the live schema, which do
 * not exist here, so that half is verified structurally (the cap is provably
 * wired into the query) and by testing its exclusion predicates against a
 * faithful, geometry-free reference query.
 *
 * Run: node scripts/discovery-tests/radius-cap.test.mjs
 */
import { PGlite } from '@electric-sql/pglite';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

const REPO = fileURLToPath(new URL('../..', import.meta.url)).replace(/\/$/, '');
const MIGRATION = `${REPO}/supabase/migrations/20260930090000_discover_right_now_radius_cap.sql`;
const sql = fs.readFileSync(MIGRATION, 'utf8');

let failures = 0;
const assert = (cond, msg) => {
  if (!cond) { console.error('  \u2717 FAIL:', msg); failures += 1; process.exitCode = 1; }
  else console.log('  \u2713', msg);
};
const section = (t) => console.log(`\n=== ${t} ===`);

/** Pull one `create or replace function ... $$ ... $$;` block out of the file. */
function extractFunction(source, name) {
  const start = source.indexOf(`create or replace function public.${name}(`);
  if (start === -1) throw new Error(`function ${name} not found in migration`);
  const end = source.indexOf('$$;', start);
  if (end === -1) throw new Error(`unterminated body for ${name}`);
  return source.slice(start, end + 3);
}

section('[1] The migration defines the ceiling and wires it into discovery');
const clampDdl = extractFunction(sql, 'clamp_discovery_radius_m');
assert(clampDdl.includes('least(') && clampDdl.includes('5000'),
  'clamp_discovery_radius_m caps at 5000 m');
const discoverDdl = extractFunction(sql, 'discover_right_now');
assert(discoverDdl.includes('public.clamp_discovery_radius_m(p_radius_m)'),
  'discover_right_now passes its radius through the clamp');
assert(discoverDdl.includes('cap.radius_m'),
  'the distance predicate uses the CLAMPED radius, not the raw argument');
assert(!/st_dwithin\([^)]*p_radius_m/.test(discoverDdl),
  'the raw p_radius_m is never used directly in the distance predicate');
assert(discoverDdl.includes('i.expires_at > now()'), 'expired intents are excluded');
assert(discoverDdl.includes("coalesce(i.is_paused, false) = false"), 'paused intents are excluded');
assert(discoverDdl.includes('i.user_id <> c.uid'), "the caller's own row is excluded");
assert(/grant execute on function public\.discover_right_now[^;]*to authenticated;/.test(sql),
  'only authenticated callers can execute discovery');

section('[2] The real clamp DDL enforces max 5 km (run in Postgres)');
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

section('[3] Discovery exclusion predicates (reference query over real Postgres)');
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

console.log('');
if (failures > 0) {
  console.error(`DISCOVERY RADIUS TESTS: ${failures} FAILED`);
  process.exitCode = 1;
} else {
  console.log('DISCOVERY RADIUS TESTS: ALL PASSED');
}
