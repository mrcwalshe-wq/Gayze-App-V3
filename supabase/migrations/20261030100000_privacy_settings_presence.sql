-- Stage 1 of the social-platform transformation: privacy settings and server-side presence.
-- Interests keep living in profiles.hobbies (already used by the profile editor); this only indexes them for discovery.

create table if not exists public.user_privacy_settings (
  user_id uuid primary key references auth.users(id) on delete cascade,
  show_online_status boolean not null default true,
  show_last_seen boolean not null default true,
  who_can_message text not null default 'everyone' check (who_can_message in ('everyone','connections')),
  discoverable boolean not null default true,
  updated_at timestamptz not null default now()
);
alter table public.user_privacy_settings enable row level security;
create policy privacy_self_select on public.user_privacy_settings for select to authenticated using ((select auth.uid()) = user_id);
create policy privacy_self_insert on public.user_privacy_settings for insert to authenticated with check ((select auth.uid()) = user_id);
create policy privacy_self_update on public.user_privacy_settings for update to authenticated using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
revoke all on public.user_privacy_settings from anon;

-- Carry over anyone who had already hidden their online status.
insert into public.user_privacy_settings(user_id, show_online_status)
select id, not coalesce(hide_online_status, false) from public.profiles where coalesce(hide_online_status, false)
on conflict do nothing;

create table if not exists public.user_presence (
  user_id uuid primary key references auth.users(id) on delete cascade,
  status text not null default 'online' check (status in ('online','away')),
  last_active_at timestamptz not null default now()
);
alter table public.user_presence enable row level security;
revoke all on public.user_presence from anon, authenticated;   -- reached only through the functions below

create index if not exists profiles_hobbies_gin on public.profiles using gin (hobbies);

-- The app calls this every ~45 s while it is open, and with 'away' when it is backgrounded.
create or replace function public.presence_heartbeat(p_status text default 'online')
returns void language plpgsql security definer set search_path = public, pg_temp as $$
declare uid uuid := auth.uid();
begin
  if uid is null then raise exception 'not authenticated'; end if;
  insert into public.user_presence(user_id, status, last_active_at)
  values (uid, case when p_status = 'away' then 'away' else 'online' end, now())
  on conflict (user_id) do update set status = excluded.status, last_active_at = excluded.last_active_at;
  update public.profiles set last_seen_at = now() where id = uid and (last_seen_at is null or last_seen_at < now() - interval '1 minute');
end $$;

-- Status is computed on the server from the last heartbeat, so a closed tab goes offline by itself:
-- online <= 90 s, away <= 10 min, otherwise offline. People who hide it, people you are blocked with and
-- strangers who are not discoverable come back as 'hidden' with no timestamps.
create or replace function public.get_presence(p_user_ids uuid[])
returns table (user_id uuid, status text, last_seen_at timestamptz)
language sql stable security definer set search_path = public, pg_temp as $$
  select t.id,
    case when not allowed then 'hidden'
         when pr.last_active_at is null then 'offline'
         when pr.last_active_at > now() - interval '90 seconds' then pr.status
         when pr.last_active_at > now() - interval '10 minutes' then 'away'
         else 'offline' end,
    case when allowed and coalesce(ps.show_last_seen, true) then pr.last_active_at end
  from (
    select u.id,
      (u.id = auth.uid()) or (
        coalesce(ps2.show_online_status, true)
        and not public.gayze_is_blocked_between(u.id)
        and (coalesce(ps2.discoverable, true) or exists (
          select 1 from public.conversation_members a join public.conversation_members b on b.conversation_id = a.conversation_id
          where a.user_id = auth.uid() and b.user_id = u.id))
      ) as allowed
    from unnest(p_user_ids[1:100]) as u(id)
    left join public.user_privacy_settings ps2 on ps2.user_id = u.id
  ) t
  left join public.user_presence pr on pr.user_id = t.id
  left join public.user_privacy_settings ps on ps.user_id = t.id
  where auth.uid() is not null;
$$;

revoke all on function public.presence_heartbeat(text), public.get_presence(uuid[]) from public, anon;
grant execute on function public.presence_heartbeat(text), public.get_presence(uuid[]) to authenticated;
