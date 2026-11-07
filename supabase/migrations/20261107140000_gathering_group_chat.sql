-- Gatherings get a private group chat. The host decides who comes (request -> accept); everyone accepted, and the host,
-- is a member of one group conversation for that gathering. Leaving or being removed takes you out of it.
--
-- The conversation is an ordinary end-to-end encrypted one: membership gives access to ciphertext only, and the
-- existing group-key logic wraps the key for each member's devices the next time an existing member opens the chat.

alter table public.gatherings
  add column if not exists conversation_id uuid references public.conversations(id) on delete set null;
create index if not exists gatherings_conversation_idx on public.gatherings (conversation_id) where conversation_id is not null;

-- Create the gathering's conversation once (host is its first member).
create or replace function private.ensure_gathering_conversation(p_gathering_id uuid)
returns uuid
language plpgsql
security definer
set search_path to 'public', 'private', 'pg_temp'
as $$
declare conv uuid; hid uuid;
begin
  select conversation_id, host_id into conv, hid from public.gatherings where id = p_gathering_id for update;
  if not found then return null; end if;
  if conv is null then
    insert into public.conversations default values returning id into conv;
    update public.gatherings set conversation_id = conv where id = p_gathering_id;
  end if;
  insert into public.conversation_members (conversation_id, user_id) values (conv, hid) on conflict do nothing;
  return conv;
end $$;
revoke all on function private.ensure_gathering_conversation(uuid) from public, anon, authenticated;

-- Keep chat membership in step with the guest list: accepted (or host) in, everyone else out.
create or replace function private.gathering_chat_sync()
returns trigger
language plpgsql
security definer
set search_path to 'public', 'private', 'pg_temp'
as $$
declare conv uuid; hid uuid;
begin
  if new.status = 'attending' then
    conv := private.ensure_gathering_conversation(new.gathering_id);
    if conv is not null then
      insert into public.conversation_members (conversation_id, user_id) values (conv, new.user_id) on conflict do nothing;
    end if;
  elsif tg_op = 'UPDATE' and old.status = 'attending' and new.status <> 'attending' then
    select conversation_id, host_id into conv, hid from public.gatherings where id = new.gathering_id;
    if conv is not null and new.user_id <> hid then
      delete from public.conversation_members where conversation_id = conv and user_id = new.user_id;
    end if;
  end if;
  return new;
end $$;
revoke all on function private.gathering_chat_sync() from public, anon, authenticated;

drop trigger if exists gathering_chat_sync on public.gathering_rsvps;
create trigger gathering_chat_sync
  after insert or update of status on public.gathering_rsvps
  for each row execute function private.gathering_chat_sync();

-- Bring existing gatherings in line: everyone already accepted gets into their gathering's chat.
do $$
declare r record; conv uuid;
begin
  for r in select gathering_id, user_id from public.gathering_rsvps where status = 'attending' loop
    conv := private.ensure_gathering_conversation(r.gathering_id);
    if conv is not null then
      insert into public.conversation_members (conversation_id, user_id) values (conv, r.user_id) on conflict do nothing;
    end if;
  end loop;
end $$;

-- Which of my chats belong to a gathering (so the app can name them and link them from the gathering card).
create or replace function public.get_my_gathering_chats()
returns table (gathering_id uuid, conversation_id uuid, title text, scheduled_at timestamptz, host_id uuid)
language sql
stable
security definer
set search_path to 'public', 'pg_temp'
as $$
  select g.id, g.conversation_id, g.title, g.scheduled_at, g.host_id
  from public.gatherings g
  join public.conversation_members cm on cm.conversation_id = g.conversation_id and cm.user_id = (select auth.uid())
  where (select auth.uid()) is not null and g.conversation_id is not null;
$$;
revoke all on function public.get_my_gathering_chats() from public, anon;
grant execute on function public.get_my_gathering_chats() to authenticated, service_role;
