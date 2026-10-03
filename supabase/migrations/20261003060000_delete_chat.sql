-- GAYZE Delete Chat.
-- Removes ONLY the caller's own conversation_members row. Other members'
-- rows, messages, ciphertext and key envelopes are never touched, so the other
-- participant's view is unaffected. Membership is verified from auth.uid().

create or replace function public.leave_conversation(p_conversation_id uuid)
returns boolean
language plpgsql
security definer
set search_path=public,pg_temp
as $$
declare
  v_user uuid := auth.uid();
  v_rows integer;
begin
  if v_user is null then
    raise exception 'Sign in required' using errcode='28000';
  end if;
  delete from public.conversation_members
   where conversation_id=p_conversation_id
     and user_id=v_user;
  get diagnostics v_rows = row_count;
  if v_rows=0 then
    raise exception 'Not a conversation member' using errcode='42501';
  end if;
  return true;
end $$;

revoke all on function public.leave_conversation(uuid) from public,anon;
grant execute on function public.leave_conversation(uuid) to authenticated;
