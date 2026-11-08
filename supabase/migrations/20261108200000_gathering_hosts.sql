-- Who is hosting: the name, avatar and verification of the member who posted each event, for signed-in members.
-- Profiles are otherwise private, so this returns only these three fields and only for people who host an event you can see.
create or replace function public.get_gathering_hosts(p_ids uuid[])
returns table (gathering_id uuid, host_id uuid, display_name text, avatar_path text, safety_verified boolean)
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare uid uuid := (select auth.uid());
begin
  if uid is null then raise exception 'not authenticated'; end if;
  return query
  select g.id, g.host_id, coalesce(nullif(btrim(p.display_name), ''), 'Member'), p.avatar_path, coalesce(p.safety_verified, false)
  from public.gatherings g
  join public.profiles p on p.id = g.host_id
  where g.id = any (p_ids)
    and not exists (select 1 from public.blocks b where (b.blocker_id = uid and b.blocked_id = g.host_id) or (b.blocker_id = g.host_id and b.blocked_id = uid));
end $$;
revoke all on function public.get_gathering_hosts(uuid[]) from public, anon;
grant execute on function public.get_gathering_hosts(uuid[]) to authenticated;
