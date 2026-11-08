-- Archived chats, kept on the account so they stay archived on every device and after a reinstall.
-- Archiving only hides a chat from your own list; it never changes the conversation or what other members see.
create table if not exists public.conversation_archives (
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  conversation_id uuid not null references public.conversations(id) on delete cascade,
  archived_at timestamptz not null default now(),
  primary key (user_id, conversation_id)
);
alter table public.conversation_archives enable row level security;
create policy conversation_archives_own on public.conversation_archives for select to authenticated
  using (user_id = (select auth.uid()));
revoke all on public.conversation_archives from anon, authenticated;
grant select on public.conversation_archives to authenticated;

-- The only way to change it: archive or restore chats you are a member of.
create or replace function public.set_chats_archived(p_ids uuid[], p_archived boolean)
returns void language plpgsql security definer set search_path = public, pg_temp as $$
declare uid uuid := (select auth.uid());
begin
  if uid is null then raise exception 'not authenticated'; end if;
  if coalesce(array_length(p_ids, 1), 0) > 200 then raise exception 'too many chats'; end if;
  if p_archived then
    insert into public.conversation_archives (user_id, conversation_id)
    select uid, m.conversation_id from public.conversation_members m
    where m.user_id = uid and m.conversation_id = any (p_ids)
    on conflict do nothing;
  else
    delete from public.conversation_archives where user_id = uid and conversation_id = any (p_ids);
  end if;
end $$;
revoke all on function public.set_chats_archived(uuid[], boolean) from public, anon;
grant execute on function public.set_chats_archived(uuid[], boolean) to authenticated;
