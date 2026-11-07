-- ============================================================================
-- GAYZE — server-side location fog, part 1 of 2: the snapping function
-- ============================================================================
-- WHY
-- ---
-- Until now the browser added random jitter to a member's position before
-- saving it (supabaseService.jitterLocation), and re-rolled it on every write.
-- The profile point is rewritten about every 20 m of movement, so each update
-- is a fresh random sample around the true position. Anyone who can read those
-- points over time can average them and recover the true location, and the
-- discovery function also returned an exact distance, which allows
-- trilateration. Jitter chosen by the client cannot be trusted or made stable.
--
-- WHAT THIS DOES
-- --------------
-- Replaces random jitter with deterministic grid snapping done in the
-- database:
--   * a grid of `cell_m` metres (default 500) is laid over the map;
--   * the grid is shifted by a per-member offset derived from a server-only
--     secret, so cell edges do not line up with anything an observer can
--     predict;
--   * a position is replaced by the CENTRE of its cell.
-- The result is stable: the same true position always gives the same stored
-- point, so repeated writes reveal nothing new, and averaging many writes
-- converges on the cell centre, not on the member. It is also idempotent
-- (snapping a snapped point returns the same point).
--
-- This file is pure SQL with no PostGIS dependency, so it can be tested on a
-- plain PostgreSQL (scripts/location-fog-tests). Part 2
-- (20261107120100_location_fog_apply.sql) wires it to geography columns.
-- ============================================================================

-- The private schema already exists in production; its privileges are left as they are.
-- Everything created below revokes API-role access on the object itself.
create schema if not exists private;

-- Single-row secret. Never readable by API roles. Rotating it re-draws every
-- member's grid offset (positions are re-snapped on their next write).
create table if not exists private.fog_secret (
  id         boolean primary key default true check (id),
  secret     text not null,
  created_at timestamptz not null default now()
);
revoke all on private.fog_secret from public, anon, authenticated;
alter table private.fog_secret enable row level security;

insert into private.fog_secret (id, secret)
values (true, replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', ''))
on conflict (id) do nothing;

-- Fraction in [0,1) derived from the secret, the member and a label.
create or replace function private.fog_fraction(p_secret text, p_user uuid, p_label text)
returns double precision
language sql
immutable
set search_path to 'pg_temp'
as $$
  select (hashtextextended(p_secret || ':' || p_user::text || ':' || p_label, 0) & 1048575)::double precision / 1048576.0;
$$;

-- Snap one coordinate pair to the centre of its cell.
create or replace function private.fog_snap_coords(
  p_lat double precision,
  p_lng double precision,
  p_user uuid,
  p_cell_m integer default 500
)
returns table (lat double precision, lng double precision)
language plpgsql
stable
security definer
set search_path to 'private', 'pg_temp'
as $$
declare
  v_secret   text;
  v_cell     double precision := greatest(100, least(coalesce(p_cell_m, 500), 5000));
  v_dlat     double precision;
  v_dlng     double precision;
  v_off_lat  double precision;
  v_off_lng  double precision;
  v_lat      double precision;
  v_lng      double precision;
  v_in_lat   double precision;
  v_in_lng   double precision;
begin
  if p_lat is null or p_lng is null or p_user is null
     or p_lat in ('NaN', 'Infinity', '-Infinity')
     or p_lng in ('NaN', 'Infinity', '-Infinity') then
    return;
  end if;

  select s.secret into v_secret from private.fog_secret s where s.id;
  if v_secret is null then
    raise exception 'fog secret is not configured';
  end if;

  -- Keep inside the range where metres-per-degree maths is sane.
  v_in_lat := greatest(-85.0, least(85.0, p_lat));
  v_in_lng := ((p_lng + 180.0)::numeric % 360.0)::double precision - 180.0;

  v_dlat    := v_cell / 111320.0;
  v_off_lat := private.fog_fraction(v_secret, p_user, 'lat') * v_dlat;
  v_lat     := (floor((v_in_lat + v_off_lat) / v_dlat) + 0.5) * v_dlat - v_off_lat;

  -- Longitude cell width depends on the snapped latitude, so it is the same
  -- for every point in the same latitude row.
  v_dlng    := v_cell / (111320.0 * cos(radians(v_lat)));
  v_off_lng := private.fog_fraction(v_secret, p_user, 'lng') * v_dlng;
  v_lng     := (floor((v_in_lng + v_off_lng) / v_dlng) + 0.5) * v_dlng - v_off_lng;

  lat := v_lat;
  lng := v_lng;
  return next;
end $$;

revoke all on function private.fog_fraction(text, uuid, text) from public, anon, authenticated;
revoke all on function private.fog_snap_coords(double precision, double precision, uuid, integer) from public, anon, authenticated;
