-- GAYZE message lifecycle controls.
-- Preserves E2EE: the server stores only ciphertext and lifecycle metadata.

alter table public.messages
  add column if not exists unsent_at timestamptz,
  add column if not exists unsent_by uuid references auth.users(id),
  add column if not exists scheduled_message_id uuid,
  add column if not exists client_message_id text;

create unique index if not exists messages_scheduled_message_id_uq
  on public.messages(scheduled_message_id)
  where scheduled_message_id is not null;

create unique index if not exists messages_sender_client_message_id_uq
  on public.messages(sender_id, client_message_id)
  where client_message_id is not null;

create table if not exists public.message_user_state (
  message_id uuid not null references public.messages(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  hidden_at timestamptz not null default now(),
  primary key (message_id, user_id)
);

alter table public.message_user_state enable row level security;

drop policy if exists message_user_state_select_own on public.message_user_state;
create policy "message_user_state_select_own"
  on public.message_user_state for select to authenticated
  using ((select auth.uid()) = user_id);

drop policy if exists message_user_state_insert_own on public.message_user_state;
create policy "message_user_state_insert_own"
  on public.message_user_state for insert to authenticated
  with check ((select auth.uid()) = user_id);

create table if not exists public.scheduled_messages (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references public.conversations(id) on delete cascade,
  sender_id uuid not null references auth.users(id) on delete cascade,
  ciphertext text not null,
  nonce text,
  client_message_id text not null,
  scheduled_for timestamptz not null,
  expires_at timestamptz,
  created_at timestamptz not null default now(),
  cancelled_at timestamptz,
  sent_at timestamptz,
  unique(sender_id, client_message_id)
);

alter table public.scheduled_messages enable row level security;

drop policy if exists scheduled_messages_select_own on public.scheduled_messages;
create policy "scheduled_messages_select_own"
  on public.scheduled_messages for select to authenticated
  using ((select auth.uid()) = sender_id);

drop policy if exists scheduled_messages_insert_own on public.scheduled_messages;
create policy "scheduled_messages_insert_own"
  on public.scheduled_messages for insert to authenticated
  with check ((select auth.uid()) = sender_id);

drop policy if exists scheduled_messages_update_own on public.scheduled_messages;
create policy "scheduled_messages_update_own"
  on public.scheduled_messages for update to authenticated
  using ((select auth.uid()) = sender_id)
  with check ((select auth.uid()) = sender_id);

create or replace function public.delete_message_for_me(p_message_id uuid)
returns boolean
language plpgsql
security definer
set search_path=public,pg_temp
as $$
declare
  v_user uuid := auth.uid();
  v_conversation uuid;
begin
  if v_user is null then raise exception 'Sign in required' using errcode='28000'; end if;
  select conversation_id into v_conversation from public.messages where id=p_message_id;
  if v_conversation is null then raise exception 'Message not found' using errcode='P0002'; end if;
  if not exists (select 1 from public.conversation_members where conversation_id=v_conversation and user_id=v_user) then
    raise exception 'Not a conversation member' using errcode='42501';
  end if;
  insert into public.message_user_state(message_id,user_id)
  values(p_message_id,v_user)
  on conflict (message_id,user_id) do update set hidden_at=excluded.hidden_at;
  return true;
end $$;

create or replace function public.unsend_message(p_message_id uuid)
returns boolean
language plpgsql
security definer
set search_path=public,pg_temp
as $$
declare
  v_user uuid := auth.uid();
  v_rows integer;
begin
  if v_user is null then raise exception 'Sign in required' using errcode='28000'; end if;
  update public.messages
     set unsent_at=coalesce(unsent_at, now()), unsent_by=v_user
   where id=p_message_id
     and sender_id=v_user
     and unsent_at is null
     and created_at >= now() - interval '15 minutes';
  get diagnostics v_rows = row_count;
  if v_rows=0 then raise exception 'Message can no longer be unsent' using errcode='42501'; end if;
  return true;
end $$;

create or replace function public.set_message_expiry(p_message_id uuid, p_expires_at timestamptz)
returns boolean
language plpgsql
security definer
set search_path=public,pg_temp
as $$
declare
  v_user uuid := auth.uid();
  v_rows integer;
begin
  if v_user is null then raise exception 'Sign in required' using errcode='28000'; end if;
  update public.messages
     set expires_at=p_expires_at
   where id=p_message_id
     and sender_id=v_user
     and (p_expires_at is null or p_expires_at > now());
  get diagnostics v_rows = row_count;
  if v_rows=0 then raise exception 'Message expiry could not be changed' using errcode='42501'; end if;
  return true;
end $$;

create or replace function public.schedule_encrypted_message(
  p_conversation_id uuid,
  p_ciphertext text,
  p_nonce text,
  p_scheduled_for timestamptz,
  p_client_message_id text,
  p_expires_at timestamptz default null
)
returns uuid
language plpgsql
security definer
set search_path=public,pg_temp
as $$
declare
  v_user uuid := auth.uid();
  v_id uuid;
begin
  if v_user is null then raise exception 'Sign in required' using errcode='28000'; end if;
  if p_scheduled_for <= now() then raise exception 'Scheduled time must be in the future'; end if;
  if p_scheduled_for > now() + interval '30 days' then raise exception 'Scheduled time is too far in the future'; end if;
  if not exists (select 1 from public.conversation_members where conversation_id=p_conversation_id and user_id=v_user) then
    raise exception 'Not a conversation member' using errcode='42501';
  end if;
  insert into public.scheduled_messages(conversation_id,sender_id,ciphertext,nonce,client_message_id,scheduled_for,expires_at)
  values(p_conversation_id,v_user,p_ciphertext,p_nonce,p_client_message_id,p_scheduled_for,p_expires_at)
  on conflict(sender_id,client_message_id) do update
    set ciphertext=excluded.ciphertext, nonce=excluded.nonce, scheduled_for=excluded.scheduled_for, expires_at=excluded.expires_at, cancelled_at=null, sent_at=null
  returning id into v_id;
  return v_id;
end $$;

create or replace function public.cancel_scheduled_message(p_message_id uuid)
returns boolean
language plpgsql
security definer
set search_path=public,pg_temp
as $$
declare v_user uuid := auth.uid(); v_rows integer;
begin
  if v_user is null then raise exception 'Sign in required' using errcode='28000'; end if;
  update public.scheduled_messages set cancelled_at=now()
   where id=p_message_id and sender_id=v_user and sent_at is null and cancelled_at is null;
  get diagnostics v_rows=row_count;
  if v_rows=0 then raise exception 'Scheduled message is no longer cancellable' using errcode='42501'; end if;
  return true;
end $$;

revoke all on function public.delete_message_for_me(uuid) from public,anon;
revoke all on function public.unsend_message(uuid) from public,anon;
revoke all on function public.set_message_expiry(uuid,timestamptz) from public,anon;
revoke all on function public.schedule_encrypted_message(uuid,text,text,timestamptz,text,timestamptz) from public,anon;
revoke all on function public.cancel_scheduled_message(uuid) from public,anon;
grant execute on function public.delete_message_for_me(uuid) to authenticated;
grant execute on function public.unsend_message(uuid) to authenticated;
grant execute on function public.set_message_expiry(uuid,timestamptz) to authenticated;
grant execute on function public.schedule_encrypted_message(uuid,text,text,timestamptz,text,timestamptz) to authenticated;
grant execute on function public.cancel_scheduled_message(uuid) to authenticated;
