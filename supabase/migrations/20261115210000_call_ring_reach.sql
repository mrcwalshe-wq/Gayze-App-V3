-- Tell a caller how the other person's phone can be reached, so the call screen does not say "Calling" for half a minute when
-- nothing can ring. 'rings': an iPhone app is registered (real call screen, even locked or closed). 'notification': only web
-- notifications (they have to open GAYZE to answer). 'none': neither; they see the call only with GAYZE open.
-- Answered only for someone the caller is allowed to call (shared chat, accepted GAYZE, not blocked): anyone else gets null.
create or replace function public.call_ring_reach(p_callee uuid)
returns text language plpgsql stable security definer set search_path = public, pg_temp as $$
declare uid uuid := auth.uid();
begin
  if uid is null or p_callee is null or p_callee = uid then return null; end if;
  if not exists (
    select 1 from public.conversation_members a
    join public.conversation_members b on b.conversation_id = a.conversation_id
    where a.user_id = uid and b.user_id = p_callee
  ) then return null; end if;
  if not exists (
    select 1 from public.interests i
    where i.status = 'mutual'
      and ((i.from_user_id = uid and i.to_user_id = p_callee) or (i.from_user_id = p_callee and i.to_user_id = uid))
  ) then return null; end if;
  if public.gayze_is_blocked_between(p_callee) then return null; end if;
  if exists (select 1 from public.voip_tokens t where t.user_id = p_callee) then return 'rings'; end if;
  if exists (select 1 from public.push_subscriptions s where s.user_id = p_callee) then return 'notification'; end if;
  return 'none';
end $$;
revoke all on function public.call_ring_reach(uuid) from public, anon;
grant execute on function public.call_ring_reach(uuid) to authenticated;
