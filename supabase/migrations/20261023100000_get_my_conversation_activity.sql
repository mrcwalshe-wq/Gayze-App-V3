-- Last message time per conversation, so the Messages list can be ordered by
-- latest activity from the first load instead of by when each chat was created.
-- SECURITY INVOKER: messages RLS already limits rows to conversations the caller
-- belongs to; no ciphertext or other message data is returned.
create or replace function public.get_my_conversation_activity()
returns table (conversation_id uuid, last_message_at timestamptz)
language sql
stable
security invoker
set search_path to 'public', 'pg_temp'
as $function$
  select m.conversation_id, max(m.created_at) as last_message_at
  from public.messages m
  where (select auth.uid()) is not null
  group by m.conversation_id
$function$;

revoke all on function public.get_my_conversation_activity() from public, anon;
grant execute on function public.get_my_conversation_activity() to authenticated, service_role;
