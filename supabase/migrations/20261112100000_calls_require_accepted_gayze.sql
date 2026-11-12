-- Calls are only available after the recipient has accepted a GAYZE request.
-- Conversation membership remains necessary, but is not sufficient: old/orphaned memberships
-- and manually-created conversations must not bypass the explicit acceptance step.

create or replace function public.start_call_session(p_call_id uuid, p_conversation uuid, p_callee uuid, p_call_type text)
returns void language plpgsql security definer set search_path = public, pg_temp as $$
declare uid uuid := auth.uid();
begin
  if uid is null then raise exception 'not authenticated'; end if;
  if p_callee is null or p_callee = uid then raise exception 'invalid callee'; end if;
  if p_call_type not in ('audio','video') then raise exception 'invalid call type'; end if;

  if not exists (
    select 1
    from public.conversation_members caller_member
    join public.conversation_members callee_member
      on callee_member.conversation_id = caller_member.conversation_id
    where caller_member.conversation_id = p_conversation
      and caller_member.user_id = uid
      and callee_member.user_id = p_callee
  ) then
    raise exception 'not a conversation member';
  end if;

  -- A mutual interest is the durable record that the recipient accepted the sender's GAYZE.
  -- Either direction is valid because either person may have initiated the request.
  if not exists (
    select 1
    from public.interests i
    where i.status = 'mutual'
      and (
        (i.from_user_id = uid and i.to_user_id = p_callee)
        or
        (i.from_user_id = p_callee and i.to_user_id = uid)
      )
  ) then
    raise exception 'accepted Gayze required';
  end if;

  if public.gayze_is_blocked_between(p_callee) then raise exception 'blocked'; end if;

  update public.call_sessions
     set status = 'ended', ended_at = now()
   where caller_id = uid and status = 'ringing';

  insert into public.call_sessions(id, conversation_id, caller_id, callee_id, call_type)
  values (p_call_id, p_conversation, uid, p_callee, p_call_type)
  on conflict (id) do nothing;
end $$;

-- Re-check the acceptance relationship when recovering a ringing call. This prevents stale
-- call-session rows from surfacing to a recipient after the underlying connection has ended.
-- Acceptance is recorded as soon as the callee taps Accept, before their phone
-- finishes joining Realtime. Allow either participant to end an already-answered
-- session as well as a ringing one.
create or replace function public.end_call_session(p_call_id uuid, p_status text default 'ended')
returns void language plpgsql security definer set search_path = public, pg_temp as $
declare uid uuid := auth.uid();
begin
  if uid is null then raise exception 'not authenticated'; end if;
  update public.call_sessions
     set status = case when p_status = 'answered' then 'answered' else 'ended' end,
         ended_at = case when p_status = 'answered' then null else now() end
   where id = p_call_id
     and status in ('ringing', 'answered')
     and uid in (caller_id, callee_id);
end $;

create or replace function public.get_ringing_call()
returns table (call_id uuid, conversation_id uuid, caller_id uuid, caller_name text, call_type text, started_at timestamptz)
language sql stable security definer set search_path = public, pg_temp as $$
  select s.id, s.conversation_id, s.caller_id, coalesce(p.display_name, 'Gayze member'), s.call_type, s.created_at
  from public.call_sessions s
  left join public.profiles p on p.id = s.caller_id
  where s.callee_id = auth.uid()
    and s.status = 'ringing'
    and s.created_at > now() - interval '60 seconds'
    and not public.gayze_is_blocked_between(s.caller_id)
    and exists (
      select 1
      from public.interests i
      where i.status = 'mutual'
        and (
          (i.from_user_id = s.caller_id and i.to_user_id = s.callee_id)
          or
          (i.from_user_id = s.callee_id and i.to_user_id = s.caller_id)
        )
    )
    and exists (
      select 1
      from public.conversation_members caller_member
      join public.conversation_members callee_member
        on callee_member.conversation_id = caller_member.conversation_id
      where caller_member.conversation_id = s.conversation_id
        and caller_member.user_id = s.caller_id
        and callee_member.user_id = s.callee_id
    )
  order by s.created_at desc
  limit 1;
$$;
