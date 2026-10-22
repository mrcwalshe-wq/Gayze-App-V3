-- Faithful replica of the PRODUCTION messaging schema (qdewyupsqmtonkloqxsh) as
-- introspected on 2026-10-22, BEFORE the 20261022* migrations. Policies, grants,
-- constraints, triggers and function bodies are copied from pg_policies,
-- information_schema.role_table_grants, pg_constraint and pg_get_functiondef.
-- Only unrelated pieces (push/notification triggers) are stubbed.
create role anon nologin; create role authenticated nologin; create role service_role nologin bypassrls;
create schema auth; create schema private;
create table auth.users(id uuid primary key);
create function auth.uid() returns uuid language sql stable as
  $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
grant usage on schema auth, private, public to anon, authenticated, service_role;
create table public.profiles(id uuid primary key);

create table public.conversations(
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now());
create table public.conversation_members(
  conversation_id uuid not null references public.conversations(id) on delete cascade,
  user_id uuid not null,
  joined_at timestamptz not null default now(),
  primary key (conversation_id, user_id));
create index conversation_members_user_id_idx on public.conversation_members(user_id);

create table public.messages(
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references public.conversations(id) on delete cascade,
  sender_id uuid not null,
  ciphertext text not null,
  nonce text,
  created_at timestamptz not null default now(),
  expires_at timestamptz,
  burned_at timestamptz,
  unsent_at timestamptz,
  unsent_by uuid,
  scheduled_message_id uuid,
  client_message_id text);
create unique index messages_sender_client_message_id_uq on public.messages(sender_id, client_message_id) where client_message_id is not null;

create table public.identity_devices(
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  device_fingerprint text, device_label text, public_key text not null,
  status text not null default 'active' check (status in ('active','revoked')),
  created_at timestamptz not null default now(), last_seen_at timestamptz not null default now(),
  revoked_at timestamptz, signing_public_key text,
  device_id uuid, identity_fingerprint text);
create unique index identity_devices_user_device_idx on public.identity_devices(user_id, device_id);

