-- GAYZE discovery radius ceiling.
--
-- Product rule: Right Now discovery never looks further than 5 km. The client
-- already clamps its own request, but a client-side limit is not a security or
-- product boundary — anyone can call the RPC directly. This migration makes the
-- ceiling authoritative on the server.
--
-- The clamp lives in its own immutable function so it can be unit-tested
-- (scripts/discovery-tests/radius-cap.test.mjs runs the DDL below verbatim) and
-- so the discovery query stays readable.
--
-- REVIEW BEFORE APPLYING: this file re-creates `public.discover_right_now`,
-- whose existing DDL is not checked into this repository. The signature and the
-- returned columns follow docs/BACKEND_REQUIREMENTS.md §2. Diff against the
-- live function (`\sf+ public.discover_right_now`) before running it.

create or replace function public.clamp_discovery_radius_m(p_radius_m double precision)
returns double precision
language sql
immutable
as $$
  -- Anything missing, non-finite, absurdly small or larger than the 5 km
  -- product ceiling collapses into the supported 100 m .. 5000 m range.
  -- 10 km and 25 km requests therefore return 5 km results, never wider.
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
  'gayze-discovery: authoritative travel-distance ceiling (max 5 km, min 100 m).';

revoke all on function public.clamp_discovery_radius_m(double precision) from public;
grant execute on function public.clamp_discovery_radius_m(double precision) to anon, authenticated;


create or replace function public.discover_right_now(
  p_radius_m double precision default 5000,
  p_mode text default null,
  p_intent text default null
)
returns table (
  intent_id uuid,
  user_id uuid,
  display_name text,
  age integer,
  bio text,
  avatar_path text,
  neighborhood text,
  mode text,
  intent text,
  description text,
  expires_at timestamptz,
  distance_m double precision,
  map_lat double precision,
  map_lng double precision,
  reliability_score integer,
  verified_peers_count integer,
  safety_verified boolean,
  travel_distance_label text,
  can_host text,
  travel_willingness text
)
language sql
stable
security definer
set search_path = public, extensions
as $$
  with caller as (
    select
      auth.uid() as uid,
      p.location as loc
    from public.profiles p
    where p.id = auth.uid()
  ),
  -- The ceiling is applied once, here, before any row is measured.
  capped as (
    select public.clamp_discovery_radius_m(p_radius_m) as radius_m
  )
  select
    i.id                                    as intent_id,
    i.user_id                               as user_id,
    pr.display_name                         as display_name,
    pr.age                                  as age,
    pr.bio                                  as bio,
    pr.avatar_path                          as avatar_path,
    i.area                                  as neighborhood,
    i.mode                                  as mode,
    i.intent                                as intent,
    i.description                           as description,
    i.expires_at                            as expires_at,
    extensions.st_distance(
      pr.location::extensions.geography, i.location::extensions.geography
    )                                       as distance_m,
    extensions.st_y(
      extensions.st_transform(i.location, 4326)
    )                                       as map_lat,
    extensions.st_x(
      extensions.st_transform(i.location, 4326)
    )                                       as map_lng,
    coalesce(pr.reliability_score, 0)       as reliability_score,
    coalesce(pr.verified_peers_count, 0)    as verified_peers_count,
    coalesce(pr.safety_verified, false)     as safety_verified,
    i.travel_distance_label                 as travel_distance_label,
    i.can_host                              as can_host,
    i.travel_willingness                    as travel_willingness
  from public.intents i
  join public.profiles pr on pr.id = i.user_id
  cross join caller c
  cross join capped cap
  where c.uid is not null
    and c.loc is not null
    and i.location is not null
    and pr.location is not null
    -- Never return the caller's own row (the client filters it too).
    and i.user_id <> c.uid
    -- Expired and paused intents are never discoverable.
    and i.expires_at > now()
    and coalesce(i.is_paused, false) = false
    -- Optional mode / intent filters.
    and (p_mode is null or lower(i.mode) = lower(p_mode))
    and (p_intent is null or lower(i.intent) = lower(p_intent))
    -- THE CEILING: measured distance must fall inside the capped radius.
    and extensions.st_dwithin(
      pr.location::extensions.geography,
      i.location::extensions.geography,
      cap.radius_m
    )
  order by distance_m asc, i.expires_at asc;
$$;

comment on function public.discover_right_now(double precision, text, text) is
  'gayze-discovery: live Right Now intents within the capped travel distance (max 5 km). '
  'Excludes the caller, expired intents and paused intents.';

revoke all on function public.discover_right_now(double precision, text, text) from public;
grant execute on function public.discover_right_now(double precision, text, text) to authenticated;
