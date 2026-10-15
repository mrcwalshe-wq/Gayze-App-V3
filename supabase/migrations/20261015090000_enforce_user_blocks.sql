-- Enforce blocks across discovery-adjacent interactions in the database.
-- The blocks table and discovery exclusion already exist in production; this migration
-- adds server-side enforcement so bypassing the UI cannot send Gayzes or messages.
create or replace function public.gayze_reject_blocked_interaction()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $gayze_block_fn$
declare
  v_sender uuid;
  v_peer uuid;
begin
  if tg_table_name in ('gazes', 'interests') then
    v_sender := new.from_user_id;
    v_peer := new.to_user_id;
    if exists (
      select 1 from public.blocks b
      where (b.blocker_id = v_sender and b.blocked_id = v_peer)
         or (b.blocker_id = v_peer and b.blocked_id = v_sender)
    ) then
      raise exception using errcode = '42501', message = 'GAYZE_BLOCKED_USER';
    end if;
    return new;
  elsif tg_table_name = 'messages' then
    v_sender := new.sender_id;
    if exists (
      select 1
      from public.conversation_members cm
      join public.blocks b
        on (b.blocker_id = v_sender and b.blocked_id = cm.user_id)
        or (b.blocker_id = cm.user_id and b.blocked_id = v_sender)
      where cm.conversation_id = new.conversation_id
        and cm.user_id <> v_sender
    ) then
      raise exception using errcode = '42501', message = 'GAYZE_BLOCKED_USER';
    end if;
    return new;
  end if;
  return new;
end;
$gayze_block_fn$;

drop trigger if exists gazes_reject_blocked_interaction on public.gazes;
create trigger gazes_reject_blocked_interaction
before insert on public.gazes
for each row execute function public.gayze_reject_blocked_interaction();

drop trigger if exists interests_reject_blocked_interaction on public.interests;
create trigger interests_reject_blocked_interaction
before insert or update of status on public.interests
for each row execute function public.gayze_reject_blocked_interaction();

drop trigger if exists messages_reject_blocked_interaction on public.messages;
create trigger messages_reject_blocked_interaction
before insert on public.messages
for each row execute function public.gayze_reject_blocked_interaction();

create or replace function public.gayze_is_blocked_between(p_peer_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $gayze_block_fn$
  select p_peer_id is not null
    and (select auth.uid()) is not null
    and exists (
      select 1 from public.blocks b
      where (b.blocker_id = (select auth.uid()) and b.blocked_id = p_peer_id)
         or (b.blocker_id = p_peer_id and b.blocked_id = (select auth.uid()))
    );
$gayze_block_fn$;
revoke all on function public.gayze_is_blocked_between(uuid) from public;
grant execute on function public.gayze_is_blocked_between(uuid) to authenticated;

-- Keep historical notification rows, but never expose notices from a blocked peer.
drop policy if exists gayze_notifications_own on public.gayze_notifications;
create policy gayze_notifications_own
on public.gayze_notifications
for select
to authenticated
using (
  user_id = (select auth.uid())
  and (actor_id is null or not public.gayze_is_blocked_between(actor_id))
);

comment on function public.gayze_reject_blocked_interaction() is
  'Rejects Gayzes and messages whenever either participant has blocked the other.';
