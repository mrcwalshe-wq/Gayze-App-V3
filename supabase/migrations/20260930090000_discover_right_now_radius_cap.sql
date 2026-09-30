-- ============================================================================
-- GAYZE — cap the Right Now discovery radius at 5 km (public wrapper only)
-- ============================================================================
-- Live definition this migration was written against (retrieved from project
-- qdewyupsqmtonkloqxsh and confirmed by the operator):
--
--   public.discover_right_now(
--     p_radius_m integer DEFAULT 5000,
--     p_mode     text    DEFAULT NULL,
--     p_intent   text    DEFAULT NULL
--   )
--   LANGUAGE sql, SECURITY DEFINER, VOLATILE, OWNER postgres
--   SET search_path TO 'public', 'private'
--   body:  select *
--          from private.discover_right_now(p_radius_m, p_mode, p_intent);
--
-- WHY THIS MIGRATION IS DYNAMIC RATHER THAN A PLAIN create or replace
-- --------------------------------------------------------------------
-- `create or replace function` must restate the RETURNS clause, and Postgres
-- refuses to change a function's return type. The exact RETURNS clause of the
-- live wrapper was not captured (a function declared `RETURNS TABLE(...)`
-- creates NO named composite type, so `returns setof private.discover_right_now`
-- is not valid SQL — verified). Restating it from documentation would be a
-- guess, and a wrong guess either fails or, worse, forks the return shape.
--
-- Instead this block reads the LIVE definition with pg_get_functiondef() and
-- re-executes it verbatim with exactly one substring swapped. That makes it
-- impossible to alter the signature, return shape, language, security mode,
-- volatility, search_path or owner, because none of them are restated by hand.
--
-- It refuses to run unless the live function matches what was inspected.
-- private.discover_right_now is never touched.
-- ============================================================================

do $migration$
declare
  v_oid       oid;
  v_def       text;
  v_language  text;
  v_secdef    boolean;
  v_volatile  "char";
  v_config    text[];
  v_calls     int;
  v_owner     name;

  -- The exact call expression as it appears in the live body.
  c_original  constant text :=
    'private.discover_right_now(p_radius_m, p_mode, p_intent)';

  -- The same call with the radius clamped to the 5 km product ceiling.
  --
  -- The NULL branch is explicit and deliberate. Postgres least()/greatest()
  -- IGNORE nulls, so least(greatest(p_radius_m, 0), 5000) turns a NULL radius
  -- into 0 rather than leaving it NULL (verified: returns 0). Radius 0 would
  -- match intents at exactly distance 0, which the current production function
  -- does not do. Guarding the NULL case keeps that behaviour identical.
  c_capped    constant text :=
    'private.discover_right_now('
    || 'case when p_radius_m is null then null '
    || 'else least(greatest(p_radius_m, 0), 5000) end, '
    || 'p_mode, p_intent)';
begin
  --------------------------------------------------------------------------
  -- Pre-flight: confirm the target is the function this change was written for
  --------------------------------------------------------------------------
  begin
    v_oid := 'public.discover_right_now(integer, text, text)'::regprocedure;
  exception when undefined_function then
    raise exception
      'ABORT: public.discover_right_now(integer, text, text) does not exist here. '
      'Nothing was changed.';
  end;

  select l.lanname, p.prosecdef, p.provolatile, p.proconfig, r.rolname
    into v_language, v_secdef, v_volatile, v_config, v_owner
  from   pg_proc p
  join   pg_language l on l.oid = p.prolang
  left   join pg_roles r on r.oid = p.proowner
  where  p.oid = v_oid;

  if v_language is distinct from 'sql' then
    raise exception 'ABORT: live language is "%", expected "sql". Nothing was changed.', v_language;
  end if;

  if v_secdef is distinct from true then
    raise exception 'ABORT: live function is not SECURITY DEFINER. Nothing was changed.';
  end if;

  -- 'v' = VOLATILE. Preserved deliberately; changing volatility is not this
  -- migration's job even though STABLE would read more naturally.
  if v_volatile is distinct from 'v' then
    raise exception
      'ABORT: live volatility is "%", expected "v" (VOLATILE). Nothing was changed.', v_volatile;
  end if;

  if v_config is distinct from array['search_path=public, private'] then
    raise exception
      'ABORT: live search_path is %, expected {"search_path=public, private"}. '
      'Nothing was changed.', coalesce(array_to_string(v_config, ', '), 'NULL');
  end if;

  v_def := pg_get_functiondef(v_oid);

  --------------------------------------------------------------------------
  -- Idempotency: already capped? Then this is a no-op, not an error.
  --------------------------------------------------------------------------
  if position('least(greatest(p_radius_m, 0), 5000)' in v_def) > 0 then
    raise notice
      'public.discover_right_now is already radius-capped; nothing to do.';
    return;
  end if;

  --------------------------------------------------------------------------
  -- The body must contain the pass-through call exactly once
  --------------------------------------------------------------------------
  v_calls := (length(v_def) - length(replace(v_def, c_original, ''))) / length(c_original);

  if v_calls <> 1 then
    raise exception
      'ABORT: expected exactly 1 occurrence of "%" in the live body, found %. '
      'The function has drifted since inspection. Nothing was changed.',
      c_original, v_calls;
  end if;

  --------------------------------------------------------------------------
  -- Apply: the live definition, re-executed with only that call rewritten
  --------------------------------------------------------------------------
  execute replace(v_def, c_original, c_capped);

  raise notice
    'public.discover_right_now radius capped to 0..5000 m (owner %, search_path %, %).',
    v_owner, array_to_string(v_config, ', '),
    case v_volatile when 'v' then 'VOLATILE' when 's' then 'STABLE' else 'IMMUTABLE' end;
end
$migration$;


-- ----------------------------------------------------------------------------
-- Post-apply verification (run manually; nothing here is required to apply)
-- ----------------------------------------------------------------------------
--   select prosecdef, provolatile, proconfig,
--          pg_get_function_arguments(oid) as args,
--          pg_get_function_result(oid)    as result_type,
--          coalesce(array_to_string(proacl, E'\n'),
--                   array_to_string(acldefault('f', proowner), E'\n')) as privileges,
--          pg_get_functiondef(oid)        as definition
--   from   pg_proc
--   where  oid = 'public.discover_right_now(integer, text, text)'::regprocedure;
--
--   -- 10 km and 25 km must now be indistinguishable from 5 km:
--   select (select count(*) from public.discover_right_now(5000))  as r5k,
--          (select count(*) from public.discover_right_now(10000)) as r10k,
--          (select count(*) from public.discover_right_now(25000)) as r25k;
--
--   -- Nothing may be further than 5 km:
--   select max(distance_m) as worst_m from public.discover_right_now(25000);
