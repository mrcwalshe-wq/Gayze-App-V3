-- Let a conversation partner see the other person's LIVE intent in the chat header.
--
-- Cause: public.intents has a single policy, intents_owner_all (user_id = auth.uid()),
-- so the chat's `select ... from intents where user_id = <peer>` always returned no
-- rows and the banner always said "No active intent". No policy letting a chat
-- partner read it was ever written.
--
-- Fix: a narrow SECURITY DEFINER function rather than a wider RLS policy. A policy
-- would expose every column of the peer's row to any client that shares a
-- conversation with them (including `location`); the function returns only the
-- display fields, only for an intent that is live now (not paused, not expired),
-- only to a current member of a conversation with that user, never to oneself and
-- never across a block in either direction.
set lock_timeout = '5s';

create or replace function public.get_peer_intent(p_peer_id uuid)
returns table (
  id uuid,
  user_id uuid,
  mode text,
  intent text,
  starts_at timestamptz,
  expires_at timestamptz,
  is_paused boolean
)
language sql
stable
security definer
set search_path to 'public', 'pg_temp'
as $function$
  select i.id, i.user_id, i.mode, i.intent, i.starts_at, i.expires_at, i.is_paused
  from public.intents i
  where (select auth.uid()) is not null
    and p_peer_id is not null
    and p_peer_id <> (select auth.uid())
    and i.user_id = p_peer_id
    and i.is_paused = false
    and i.expires_at > now()
    and exists (
      select 1
      from public.conversation_members me
      join public.conversation_members peer on peer.conversation_id = me.conversation_id
      where me.user_id = (select auth.uid()) and peer.user_id = p_peer_id
    )
    and not public.gayze_is_blocked_between(p_peer_id)
  order by i.starts_at desc, i.id
  limit 1;
$function$;

revoke all on function public.get_peer_intent(uuid) from public, anon;
grant execute on function public.get_peer_intent(uuid) to authenticated, service_role;