create table public.conversation_key_envelopes(
  conversation_id uuid not null references public.conversations(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  device_id uuid not null,
  wrapped_key text not null, nonce text not null,
  created_by_device_id uuid,
  created_at timestamptz not null default now(),
  primary key (conversation_id, device_id),
  constraint conversation_key_envelopes_user_device_fkey foreign key (user_id, device_id)
    references public.identity_devices(user_id, device_id) on delete cascade);
create table public.conversation_key_bootstrap(
  conversation_id uuid primary key references public.conversations(id) on delete cascade,
  creator_device_id uuid not null,
  claimed_at timestamptz not null default now());
create table public.interests(
  id uuid primary key default gen_random_uuid(),
  from_user_id uuid not null, to_user_id uuid not null,
  created_at timestamptz not null default now(),
  status text not null default 'pending',
  intent_id uuid, message text, shared_photo_ids uuid[] not null default '{}',
  unique (from_user_id, to_user_id));
create table public.spatial_ref_sys(srid int primary key, srtext text);

alter table public.conversations enable row level security;
alter table public.conversation_members enable row level security;
alter table public.messages enable row level security;
alter table public.identity_devices enable row level security;
alter table public.conversation_key_envelopes enable row level security;
alter table public.conversation_key_bootstrap enable row level security;
alter table public.interests enable row level security;

create function private.user_conversation_ids() returns setof uuid language sql stable security definer set search_path to '' as
$$ select cm.conversation_id from public.conversation_members cm where cm.user_id = (select auth.uid()) $$;

create policy conversation_key_envelopes_member_select on public.conversation_key_envelopes for select to authenticated
  using (exists (select 1 from public.conversation_members cm where cm.conversation_id = conversation_key_envelopes.conversation_id and cm.user_id = (select auth.uid())));
create policy conversation_key_envelopes_own_insert on public.conversation_key_envelopes for insert to authenticated
  with check ((user_id = (select auth.uid())) and exists (select 1 from public.identity_devices d where d.id = conversation_key_envelopes.device_id and d.user_id = (select auth.uid()) and d.status = 'active') and exists (select 1 from public.conversation_members cm where cm.conversation_id = conversation_key_envelopes.conversation_id and cm.user_id = (select auth.uid())));
create policy conversation_members_member_read on public.conversation_members for select to authenticated
  using (conversation_id in (select private.user_conversation_ids()));
create policy member_self_all on public.conversation_members for all to authenticated
  using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
create policy conv_member_select on public.conversations for select to authenticated
  using (exists (select 1 from public.conversation_members cm where cm.conversation_id = conversations.id and cm.user_id = (select auth.uid())));
create policy identity_devices_self_insert on public.identity_devices for insert to authenticated with check ((select auth.uid()) = user_id);
create policy identity_devices_self_select on public.identity_devices for select to authenticated using ((select auth.uid()) = user_id);
create policy identity_devices_self_update on public.identity_devices for update to authenticated using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
create policy messages_member_insert on public.messages for insert to authenticated
  with check (((select auth.uid()) = sender_id) and exists (select 1 from public.conversation_members cm where cm.conversation_id = messages.conversation_id and cm.user_id = (select auth.uid())));
create policy messages_member_select on public.messages for select to authenticated
  using (exists (select 1 from public.conversation_members cm where cm.conversation_id = messages.conversation_id and cm.user_id = (select auth.uid())));
create policy interests_participant_select on public.interests for select to authenticated using ((select auth.uid()) in (from_user_id, to_user_id));

-- Production default grants (Supabase gives anon/authenticated everything).
grant all on all tables in schema public to anon, authenticated, service_role;

create function public.gayze_connection_notification(p_conversation uuid) returns void language sql as $$ select $$;

create function public.leave_conversation(p_conversation_id uuid) returns boolean language plpgsql security definer set search_path to 'public','pg_temp' as $function$
declare v_user uuid := auth.uid(); v_rows integer;
begin
  if v_user is null then raise exception 'Sign in required' using errcode='28000'; end if;
  delete from public.conversation_members where conversation_id=p_conversation_id and user_id=v_user;
  get diagnostics v_rows = row_count;
  if v_rows=0 then raise exception 'Not a conversation member' using errcode='42501'; end if;
  return true;
end $function$;

create function public.get_conversation_member_devices(p_conversation_id uuid)
returns table(user_id uuid, device_id uuid, public_key text, device_label text, last_seen_at timestamptz, status text)
language sql stable security definer set search_path to 'public','pg_temp' as $function$
  select d.user_id,d.device_id,d.public_key,d.device_label,d.last_seen_at,d.status
  from public.conversation_members cm join public.identity_devices d on d.user_id=cm.user_id and d.status='active'
  where cm.conversation_id=p_conversation_id
    and exists (select 1 from public.conversation_members me where me.conversation_id=p_conversation_id and me.user_id=(select auth.uid()))
  order by cm.user_id,d.created_at;
$function$;

create function public.accept_interest(p_interest_id uuid) returns jsonb language plpgsql security definer set search_path to 'public','private' as $function$
declare uid uuid:=auth.uid(); v_from uuid; v_to uuid; v_conversation uuid;
begin
  if uid is null then raise exception 'not authenticated'; end if;
  select from_user_id,to_user_id into v_from,v_to from public.interests where id=p_interest_id and status='pending' for update;
  if v_from is null or v_to is null then raise exception 'interest is unavailable'; end if;
  if v_to<>uid then raise exception 'not authorized'; end if;
  update public.interests set status='mutual' where id=p_interest_id;
  select cm.conversation_id into v_conversation from public.conversation_members cm join public.conversation_members cm2 on cm2.conversation_id=cm.conversation_id where cm.user_id=uid and cm2.user_id=v_from limit 1;
  if v_conversation is null then
    insert into public.conversations default values returning id into v_conversation;
    insert into public.conversation_members(conversation_id,user_id) values(v_conversation,uid),(v_conversation,v_from);
  end if;
  perform public.gayze_connection_notification(v_conversation);
  return jsonb_build_object('accepted',true,'interest_id',p_interest_id,'conversation_id',v_conversation,'recipient_id',v_from);
end; $function$;

-- Pre-migration key RPCs/guard exactly as in production.
create function public.guard_conversation_key_envelope_creator() returns trigger language plpgsql security definer set search_path to 'public','pg_temp' as $function$
declare v_creator uuid; v_creator_user_id uuid; v_creator_is_member boolean := false; v_status text;
begin
  select creator_device_id into v_creator from public.conversation_key_bootstrap where conversation_id=new.conversation_id for update;
  if not found then
    insert into public.conversation_key_bootstrap(conversation_id,creator_device_id,claimed_at) values(new.conversation_id,new.created_by_device_id,now()) on conflict (conversation_id) do nothing;
    select creator_device_id into v_creator from public.conversation_key_bootstrap where conversation_id=new.conversation_id for update;
  end if;
  if v_creator is distinct from new.created_by_device_id then
    select user_id,status into v_creator_user_id,v_status from public.identity_devices where device_id=v_creator;
    if v_creator_user_id is not null and coalesce(v_status,'revoked')='active' then
      select exists (select 1 from public.conversation_members cm where cm.conversation_id=new.conversation_id and cm.user_id=v_creator_user_id) into v_creator_is_member;
    end if;
    if not v_creator_is_member then
      update public.conversation_key_bootstrap set creator_device_id=new.created_by_device_id,claimed_at=now() where conversation_id=new.conversation_id;
    else
      raise exception 'Another authorised conversation member owns key provisioning';
    end if;
  end if;
  return new;
end; $function$;
create trigger trg_guard_conversation_key_envelope_creator before insert on public.conversation_key_envelopes for each row execute function public.guard_conversation_key_envelope_creator();

create function public.claim_conversation_key_bootstrap(p_conversation_id uuid, p_device_id uuid) returns boolean language plpgsql security definer set search_path to 'public','pg_temp' as $function$
declare v_uid uuid := auth.uid(); v_creator uuid; v_claimed_at timestamptz; v_creator_user_id uuid; v_creator_is_member boolean := false;
begin
  if v_uid is null then raise exception 'Sign in required'; end if;
  if not exists (select 1 from public.conversation_members where conversation_id=p_conversation_id and user_id=v_uid) then raise exception 'Conversation membership required'; end if;
  if not exists (select 1 from public.identity_devices where device_id=p_device_id and user_id=v_uid and status='active') then raise exception 'Creator device is not authorised'; end if;
  select creator_device_id, claimed_at into v_creator, v_claimed_at from public.conversation_key_bootstrap where conversation_id=p_conversation_id for update;
  if not found then
    insert into public.conversation_key_bootstrap(conversation_id,creator_device_id,claimed_at) values(p_conversation_id,p_device_id,now()) on conflict (conversation_id) do nothing;
    select creator_device_id, claimed_at into v_creator, v_claimed_at from public.conversation_key_bootstrap where conversation_id=p_conversation_id for update;
  end if;
  if v_creator=p_device_id then
    update public.conversation_key_bootstrap set claimed_at=now() where conversation_id=p_conversation_id and creator_device_id=p_device_id;
    return true;
  end if;
  select d.user_id into v_creator_user_id from public.identity_devices d where d.device_id=v_creator and d.status='active';
  if v_creator_user_id is not null then
    select exists (select 1 from public.conversation_members cm where cm.conversation_id=p_conversation_id and cm.user_id=v_creator_user_id) into v_creator_is_member;
  end if;
  if not v_creator_is_member or v_claimed_at < now() - interval '30 seconds' then
    update public.conversation_key_bootstrap set creator_device_id=p_device_id, claimed_at=now() where conversation_id=p_conversation_id;
    return true;
  end if;
  return false;
end; $function$;

create function public.save_conversation_key_envelope(p_conversation_id uuid, p_user_id uuid, p_device_id uuid, p_wrapped_key text, p_nonce text, p_created_by_device_id uuid)
returns public.conversation_key_envelopes language plpgsql security definer set search_path to 'public','pg_temp' as $function$
declare v_row public.conversation_key_envelopes; v_inserted integer;
begin
  if auth.uid() is null then raise exception 'Sign in required'; end if;
  if not exists (select 1 from public.conversation_members where conversation_id=p_conversation_id and user_id=auth.uid()) then raise exception 'Conversation membership required'; end if;
  if not exists (select 1 from public.conversation_members cm join public.identity_devices d on d.user_id=cm.user_id where cm.conversation_id=p_conversation_id and d.device_id=p_device_id and d.user_id=p_user_id and d.status='active') then raise exception 'Target device is not an active conversation member'; end if;
  if not exists (select 1 from public.identity_devices where device_id=p_created_by_device_id and user_id=auth.uid() and status='active') then raise exception 'Envelope creator device is not authorised'; end if;
  insert into public.conversation_key_envelopes(conversation_id,user_id,device_id,wrapped_key,nonce,created_by_device_id)
  values(p_conversation_id,p_user_id,p_device_id,p_wrapped_key,p_nonce,p_created_by_device_id) on conflict do nothing returning * into v_row;
  get diagnostics v_inserted = row_count;
  if v_inserted = 1 then return v_row; end if;
  select * into v_row from public.conversation_key_envelopes where conversation_id=p_conversation_id and device_id=p_device_id limit 1;
  return v_row;
end; $function$;
revoke all on function public.save_conversation_key_envelope(uuid,uuid,uuid,text,text,uuid), public.claim_conversation_key_bootstrap(uuid,uuid) from public, anon;
grant execute on function public.save_conversation_key_envelope(uuid,uuid,uuid,text,text,uuid), public.claim_conversation_key_bootstrap(uuid,uuid) to authenticated;
revoke all on function public.accept_interest(uuid), public.leave_conversation(uuid), public.get_conversation_member_devices(uuid) from public, anon;
grant execute on function public.accept_interest(uuid), public.leave_conversation(uuid), public.get_conversation_member_devices(uuid) to authenticated, service_role;
