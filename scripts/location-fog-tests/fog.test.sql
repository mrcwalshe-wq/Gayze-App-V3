-- Tests for 20261107120000_location_fog_coords.sql on plain PostgreSQL.
-- Run via scripts/location-fog-tests/fog.test.mjs. Any failed check raises.
\set ON_ERROR_STOP on
\set QUIET on

do $$ begin
  if not exists (select 1 from pg_roles where rolname = 'anon') then create role anon nologin; end if;
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then create role authenticated nologin; end if;
end $$;

-- Worst case: API roles can already use the private schema, so only the
-- object-level revokes in the migration protect the secret and the function.
create schema if not exists private;
grant usage on schema private to anon, authenticated;

\i supabase/migrations/20261107120000_location_fog_coords.sql

create temp table results (name text, ok boolean, detail text);

-- Great-circle distance in metres (haversine), for assertions only.
create function pg_temp.hav(lat1 float8, lng1 float8, lat2 float8, lng2 float8) returns float8
language sql immutable as $$
  select 2 * 6371000 * asin(sqrt(
    sin(radians(lat2 - lat1) / 2) ^ 2 +
    cos(radians(lat1)) * cos(radians(lat2)) * sin(radians(lng2 - lng1) / 2) ^ 2))
$$;

-- 1. Deterministic: same input, same output.
insert into results
select 'deterministic', a.lat = b.lat and a.lng = b.lng, a.lat || ',' || a.lng
from private.fog_snap_coords(53.4808, -2.2426, '00000000-0000-0000-0000-000000000001', 500) a,
     private.fog_snap_coords(53.4808, -2.2426, '00000000-0000-0000-0000-000000000001', 500) b;

-- 2. Idempotent: snapping a snapped point changes nothing.
insert into results
select 'idempotent', s2.lat = s1.lat and s2.lng = s1.lng, ''
from private.fog_snap_coords(53.4808, -2.2426, '00000000-0000-0000-0000-000000000001', 500) s1,
     private.fog_snap_coords(s1.lat, s1.lng, '00000000-0000-0000-0000-000000000001', 500) s2;

-- 3. Accuracy bound: output is never further than the half-diagonal of a cell
--    (0.7072 x cell) from the input, for 5,000 random points around Manchester.
insert into results
select 'within one cell half-diagonal (500 m)', max(d) <= 500 * 0.7072 + 1, 'max ' || round(max(d)::numeric, 1) || ' m'
from (
  select pg_temp.hav(p.lat, p.lng, s.lat, s.lng) as d
  from (select 53.40 + random() * 0.15 as lat, -2.35 + random() * 0.25 as lng from generate_series(1, 5000)) p,
       lateral private.fog_snap_coords(p.lat, p.lng, '00000000-0000-0000-0000-000000000002', 500) s
) x;

-- 4. Same for the 1000 m neighbourhood cell.
insert into results
select 'within one cell half-diagonal (1000 m)', max(d) <= 1000 * 0.7072 + 1, 'max ' || round(max(d)::numeric, 1) || ' m'
from (
  select pg_temp.hav(p.lat, p.lng, s.lat, s.lng) as d
  from (select 53.40 + random() * 0.15 as lat, -2.35 + random() * 0.25 as lng from generate_series(1, 5000)) p,
       lateral private.fog_snap_coords(p.lat, p.lng, '00000000-0000-0000-0000-000000000002', 1000) s
) x;

-- 5. The attack this replaces. Publishing the SAME exact position 500 times
--    (a stationary member whose app re-saves it) yields exactly one stored point,
--    so averaging gains nothing.
insert into results
select 'repeat publishes of one position -> 1 stored point', count(distinct (s.lat, s.lng)) = 1, count(distinct (s.lat, s.lng)) || ' distinct'
from generate_series(1, 500) g,
     lateral private.fog_snap_coords(53.4808, -2.2426, '00000000-0000-0000-0000-000000000003', 500) s;

