-- Existing direct conversations should disappear from the inbox once either
-- participant blocks the other. Keep the return contract unchanged for the app.
create or replace function public.get_my_conversations()
returns table(
  conversation_id uuid,
  conversation_created_at timestamp with time zone,
  user_id uuid,
  display_name text,
  neighborhood text,
  avatar_path text
)
language sql
stable
security definer
set search_path = ''
as $gayze_conversations_fn$
  select
    cm.conversation_id,
    c.created_at,
    cm.user_id,
    p.display_name,
    p.neighborhood,
    p.avatar_path
  from public.conversation_members cm
  join public.conversations c on c.id = cm.conversation_id
  left join public.profiles p on p.id = cm.user_id
  where (select auth.uid()) is not null
    and exists (
      select 1
      from public.conversation_members me
      where me.conversation_id = cm.conversation_id
        and me.user_id = (select auth.uid())
    )
    and not exists (
      select 1
      from public.conversation_members peer
      join public.blocks b
        on (b.blocker_id = (select auth.uid()) and b.blocked_id = peer.user_id)
        or (b.blocker_id = peer.user_id and b.blocked_id = (select auth.uid()))
      where peer.conversation_id = cm.conversation_id
        and peer.user_id <> (select auth.uid())
    )
  order by c.created_at desc, cm.user_id;
$gayze_conversations_fn$;
