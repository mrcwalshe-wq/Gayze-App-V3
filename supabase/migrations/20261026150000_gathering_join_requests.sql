-- Gatherings: the host decides who comes.
--
-- Problems fixed here (found on production):
--  1. Anyone could join straight away. Now a guest asks; the host accepts or declines.
--  2. Guest counts were wrong for everybody. The only RLS policy on gathering_rsvps was
--     "user_id = auth.uid()", so every member could read only their own row and every card showed
--     at most "1 going". Counts and attendee lists now come from a definer function that applies the
--     visibility rules explicitly.
--  3. Direct table writes would have let anyone insert themselves as 'attending' and skip approval, so
--     the table is closed to direct reads and writes; everything goes through the functions below.
--
-- States: requested -> attending (accepted) | declined; attending/requested -> cancelled (guest leaves
-- or withdraws). The host is always 'attending'. A declined guest cannot ask again.

alter policy "users manage own gathering rsvps" on public.gathering_rsvps using (false) with check (false);
revoke insert, update, delete on public.gathering_rsvps from anon, authenticated;

-- Members ask to join.
create or replace function public.request_to_join_gathering(p_gathering_id uuid)
returns text language plpgsql security definer set search_path = public, pg_temp as $$
declare
  uid uuid := (select auth.uid());
  g record;
  cur text;
  taken integer;
begin
  if uid is null then raise exception 'not authenticated'; end if;
  select id, host_id, capacity, scheduled_at into g from public.gatherings where id = p_gathering_id;
  if not found then raise exception 'gathering not found'; end if;

  if g.host_id = uid then
    insert into public.gathering_rsvps (gathering_id, user_id, status) values (p_gathering_id, uid, 'attending')
    on conflict (gathering_id, user_id) do update set status = 'attending', updated_at = now();
    return 'attending';
  end if;

  select status into cur from public.gathering_rsvps where gathering_id = p_gathering_id and user_id = uid;
  if cur in ('attending', 'requested', 'declined') then return cur; end if;   -- idempotent; declined stays declined
  if g.scheduled_at < now() - interval '1 hour' then raise exception 'gathering has ended'; end if;

  select count(*) into taken from public.gathering_rsvps where gathering_id = p_gathering_id and status = 'attending';
  if taken >= g.capacity then raise exception 'gathering is full'; end if;

  insert into public.gathering_rsvps (gathering_id, user_id, status) values (p_gathering_id, uid, 'requested')
  on conflict (gathering_id, user_id) do update set status = 'requested', updated_at = now();
  return 'requested';
end $$;

-- Withdraw a request or leave. The host cannot leave their own gathering.
create or replace function public.leave_gathering(p_gathering_id uuid)
returns text language plpgsql security definer set search_path = public, pg_temp as $$
declare
  uid uuid := (select auth.uid());
  hid uuid;
begin
  if uid is null then raise exception 'not authenticated'; end if;
  select host_id into hid from public.gatherings where id = p_gathering_id;
  if not found then raise exception 'gathering not found'; end if;
  if hid = uid then return 'attending'; end if;
  update public.gathering_rsvps set status = 'cancelled', updated_at = now()
  where gathering_id = p_gathering_id and user_id = uid and status in ('attending', 'requested');
  return 'cancelled';
end $$;

-- Host accepts or declines a request.
create or replace function public.respond_to_gathering_request(p_gathering_id uuid, p_user_id uuid, p_accept boolean)
returns text language plpgsql security definer set search_path = public, pg_temp as $$
declare
  uid uuid := (select auth.uid());
  g record;
  cur text;
  taken integer;
begin
  if uid is null then raise exception 'not authenticated'; end if;
  select id, host_id, capacity into g from public.gatherings where id = p_gathering_id;
  if not found then raise exception 'gathering not found'; end if;
  if g.host_id <> uid then raise exception 'only the host can respond'; end if;

  select status into cur from public.gathering_rsvps where gathering_id = p_gathering_id and user_id = p_user_id for update;
  if cur is null then raise exception 'request not found'; end if;
  if cur <> 'requested' then return cur; end if;                                   -- already handled: idempotent

  if p_accept then
    select count(*) into taken from public.gathering_rsvps where gathering_id = p_gathering_id and status = 'attending';
    if taken >= g.capacity then raise exception 'gathering is full'; end if;
    update public.gathering_rsvps set status = 'attending', updated_at = now() where gathering_id = p_gathering_id and user_id = p_user_id;
    return 'attending';
  end if;
  update public.gathering_rsvps set status = 'declined', updated_at = now() where gathering_id = p_gathering_id and user_id = p_user_id;
  return 'declined';
end $$;

-- Older app builds still call toggle_gathering_rsvp. It can no longer admit anyone: a guest's call becomes a
-- request (or a withdrawal), so the return value ("am I attending?") is false for guests.
create or replace function public.toggle_gathering_rsvp(p_gathering_id uuid)
returns boolean language plpgsql security definer set search_path = public, pg_temp as $$
declare
  uid uuid := (select auth.uid());
  hid uuid;
  cur text;
