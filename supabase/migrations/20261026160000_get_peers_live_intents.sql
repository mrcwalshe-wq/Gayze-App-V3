-- Live intents of everyone the caller has a conversation with, in one call (the chat list shows who is live right now).
-- Same rules as get_peer_intent: display fields only, only live (started, not expired) and unpaused, only for conversation partners,
-- never across a block in either direction, never the caller's own.
create or replace function public.get_peers_live_intents(p_peer_ids uuid[])
returns table (user_id uuid, mode text, intent text, starts_at timestamptz, expires_at timestamptz)
language sql stable security definer set search_path to 'public', 'pg_temp'
as $function$
  select distinct on (i.user_id) i.user_id, i.mode, i.intent, i.starts_at, i.expires_at
  from public.intents i
  where (select auth.uid()) is not null
    and p_peer_ids is not null
    and cardinality(p_peer_ids) <= 200
    and i.user_id = any (p_peer_ids)
    and i.user_id <> (select auth.uid())
    and i.is_paused = false
    and i.starts_at <= now()
    and i.expires_at > now()
    and exists (
      select 1
      from public.conversation_members me
      join public.conversation_members peer on peer.conversation_id = me.conversation_id
      where me.user_id = (select auth.uid()) and peer.user_id = i.user_id
    )
    and not public.gayze_is_blocked_between(i.user_id)
  order by i.user_id, i.starts_at desc, i.id;
$function$;

revoke all on function public.get_peers_live_intents(uuid[]) from public, anon;
grant execute on function public.get_peers_live_intents(uuid[]) to authenticated, service_role;
