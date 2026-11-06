-- A call that is ringing is recorded on the server, so the person being called can answer it even when their app was
-- asleep when the live signal went out (the usual case on a phone). Signalling itself stays on Realtime.

create table if not exists public.call_sessions (
  id uuid primary key,
  conversation_id uuid not null references public.conversations(id) on delete cascade,
  caller_id uuid not null references auth.users(id) on delete cascade,
  callee_id uuid not null references auth.users(id) on delete cascade,
  call_type text not null check (call_type in ('audio','video')),
  status text not null default 'ringing' check (status in ('ringing','answered','ended')),
  created_at timestamptz not null default now(),
  ended_at timestamptz
);
create index if not exists call_sessions_callee_ringing_idx on public.call_sessions(callee_id, created_at desc) where status = 'ringing';
alter table public.call_sessions enable row level security;
revoke all on public.call_sessions from anon, authenticated;

create or replace function public.start_call_session(p_call_id uuid, p_conversation uuid, p_callee uuid, p_call_type text)
returns void language plpgsql security definer set search_path = public, pg_temp as $$
declare uid uuid := auth.uid();
begin
  if uid is null then raise exception 'not authenticated'; end if;
  if p_callee is null or p_callee = uid then raise exception 'invalid callee'; end if;
  if p_call_type not in ('audio','video') then raise exception 'invalid call type'; end if;
  if not exists (select 1 from public.conversation_members where conversation_id = p_conversation and user_id = uid)
     or not exists (select 1 from public.conversation_members where conversation_id = p_conversation and user_id = p_callee) then
    raise exception 'not a conversation member';
  end if;
  if public.gayze_is_blocked_between(p_callee) then raise exception 'blocked'; end if;
  update public.call_sessions set status = 'ended', ended_at = now() where caller_id = uid and status = 'ringing';
  insert into public.call_sessions(id, conversation_id, caller_id, callee_id, call_type) values (p_call_id, p_conversation, uid, p_callee, p_call_type)
  on conflict (id) do nothing;
end $$;

create or replace function public.end_call_session(p_call_id uuid, p_status text default 'ended')
returns void language plpgsql security definer set search_path = public, pg_temp as $$
declare uid uuid := auth.uid();
begin
  if uid is null then raise exception 'not authenticated'; end if;
  update public.call_sessions set status = case when p_status = 'answered' then 'answered' else 'ended' end, ended_at = now()
  where id = p_call_id and status = 'ringing' and uid in (caller_id, callee_id);
end $$;

-- The call that is ringing for me right now, if any (within the 60 seconds a caller keeps ringing).
create or replace function public.get_ringing_call()
returns table (call_id uuid, conversation_id uuid, caller_id uuid, caller_name text, call_type text, started_at timestamptz)
language sql stable security definer set search_path = public, pg_temp as $$
  select s.id, s.conversation_id, s.caller_id, coalesce(p.display_name, 'Gayze member'), s.call_type, s.created_at
  from public.call_sessions s left join public.profiles p on p.id = s.caller_id
  where s.callee_id = auth.uid() and s.status = 'ringing' and s.created_at > now() - interval '60 seconds'
    and not public.gayze_is_blocked_between(s.caller_id)
  order by s.created_at desc limit 1;
$$;

revoke all on function public.start_call_session(uuid, uuid, uuid, text), public.end_call_session(uuid, text), public.get_ringing_call() from public, anon;
grant execute on function public.start_call_session(uuid, uuid, uuid, text), public.end_call_session(uuid, text), public.get_ringing_call() to authenticated;