begin
  if uid is null then raise exception 'not authenticated'; end if;
  select host_id into hid from public.gatherings where id = p_gathering_id;
  if not found then raise exception 'gathering not found'; end if;
  if hid = uid then perform public.request_to_join_gathering(p_gathering_id); return true; end if;
  select status into cur from public.gathering_rsvps where gathering_id = p_gathering_id and user_id = uid;
  if cur in ('attending', 'requested') then perform public.leave_gathering(p_gathering_id); else perform public.request_to_join_gathering(p_gathering_id); end if;
  return false;
end $$;

-- What each member may see of a gathering's guest list:
--   everyone: how many are going and their own status;
--   the host: who is going and who is waiting;
--   accepted guests: who is going.
create or replace function public.get_gathering_rsvp_overview(p_ids uuid[] default null)
returns table (gathering_id uuid, attending_count integer, my_status text, pending jsonb, attendees jsonb)
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare uid uuid := (select auth.uid());
begin
  if uid is null then raise exception 'not authenticated'; end if;
  return query
  select g.id,
    (select count(*)::integer from public.gathering_rsvps r where r.gathering_id = g.id and r.status = 'attending'),
    (select r.status from public.gathering_rsvps r where r.gathering_id = g.id and r.user_id = uid),
    case when g.host_id = uid then coalesce((
      select jsonb_agg(jsonb_build_object('userId', r.user_id, 'name', coalesce(nullif(btrim(p.display_name), ''), 'Member'), 'requestedAt', r.updated_at) order by r.updated_at)
      from public.gathering_rsvps r left join public.profiles p on p.id = r.user_id
      where r.gathering_id = g.id and r.status = 'requested'), '[]'::jsonb) else '[]'::jsonb end,
    case when g.host_id = uid or exists (select 1 from public.gathering_rsvps m where m.gathering_id = g.id and m.user_id = uid and m.status = 'attending') then coalesce((
      select jsonb_agg(jsonb_build_object('userId', r.user_id, 'name', coalesce(nullif(btrim(p.display_name), ''), 'Member'), 'isHost', r.user_id = g.host_id) order by (r.user_id = g.host_id) desc, r.updated_at)
      from public.gathering_rsvps r left join public.profiles p on p.id = r.user_id
      where r.gathering_id = g.id and r.status = 'attending'), '[]'::jsonb) else '[]'::jsonb end
  from public.gatherings g
  where p_ids is null or g.id = any (p_ids);
end $$;

-- Notices. Requests tell the host; decisions tell the guest; a full gathering tells the host once.
create or replace function public.gathering_rsvp_notify()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
declare
  g record;
  who text;
  total integer;
  key text;
begin
  select id, host_id, title, capacity into g from public.gatherings where id = new.gathering_id;
  if not found or g.host_id = new.user_id then return new; end if;
  if tg_op = 'UPDATE' and old.status = new.status then return new; end if;

  if new.status = 'requested' then
    select coalesce(nullif(btrim(display_name), ''), 'Someone') into who from public.profiles where id = new.user_id;
    insert into public.member_notices (user_id, actor_id, kind, title, body, url, dedupe_key)
    values (g.host_id, new.user_id, 'gathering_rsvp', 'Request to join',
            left(coalesce(who, 'Someone') || ' wants to join ' || g.title, 500), '/later', 'request:' || new.gathering_id::text || ':' || new.user_id::text)
    on conflict (user_id, kind, dedupe_key) do nothing;

  elsif new.status = 'attending' and tg_op = 'UPDATE' and old.status = 'requested' then
    insert into public.member_notices (user_id, actor_id, kind, title, body, url, dedupe_key)
    values (new.user_id, g.host_id, 'gathering_rsvp', 'You''re in',
            left('You''re going to ' || g.title, 500), '/later', 'accepted:' || new.gathering_id::text || ':' || new.user_id::text)
    on conflict (user_id, kind, dedupe_key) do nothing;
    select count(*) into total from public.gathering_rsvps where gathering_id = new.gathering_id and status = 'attending';
    if total >= g.capacity then
      insert into public.member_notices (user_id, kind, title, body, url, dedupe_key)
      values (g.host_id, 'gathering_full', 'Your gathering is full', left(g.title || ' has reached its limit of ' || g.capacity || ' people.', 500), '/later', g.id::text)
      on conflict (user_id, kind, dedupe_key) do nothing;
    end if;

  elsif new.status = 'declined' then
    insert into public.member_notices (user_id, actor_id, kind, title, body, url, dedupe_key)
    values (new.user_id, g.host_id, 'gathering_rsvp', 'Request not accepted',
            left('The host could not fit you into ' || g.title, 500), '/later', 'declined:' || new.gathering_id::text || ':' || new.user_id::text)
    on conflict (user_id, kind, dedupe_key) do nothing;
  end if;
  return new;
end $$;

do $$
declare fn text;
begin
  foreach fn in array array[
    'public.request_to_join_gathering(uuid)', 'public.leave_gathering(uuid)',
    'public.respond_to_gathering_request(uuid, uuid, boolean)', 'public.toggle_gathering_rsvp(uuid)',
    'public.get_gathering_rsvp_overview(uuid[])'
  ] loop
    execute format('revoke execute on function %s from public, anon', fn);
    execute format('grant execute on function %s to authenticated, service_role', fn);
  end loop;
end $$;