-- 6. GPS noise of +/-10 m around one spot gives at most 4 stored points (a cell
--    corner), never a spread that an average could sharpen.
insert into results
select 'GPS noise +/-10 m -> at most 4 stored points', count(distinct (s.lat, s.lng)) <= 4, count(distinct (s.lat, s.lng)) || ' distinct'
from generate_series(1, 500) g,
     lateral private.fog_snap_coords(
       53.4808 + (random() - 0.5) * 20 / 111320.0,
       -2.2426 + (random() - 0.5) * 20 / (111320.0 * cos(radians(53.4808))),
       '00000000-0000-0000-0000-000000000003', 500) s;

-- 7. The mean of snapped points from a random walk is not closer to the truth
--    than one cell: nothing to recover below cell resolution.
insert into results
select 'mean of 2,000 jittered snaps stays within one cell of truth',
       pg_temp.hav(53.4808, -2.2426, avg(s.lat), avg(s.lng)) <= 500,
       'error ' || round(pg_temp.hav(53.4808, -2.2426, avg(s.lat), avg(s.lng))::numeric, 1) || ' m'
from generate_series(1, 2000) g,
     lateral private.fog_snap_coords(
       53.4808 + (random() - 0.5) * 1000 / 111320.0,
       -2.2426 + (random() - 0.5) * 1000 / (111320.0 * cos(radians(53.4808))),
       '00000000-0000-0000-0000-000000000003', 500) s;

-- 8. Different members get different grids, so cell edges are not shared.
insert into results
select 'different members -> different grids',
       count(distinct (s.lat, s.lng)) >= 5, count(distinct (s.lat, s.lng)) || ' distinct of 20'
from generate_series(1, 20) g,
     lateral private.fog_snap_coords(53.4808, -2.2426, ('00000000-0000-0000-0000-0000000001' || lpad(g::text, 2, '0'))::uuid, 500) s;

-- 9. Rotating the secret re-draws the grid.
do $$
declare a record; b record;
begin
  select * into a from private.fog_snap_coords(53.4808, -2.2426, '00000000-0000-0000-0000-000000000004', 500);
  update private.fog_secret set secret = secret || 'x' where id;
  select * into b from private.fog_snap_coords(53.4808, -2.2426, '00000000-0000-0000-0000-000000000004', 500);
  insert into results values ('secret rotation changes the grid', (a.lat, a.lng) is distinct from (b.lat, b.lng), '');
  update private.fog_secret set secret = left(secret, length(secret) - 1) where id;
end $$;

-- 10. Bad input returns nothing rather than a wrong point.
insert into results
select 'null and NaN input return no row',
       (select count(*) from private.fog_snap_coords(null, 1, '00000000-0000-0000-0000-000000000005')) = 0
       and (select count(*) from private.fog_snap_coords('NaN'::float8, 1, '00000000-0000-0000-0000-000000000005')) = 0, '';

-- 11. Southern-hemisphere and antimeridian inputs stay valid.
insert into results
select 'valid output at extreme coordinates',
       bool_and(s.lat between -90 and 90 and s.lng between -180 and 180), ''
from (values (-33.86, 151.21), (64.14, -21.94), (0.0, 179.999), (0.0, -179.999), (89.9, 10.0)) v(la, lo),
     lateral private.fog_snap_coords(v.la, v.lo, '00000000-0000-0000-0000-000000000006', 500) s;

-- 12. The API roles cannot read the secret or call the function.
do $$
declare ok boolean := true; detail text := '';
begin
  begin set local role authenticated; perform secret from private.fog_secret; ok := false; detail := 'read secret';
  exception when others then null; end;
  reset role;
  begin set local role anon; perform * from private.fog_snap_coords(1, 1, '00000000-0000-0000-0000-000000000007'); ok := false; detail := detail || ' call fn';
  exception when others then null; end;
  reset role;
  insert into results values ('API roles locked out of secret and function', ok, detail);
end $$;

\echo
select case when ok then 'PASS' else 'FAIL' end as status, name, detail from results order by ok, name;

do $$ begin
  if exists (select 1 from results where not ok) then raise exception 'location fog tests failed'; end if;
end $$;
