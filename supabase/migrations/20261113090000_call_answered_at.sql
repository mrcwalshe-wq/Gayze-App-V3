-- "Calls answered" in the investor figures counted call_sessions.status = 'answered'. Since 20261112100000 an answered call
-- becomes 'ended' when either person hangs up, so every finished call stopped counting. Record the moment a call is answered
-- and count that instead.
alter table public.call_sessions add column if not exists answered_at timestamptz;

-- Calls still marked answered, and finished calls whose log shows they connected.
update public.call_sessions set answered_at = created_at where answered_at is null and status = 'answered';
do $$
begin
  if to_regclass('public.call_events') is not null then
    update public.call_sessions s set answered_at = s.created_at
     where s.answered_at is null
       and exists (select 1 from public.call_events e where e.call_id = s.id and (e.event like '%-> connected%' or e.event = 'native: ice connected'));
  end if;
end $$;

create or replace function public.end_call_session(p_call_id uuid, p_status text default 'ended')
returns void language plpgsql security definer set search_path = public, pg_temp as $$
declare uid uuid := auth.uid();
begin
  if uid is null then raise exception 'not authenticated'; end if;
  update public.call_sessions
     set status = case when p_status = 'answered' then 'answered' else 'ended' end,
         ended_at = case when p_status = 'answered' then null else now() end,
         answered_at = case when p_status = 'answered' then coalesce(answered_at, now()) else answered_at end
   where id = p_call_id
     and status in ('ringing', 'answered')
     and uid in (caller_id, callee_id);
end $$;

-- The same for a call answered on the iPhone call screen, and the investor figure itself. Both are patched in place so the rest
-- of each function stays exactly as deployed.
do $$
declare d text;
begin
  if to_regprocedure('public.native_call_answer(uuid,text)') is not null then
    select pg_get_functiondef('public.native_call_answer(uuid,text)'::regprocedure) into d;
    if position('answered_at' in d) = 0 then
      execute replace(d, $q$set status = 'answered', ended_at = now()$q$, $q$set status = 'answered', ended_at = now(), answered_at = coalesce(answered_at, now())$q$);
    end if;
  end if;
  if to_regprocedure('public.admin_investor_metrics(integer)') is not null then
    select pg_get_functiondef('public.admin_investor_metrics(integer)'::regprocedure) into d;
    execute replace(d, $q$and status = 'answered'),$q$, $q$and answered_at is not null),$q$);
  end if;
end $$;
