-- The venue, address and map position of a gathering are only for its host and accepted guests.
-- Everyone else sees the title, time, area (neighbourhood) and counts.

-- Column-level read access: the place columns are no longer readable straight from the table.
revoke select on public.gatherings from anon, authenticated;
grant select (id, host_id, title, description, category, scheduled_at, neighborhood, is_safe_haven_venue,
              capacity, tags, safety_guidelines, created_at, conversation_id, cancelled_at)
  on public.gatherings to authenticated;

-- The one way to read a place: host or accepted guest, per gathering.
create or replace function public.get_gathering_places(p_ids uuid[] default null)
returns table (gathering_id uuid, location_name text, address text, lat double precision, lng double precision)
language plpgsql stable security definer
set search_path = public, pg_temp
as $$
declare uid uuid := (select auth.uid());
begin
  if uid is null then raise exception 'not authenticated'; end if;
  return query
  select g.id, g.location_name, g.address, g.lat, g.lng
  from public.gatherings g
  where (p_ids is null or g.id = any (p_ids))
    and (g.host_id = uid or exists (
      select 1 from public.gathering_rsvps r
      where r.gathering_id = g.id and r.user_id = uid and r.status = 'attending'));
end $$;

revoke all on function public.get_gathering_places(uuid[]) from public, anon;
grant execute on function public.get_gathering_places(uuid[]) to authenticated;
