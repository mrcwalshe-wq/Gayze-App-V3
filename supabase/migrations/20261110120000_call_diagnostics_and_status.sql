-- 1. Call diagnostics: the app reports short call-step events (ice connected, routes found, microphone ok...) so a call that fails
--    can be diagnosed from the server. No SDP, keys, names or message content. At most 200 events per call per person.
create table if not exists public.call_events (
  id bigint generated always as identity primary key,
  call_id uuid not null,
  user_id uuid not null,
  event text not null check (char_length(event) <= 160),
  created_at timestamptz not null default now()
);
create index if not exists call_events_call_idx on public.call_events(call_id, created_at);
alter table public.call_events enable row level security;
revoke all on public.call_events from anon, authenticated;

create or replace function public.log_call_event(p_call_id uuid, p_event text)
returns void language plpgsql security definer set search_path = public, pg_temp as $$
declare uid uuid := auth.uid();
begin
  if uid is null or p_event is null then return; end if;
  if not exists (select 1 from public.call_sessions s where s.id = p_call_id and uid in (s.caller_id, s.callee_id)) then return; end if;
  if (select count(*) from public.call_events where call_id = p_call_id and user_id = uid) >= 200 then return; end if;
  insert into public.call_events(call_id, user_id, event) values (p_call_id, uid, left(p_event, 160));
  if random() < 0.02 then delete from public.call_events where created_at < now() - interval '14 days'; end if;
end $$;
revoke all on function public.log_call_event(uuid, text) from public, anon;
grant execute on function public.log_call_event(uuid, text) to authenticated;

-- 2. Call status, so a caller whose call was declined (or hung up on) in a way the live signal missed stops ringing.
create or replace function public.get_call_status(p_call_id uuid)
returns text language sql stable security definer set search_path = public, pg_temp as $$
  select s.status from public.call_sessions s where s.id = p_call_id and auth.uid() in (s.caller_id, s.callee_id);
$$;
revoke all on function public.get_call_status(uuid) from public, anon;
grant execute on function public.get_call_status(uuid) to authenticated;
