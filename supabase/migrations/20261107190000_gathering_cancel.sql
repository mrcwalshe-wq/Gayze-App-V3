-- A host can cancel a plan without deleting it: it stays visible, stamped CANCELLED. No new requests or acceptances,
-- and no more reminders. Hosts can already update their own rows (RLS "hosts update own gatherings").
alter table public.gatherings add column if not exists cancelled_at timestamptz;

create or replace function public.gayze_enqueue_gathering_reminders()
returns integer language plpgsql security definer set search_path = public, pg_temp as $$
declare n integer := 0; r record;
begin
  for r in
    select g.id, rs.user_id from public.gatherings g
    join public.gathering_rsvps rs on rs.gathering_id = g.id and rs.status = 'attending'
    where g.cancelled_at is null and g.scheduled_at > now() + interval '23 hours' and g.scheduled_at <= now() + interval '24 hours'
  loop
    perform public.gayze_enqueue_notification(r.user_id, null, 'gathering_reminder', r.id::text || ':24h', '/later');
    n := n + 1;
  end loop;
  for r in
    select g.id, rs.user_id from public.gatherings g
    join public.gathering_rsvps rs on rs.gathering_id = g.id and rs.status = 'attending'
    where g.cancelled_at is null and g.scheduled_at > now() and g.scheduled_at <= now() + interval '1 hour'
  loop
    perform public.gayze_enqueue_notification(r.user_id, null, 'gathering_reminder', r.id::text || ':1h', '/later');
    n := n + 1;
  end loop;
  return n;
end $$;

create or replace function public.request_to_join_gathering(p_gathering_id uuid)
returns text language plpgsql security definer set search_path = public, pg_temp as $$
declare
  uid uuid := (select auth.uid());
  g record;
  cur text;
  taken integer;
begin
  if uid is null then raise exception 'not authenticated'; end if;
  select id, host_id, capacity, scheduled_at, cancelled_at into g from public.gatherings where id = p_gathering_id;
  if not found then raise exception 'gathering not found'; end if;
  if g.cancelled_at is not null then raise exception 'gathering was cancelled'; end if;

  if g.host_id = uid then
    insert into public.gathering_rsvps (gathering_id, user_id, status) values (p_gathering_id, uid, 'attending')
    on conflict (gathering_id, user_id) do update set status = 'attending', updated_at = now();
    return 'attending';
  end if;

  select status into cur from public.gathering_rsvps where gathering_id = p_gathering_id and user_id = uid;
  if cur in ('attending', 'requested', 'declined') then return cur; end if;
  if g.scheduled_at < now() - interval '1 hour' then raise exception 'gathering has ended'; end if;

  select count(*) into taken from public.gathering_rsvps where gathering_id = p_gathering_id and status = 'attending';
  if taken >= g.capacity then raise exception 'gathering is full'; end if;

  insert into public.gathering_rsvps (gathering_id, user_id, status) values (p_gathering_id, uid, 'requested')
  on conflict (gathering_id, user_id) do update set status = 'requested', updated_at = now();
  return 'requested';
end $$;

create or replace function public.respond_to_gathering_request(p_gathering_id uuid, p_user_id uuid, p_accept boolean)
returns text language plpgsql security definer set search_path = public, pg_temp as $$
declare
  uid uuid := (select auth.uid());
  g record;
  cur text;
  taken integer;
begin
  if uid is null then raise exception 'not authenticated'; end if;
  select id, host_id, capacity, cancelled_at into g from public.gatherings where id = p_gathering_id;
  if not found then raise exception 'gathering not found'; end if;
  if g.host_id <> uid then raise exception 'only the host can respond'; end if;
  if g.cancelled_at is not null then raise exception 'gathering was cancelled'; end if;

  select status into cur from public.gathering_rsvps where gathering_id = p_gathering_id and user_id = p_user_id for update;
  if cur is null then raise exception 'request not found'; end if;
  if cur <> 'requested' then return cur; end if;

  if p_accept then
    select count(*) into taken from public.gathering_rsvps where gathering_id = p_gathering_id and status = 'attending';
    if taken >= g.capacity then raise exception 'gathering is full'; end if;
    update public.gathering_rsvps set status = 'attending', updated_at = now() where gathering_id = p_gathering_id and user_id = p_user_id;
    return 'attending';
  end if;
  update public.gathering_rsvps set status = 'declined', updated_at = now() where gathering_id = p_gathering_id and user_id = p_user_id;
  return 'declined';
end $$;
