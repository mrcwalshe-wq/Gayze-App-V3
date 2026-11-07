-- ============================================================================
-- GAYZE — server-side location fog, part 2 of 2: apply it
-- ============================================================================
-- Requires 20261107120000_location_fog_coords.sql and PostGIS.
--
-- 1. Every write to public.intents.location and public.profiles.location is
--    snapped to a cell centre by a BEFORE trigger. Whatever a client sends
--    (including a modified client sending exact GPS), the database never
--    stores a more precise point than the cell.
-- 2. Existing rows are re-snapped, so earlier randomly-jittered history no
--    longer sits in the database.
-- 3. private.discover_right_now no longer returns a distance measured from
--    the intent to the intent OWNER'S profile point (which exposed a second,
--    moving position for that member and was not the viewer's distance at all).
--    It now returns the distance from the VIEWER to the intent, rounded to
--    250 m bands with a 250 m floor. Signature and columns are unchanged, and
--    the public wrapper (5 km radius cap) is untouched.
--
-- Cell size: 500 m, or 1000 m for members whose privacy setting is
-- 'neighborhood'.
-- ============================================================================

create or replace function private.fog_snap(
  p_loc geography,
  p_user uuid,
  p_cell_m integer default 500
)
returns geography
language sql
stable
security definer
set search_path to 'private', 'public', 'pg_temp'
as $$
  select case when p_loc is null then null else (
    select st_setsrid(st_makepoint(f.lng, f.lat), 4326)::geography
    from private.fog_snap_coords(st_y(p_loc::geometry), st_x(p_loc::geometry), p_user, p_cell_m) f
  ) end;
$$;
revoke all on function private.fog_snap(geography, uuid, integer) from public, anon, authenticated;

-- ---- intents ----------------------------------------------------------------
create or replace function private.fog_intent_location()
returns trigger
language plpgsql
security definer
set search_path to 'private', 'public', 'pg_temp'
as $$
declare
  v_setting text;
begin
  if new.location is not null then
    select p.privacy_setting into v_setting from public.profiles p where p.id = new.user_id;
    new.location := private.fog_snap(new.location, new.user_id, case when v_setting = 'neighborhood' then 1000 else 500 end);
  end if;
  return new;
end $$;
revoke all on function private.fog_intent_location() from public, anon, authenticated;

drop trigger if exists gayze_fog_intent_location on public.intents;
create trigger gayze_fog_intent_location
  before insert or update of location on public.intents
  for each row execute function private.fog_intent_location();

-- ---- profiles ---------------------------------------------------------------
create or replace function private.fog_profile_location()
returns trigger
language plpgsql
security definer
set search_path to 'private', 'public', 'pg_temp'
as $$
begin
  if new.location is not null then
    new.location := private.fog_snap(new.location, new.id, case when new.privacy_setting = 'neighborhood' then 1000 else 500 end);
  end if;
  return new;
end $$;
revoke all on function private.fog_profile_location() from public, anon, authenticated;

drop trigger if exists gayze_fog_profile_location on public.profiles;
create trigger gayze_fog_profile_location
  before insert or update of location on public.profiles
  for each row execute function private.fog_profile_location();

-- ---- re-snap what is already stored -------------------------------------------
update public.intents  set location = location where location is not null;
update public.profiles set location = location where location is not null;

-- ---- discovery: viewer-relative, banded distance ------------------------------
create or replace function private.discover_right_now(
  p_radius_m integer default 5000,
  p_mode text default null,
  p_intent text default null
)
returns table (
  intent_id uuid, user_id uuid, display_name text, age smallint, bio text,
  avatar_path text, neighborhood text, mode text, intent text, description text,
  expires_at timestamptz, distance_m double precision,
  map_lat double precision, map_lng double precision,
  reliability_score numeric, verified_peers_count integer, safety_verified boolean,
  travel_distance_label text, can_host text, travel_willingness text
)
language sql
security definer
set search_path to 'public', 'private'
as $$
  select i.id, p.id, p.display_name, p.age, p.bio, p.avatar_path, p.neighborhood,
    i.mode, i.intent, i.description, i.expires_at,
    greatest(250.0, round(st_distance(i.location, me.location) / 250.0) * 250.0)::double precision,
    st_y(i.location::geometry), st_x(i.location::geometry), p.reliability_score,
    p.verified_peers_count, p.safety_verified, i.travel_distance_label, i.can_host, i.travel_willingness
  from public.intents i
  join public.profiles p on p.id = i.user_id
  cross join lateral (select l.location from public.profiles l where l.id = (select auth.uid())) me
  where i.user_id <> (select auth.uid()) and i.is_paused = false and i.expires_at > now()
    and p.privacy_setting <> 'ghost' and (p_mode is null or i.mode = p_mode) and (p_intent is null or i.intent = p_intent)
    and i.location is not null
    and me.location is not null
    and st_dwithin(i.location, me.location, p_radius_m)
    and not exists (
      select 1 from public.blocks b
      where (b.blocker_id = (select auth.uid()) and b.blocked_id = p.id)
         or (b.blocker_id = p.id and b.blocked_id = (select auth.uid()))
    )
  order by i.expires_at asc;
$$;
