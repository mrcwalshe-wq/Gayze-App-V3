-- GAYZE discovery radius ceiling — ADDITIVE ONLY.
--
-- This migration is deliberately safe to apply blind. It creates ONE new
-- function and touches nothing that already exists:
--
--   * it does NOT create, replace or drop public.discover_right_now
--   * it does NOT revoke or grant on any existing object
--   * it does NOT alter any table, policy or view
--
-- Why: the live DDL of public.discover_right_now is NOT checked into this
-- repository, and re-creating it from docs/BACKEND_REQUIREMENTS.md would risk
-- silently dropping production behaviour (privacy jitter, reliability columns,
-- ordering, RLS interaction). Wiring the ceiling into the live function is a
-- separate, operator-reviewed step — see
-- supabase/pending/discover_right_now_radius_cap.recipe.sql.
--
-- Until that step is applied, the 5 km ceiling is enforced client-side only
-- (src/config/mapDefaults.ts, covered by scripts/discovery-tests and
-- scripts/interaction-tests).

create or replace function public.clamp_discovery_radius_m(p_radius_m double precision)
returns double precision
language sql
immutable
as $$
  -- Anything missing, non-finite, absurdly small or larger than the 5 km
  -- product ceiling collapses into the supported 100 m .. 5000 m range.
  -- 10 km and 25 km requests therefore yield 5 km, never wider.
  select least(
    greatest(
      case
        when p_radius_m is null or p_radius_m = 'NaN'::double precision
          or p_radius_m = 'Infinity'::double precision
          or p_radius_m = '-Infinity'::double precision
        then 5000::double precision
        else p_radius_m
      end,
      100::double precision
    ),
    5000::double precision
  );
$$;

comment on function public.clamp_discovery_radius_m(double precision) is
  'gayze-discovery: authoritative travel-distance ceiling (max 5 km, min 100 m). '
  'Pure helper - wired into the live discovery function by a separate reviewed change.';

-- New object only: grant to the roles that will call it once it is wired in.
revoke all on function public.clamp_discovery_radius_m(double precision) from public;
grant execute on function public.clamp_discovery_radius_m(double precision) to anon, authenticated;
