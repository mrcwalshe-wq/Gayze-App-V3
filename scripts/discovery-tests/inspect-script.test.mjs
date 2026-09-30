/**
 * Proves that supabase/pending/inspect_discover_right_now.sql is valid SQL by
 * running every block against realistic stand-in functions in real Postgres
 * (PGlite).
 *
 * This does NOT touch any live database. It exists so the inspection script
 * handed to an operator is known-good rather than assumed-good.
 *
 * Two stand-ins are used deliberately:
 *   * public.discover_right_now  - LANGUAGE plpgsql, like the likely production
 *     function. Demonstrates that Query 6 legitimately returns nothing.
 *   * public.sql_lang_probe      - LANGUAGE sql with the same shape, to prove
 *     Query 6 actually works when the body is parsed at CREATE time.
 *
 * Run: node scripts/discovery-tests/inspect-script.test.mjs
 */
import { PGlite } from '@electric-sql/pglite';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

const REPO = fileURLToPath(new URL('../..', import.meta.url)).replace(/\/$/, '');
const SCRIPT = `${REPO}/supabase/pending/inspect_discover_right_now.sql`;
const sqlText = fs.readFileSync(SCRIPT, 'utf8');

let failures = 0;
const assert = (cond, msg) => {
  if (!cond) { console.error('  \u2717 FAIL:', msg); failures += 1; process.exitCode = 1; }
  else console.log('  \u2713', msg);
};
const section = (t) => console.log(`\n=== ${t} ===`);

/** Comments removed, so only executable SQL is analysed. */
function stripComments(source) {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:])--.*$/gm, '$1');
}

