-- Discovery, step 3 of the intent model v2.
--  * Rows now carry the signal's activities and connections, and discovery can filter by one activity.
--  * Hosting and travel details are no longer handed to everyone nearby. The columns stay in the result (as null) so older
--    app versions keep working; the app will ask for them inside an accepted chat.
-- The fog, block and ghost rules are unchanged from 20261107120100_location_fog_apply.sql.

drop function if exists public.discover_right_now(integer, text, text);
drop function if exists private.discover_right_now(integer, text, text);

create function private.discover_right_now(p_radius_m integer default 5000, p_mode text default null, p_intent text default null, p_activity text default null)
returns table (intent_id uuid, user_id uuid, display_name text, age smallint, bio text, avatar_path text, neighborhood text, mode text, intent text,
  description text, expires_at timestamptz, distance_m double precision, map_lat double precision, map_lng double precision, reliability_score numeric,
  verified_peers_count integer, safety_verified boolean, travel_distance_label text, can_host text, travel_willingness text, activities text[], connections text[])
language sql security definer set search_path = public, private as $$
  select i.id, p.id, p.display_name, p.age, p.bio, p.avatar_path, p.neighborhood,
    i.mode, i.intent, i.description, i.expires_at,
    greatest(250.0, round(st_distance(i.location, me.location) / 250.0) * 250.0)::double precision,
    st_y(i.location::geometry), st_x(i.location::geometry), p.reliability_score,
    p.verified_peers_count, p.safety_verified, i.travel_distance_label, null::text, null::text, i.activities, i.connections
  from public.intents i
  join public.profiles p on p.id = i.user_id
  cross join lateral (select l.location from public.profiles l where l.id = (select auth.uid())) me
  where i.user_id <> (select auth.uid()) and i.is_paused = false and i.expires_at > now()
    and p.privacy_setting <> 'ghost' and (p_mode is null or i.mode = p_mode) and (p_intent is null or i.intent = p_intent)
    and (p_activity is null or p_activity = any (i.activities))
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

create function public.discover_right_now(p_radius_m integer default 5000, p_mode text default null, p_intent text default null, p_activity text default null)
returns table (intent_id uuid, user_id uuid, display_name text, age smallint, bio text, avatar_path text, neighborhood text, mode text, intent text,
  description text, expires_at timestamptz, distance_m double precision, map_lat double precision, map_lng double precision, reliability_score numeric,
  verified_peers_count integer, safety_verified boolean, travel_distance_label text, can_host text, travel_willingness text, activities text[], connections text[])
language sql security definer set search_path = public, private as $$
  select * from private.discover_right_now(case when p_radius_m is null then null else least(greatest(p_radius_m, 0), 5000) end, p_mode, p_intent, p_activity);
$$;

revoke all on function private.discover_right_now(integer, text, text, text) from public, anon;
revoke all on function public.discover_right_now(integer, text, text, text) from public, anon;
grant execute on function private.discover_right_now(integer, text, text, text) to authenticated;
grant execute on function public.discover_right_now(integer, text, text, text) to authenticated, service_role;