function statementsOf(source) {
  return stripComments(source)
    .split(';')
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

// ---------------------------------------------------------------------------
section('[0] The script is READ-ONLY');
const statements = statementsOf(sqlText);
{
  const WRITE = /^(create|alter|drop|insert|update|delete|truncate|grant|revoke|comment|do|call|copy|vacuum|analyze|refresh|reset|execute|prepare|deallocate|listen|notify|unlisten|begin|commit|rollback|savepoint|lock|security|reassign|discard|import|cluster|reindex)\b/i;
  const writers = statements.filter((s) => WRITE.test(s));
  assert(writers.length === 0,
    `no statement begins with a write/DDL/transaction keyword (${statements.length} statements checked)`);
}
{
  const nonSelect = statements.filter((s) => !/^(select|with)\b/i.test(s));
  assert(nonSelect.length === 0,
    `every statement starts with SELECT or WITH (offenders: ${nonSelect.length})`);
}
assert(statements.length === 8, `the script has exactly 8 blocks (got ${statements.length})`);
assert(!/\bset\b\s+(?!search_path)/i.test(stripComments(sqlText).replace(/setconfig|setprocid|setrole|setdatabase|offset/g, '')),
  'no SET statement appears in the executable SQL');

// ---------------------------------------------------------------------------
section('[1] Build stand-ins and run every query');
const db = new PGlite();
await db.exec(`
  create role anon nologin;
  create role authenticated nologin;
  create table profiles (id int primary key, display_name text, location text);
  create table intents (
    id int primary key, user_id int, mode text, intent text,
    expires_at timestamptz, is_paused boolean
  );
  create or replace function public.discover_right_now(
    p_radius_m double precision default 5000,
    p_mode     text             default null,
    p_intent   text             default null
  )
  returns table (
    intent_id    int,
    user_id      int,
    display_name text,
    mode         text,
    expires_at   timestamptz,
    distance_m   double precision
  )
  language plpgsql
  stable
  security definer
  set search_path = public, extensions
  as $$
  begin
    return query
      select i.id, i.user_id, pr.display_name, i.mode, i.expires_at, 0::float8
      from intents i join profiles pr on pr.id = i.user_id
      where i.expires_at > now() and coalesce(i.is_paused,false) = false;
  end;
  $$;
  revoke all on function public.discover_right_now(double precision, text, text) from public;
  grant execute on function public.discover_right_now(double precision, text, text) to authenticated;
  comment on function public.discover_right_now(double precision, text, text) is 'stand-in';

  -- Same shape, but LANGUAGE sql so the body IS parsed and pg_depend is populated.
  create or replace function public.sql_lang_probe(p_radius_m double precision default 5000)
  returns table (intent_id int, distance_m double precision)
  language sql stable security definer set search_path = public
  as $$ select i.id, 0::float8 from public.intents i $$;
`);

const labels = [
  'Q1 locate + overloads',
  'Q2 full pg_get_functiondef',
  'Q3 structured metadata',
  'Q4 per-argument rows',
  'Q5 search_path / settings',
  'Q6 dependencies',
  'Q7 execute privilege',
  'Q8 chunked body fallback',
];

let q2 = null;
for (let i = 0; i < statements.length; i += 1) {
  const label = labels[i] || `statement ${i + 1}`;
  try {
    const res = await db.query(statements[i]);
    const rows = res.rows || [];
    assert(true, `${label} executed (${rows.length} row(s))`);

    if (i === 0) {
      assert(rows.length === 1 && rows[0].function_name === 'discover_right_now',
        'Q1 finds exactly the one function');
      assert(rows[0].identity_arguments === 'p_radius_m double precision, p_mode text, p_intent text',
        `Q1 reports identity arguments WITH names (${rows[0].identity_arguments})`);
      assert(rows[0].kind === 'f' && rows[0].returns_setof === true,
        'Q1 reports kind=f and returns_setof=true');
    }
    if (i === 1) {
      q2 = rows[0]?.definition || '';
      assert(q2.includes('CREATE OR REPLACE FUNCTION public.discover_right_now'),
        'Q2 returns the CREATE statement');
      assert(/SECURITY DEFINER/i.test(q2), 'Q2 shows SECURITY DEFINER');
      assert(/search_path/i.test(q2), 'Q2 shows the search_path clause');
      assert(/p_radius_m double precision DEFAULT 5000/i.test(q2),
        'Q2 shows argument names, types AND defaults');
      assert(/GRANT/i.test(q2) === false,
        'Q2 correctly does NOT contain GRANTs (privileges come from Q3)');
      assert(/RETURNS TABLE/i.test(q2), 'Q2 shows the RETURNS TABLE shape');
    }
    if (i === 2) {
      const r = rows[0];
      assert(r.security === 'SECURITY DEFINER', `Q3 security = ${r.security}`);
      assert(r.volatility === 'STABLE', `Q3 volatility = ${r.volatility}`);
      assert(r.language === 'plpgsql', `Q3 language = ${r.language}`);
      assert(JSON.stringify(r.function_config).includes('search_path'),
        `Q3 function_config carries search_path (${JSON.stringify(r.function_config)})`);
      assert(/authenticated/.test(r.effective_privileges || ''),
        'Q3 effective_privileges lists the authenticated grant');
      assert(/=X\/postgres/.test(r.effective_privileges || ''),
        'Q3 effective_privileges shows public has no EXECUTE');
      assert(r.result_type.startsWith('TABLE('), `Q3 result_type = ${r.result_type}`);
      assert(r.comment === 'stand-in', `Q3 surfaces the function COMMENT (${r.comment})`);
    }
    if (i === 3) {
      assert(rows.length === 9, `Q4 returns one row per argument incl. returned columns (got ${rows.length})`);
      assert(rows[0].argument_name === 'p_radius_m' && rows[0].mode === 'IN',
        `Q4 first argument is ${rows[0].argument_name} ${rows[0].mode} ${rows[0].data_type}`);
      const ins = rows.filter((r) => r.mode === 'IN');
      const tables = rows.filter((r) => r.mode === 'TABLE');
      assert(ins.length === 3, `Q4 marks the 3 inputs as IN (got ${ins.length})`);
      assert(tables.length === 6, `Q4 marks the 6 RETURNS TABLE columns as TABLE (got ${tables.length})`);
      assert(tables.map((r) => r.argument_name).join(',') ===
        'intent_id,user_id,display_name,mode,expires_at,distance_m',
        'Q4 names the returned columns in order');
    }
    if (i === 4) {
      const fn = rows.find((r) => r.scope === 'function');
      assert(Boolean(fn), 'Q5 returns the function-scoped settings row');
      assert(JSON.stringify(fn.settings).includes('search_path'),
        `Q5 reports the function search_path (${JSON.stringify(fn.settings)})`);
    }
    if (i === 5) {
      // pg_depend records nothing for function bodies, so Q6 is a text scan.
      const found = rows.map((r) => r.referenced_candidate);
      assert(found.includes('intents') && found.includes('profiles'),
        `Q6 text scan finds the tables the plpgsql body reads (${found.join(', ') || 'none'})`);
    }
    if (i === 6) {
      assert(typeof rows[0].can_execute_3arg_form === 'boolean',
        `Q7 returns a boolean (running_as=${rows[0].running_as}, can_execute=${rows[0].can_execute_3arg_form})`);
    }
    if (i === 7) {
      const joined = rows.map((r) => r.part).join('');
      assert(rows[0].chunks_total >= 1, `Q8 reports chunks_total=${rows[0].chunks_total}`);
      assert(joined === q2, 'Q8 chunks reassemble EXACTLY into the Query 2 definition');
      assert(joined.length === rows[0].total_chars,
        `Q8 loses no characters (${joined.length} of ${rows[0].total_chars})`);
    }
  } catch (err) {
    assert(false, `${label} FAILED: ${err.message.split('\n')[0]}`);
  }
}

// ---------------------------------------------------------------------------
section('[2] Query 6 also resolves schema-qualified references');
{
  const probe = statements[5].replace(/discover_right_now/g, 'sql_lang_probe');
  const res = await db.query(probe);
  const names = res.rows.map((r) => r.referenced_candidate);
  assert(names.includes('public.intents'),
    `Q6 keeps the schema qualifier where the body used one (${names.join(', ') || 'none'})`);
}

section('[2b] pg_depend really is useless here (why Q6 is a text scan)');
{
  const res = await db.query(`
    select count(*) as table_deps
    from   pg_depend d
    join   pg_proc p      on p.oid  = d.objid
    join   pg_namespace n on n.oid  = p.pronamespace
    join   pg_class dc    on dc.oid = d.refobjid
    where  n.nspname = 'public' and p.proname = 'sql_lang_probe'`);
  assert(Number(res.rows[0].table_deps) === 0,
    'pg_depend records 0 table dependencies even for a LANGUAGE sql function');
}

section('[3] Chunking survives a body longer than one chunk');
{
  await db.exec(`
    create or replace function public.discover_right_now(
      p_radius_m double precision default 5000,
      p_mode text default null, p_intent text default null
    )
    returns table (intent_id int, user_id int, display_name text, mode text,
                   expires_at timestamptz, distance_m double precision)
    language plpgsql stable security definer set search_path = public, extensions
    as $fn$
    begin
      -- ${'padding to push this body past the 4000 character chunk boundary. '.repeat(120)}
      return query select i.id, i.user_id, pr.display_name, i.mode, i.expires_at, 0::float8
        from intents i join profiles pr on pr.id = i.user_id;
    end;
    $fn$;
  `);
  const defRes = await db.query(statements[1]);
  const longDef = defRes.rows[0].definition;
  const chunkRes = await db.query(statements[7]);
  const joined = chunkRes.rows.map((r) => r.part).join('');
  assert(chunkRes.rows.length > 1, `the long body produced ${chunkRes.rows.length} chunks`);
  assert(joined === longDef, 'multi-chunk output still reassembles exactly');
  assert(joined.length === chunkRes.rows[0].total_chars,
    `no characters lost across chunks (${joined.length} of ${chunkRes.rows[0].total_chars})`);
}

console.log('');
if (failures > 0) {
  console.error(`INSPECT-SCRIPT TESTS: ${failures} FAILED`);
  process.exitCode = 1;
} else {
  console.log('INSPECT-SCRIPT TESTS: ALL PASSED');
  console.log('  (validated against stand-ins in PGlite \u2014 NOT against the live project)');
}
