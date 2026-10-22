-- Versioned conversation keys ("re-key") and provisioning-guard fix.
--
-- Root cause (see docs/messaging-root-cause.md): a conversation key was minted
-- once and was thereafter unrecoverable if every device that held it lost its
-- private key (browser storage eviction, reinstall, new phone). Production had
-- 13 conversations, 358 envelopes, and ALL 358 were created by the single
-- bootstrap-creator device of their conversation: the old
-- guard_conversation_key_envelope_creator() trigger rejected any other holder
-- while the creator device was still "active", so no second device could ever
-- be provisioned from anywhere else, and there was no way to start a fresh key.
--
-- This migration
--   * adds key_version to envelopes, bootstrap claims and messages (default 1:
--     every existing row is version 1, nothing is rewritten or deleted);
--   * lets a member mint version N+1 (explicit, user-confirmed "re-key");
--     old versions stay readable by devices that still hold them;
--   * lets ANY device that already holds a version provision it to the user's /
--     peer's other devices (the actual multi-device fix);
--   * records the creator's public key on the envelope, server-side, so an
--     envelope stays openable after the creating device is revoked.
-- Envelopes remain client-encrypted: the server never sees a conversation key.

-- Fail fast instead of queueing behind long transactions (and blocking every
-- query behind us); re-run the migration if this ever trips.
set lock_timeout = '5s';

-- Columns --------------------------------------------------------------------
alter table public.messages
  add column if not exists key_version integer not null default 1 check (key_version >= 1);

alter table public.conversation_key_envelopes
  add column if not exists key_version integer not null default 1 check (key_version >= 1),
  add column if not exists creator_public_key text;

alter table public.conversation_key_bootstrap
  add column if not exists key_version integer not null default 1 check (key_version >= 1);

-- Backfill the creator public key for existing envelopes. Revoked creators keep
-- their identity_devices row, so their key is still recoverable here.
update public.conversation_key_envelopes e
   set creator_public_key = d.public_key
  from public.identity_devices d
 where e.creator_public_key is null
   and e.created_by_device_id is not null
   and d.device_id = e.created_by_device_id
   and d.user_id in (
     select cm.user_id from public.conversation_members cm where cm.conversation_id = e.conversation_id
     union select e.user_id
   );

-- Keys ------------------------------------------------------------------------
alter table public.conversation_key_envelopes drop constraint conversation_key_envelopes_pkey;
alter table public.conversation_key_envelopes
  add constraint conversation_key_envelopes_pkey primary key (conversation_id, device_id, key_version);

alter table public.conversation_key_bootstrap drop constraint conversation_key_bootstrap_pkey;
alter table public.conversation_key_bootstrap
  add constraint conversation_key_bootstrap_pkey primary key (conversation_id, key_version);

create index if not exists conversation_key_envelopes_conversation_version_idx
  on public.conversation_key_envelopes (conversation_id, key_version);

-- Provisioning guard -------------------------------------------------------------
-- First envelope of a version: only the device that holds the claim may write it.
-- Any later envelope of that version: only an account that already holds the
-- version (on some device) may wrap it for another device. This replaces the
-- "only the bootstrap creator, forever" rule.
create or replace function public.guard_conversation_key_envelope_creator()
returns trigger
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $function$
declare
  v_claim uuid;
  v_max integer;
begin
  if exists (
    select 1 from public.conversation_key_envelopes e
    where e.conversation_id = new.conversation_id and e.key_version = new.key_version
  ) then
    if not exists (
      select 1 from public.conversation_key_envelopes e
      where e.conversation_id = new.conversation_id
        and e.key_version = new.key_version
        and e.user_id = (select auth.uid())
    ) then
      raise exception 'Only an account that already holds this key version can provision it' using errcode = '42501';
    end if;
    return new;
  end if;

  select coalesce(max(e.key_version), 0) into v_max
  from public.conversation_key_envelopes e where e.conversation_id = new.conversation_id;
  if new.key_version <> v_max + 1 then
    raise exception 'Key version % is not the next version for this conversation', new.key_version using errcode = '22023';
  end if;

  select b.creator_device_id into v_claim
  from public.conversation_key_bootstrap b
  where b.conversation_id = new.conversation_id and b.key_version = new.key_version;
  if v_claim is distinct from new.created_by_device_id then
    raise exception 'This key version is claimed by another device' using errcode = '42501';
  end if;
  return new;
end;
$function$;

-- Claim ---------------------------------------------------------------------------
drop function if exists public.claim_conversation_key_bootstrap(uuid, uuid);

create or replace function public.claim_conversation_key_bootstrap(
  p_conversation_id uuid,
  p_device_id uuid,
  p_key_version integer default 1
)
returns boolean
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $function$
declare
  v_uid uuid := auth.uid();
  v_creator uuid;
  v_claimed_at timestamptz;
  v_creator_user_id uuid;
  v_creator_is_member boolean := false;
  v_max integer;
begin
  if v_uid is null then raise exception 'Sign in required'; end if;
  if p_key_version is null or p_key_version < 1 then raise exception 'Invalid key version'; end if;

  if not exists (
    select 1 from public.conversation_members
    where conversation_id = p_conversation_id and user_id = v_uid
  ) then raise exception 'Conversation membership required'; end if;

  if not exists (
    select 1 from public.identity_devices
    where device_id = p_device_id and user_id = v_uid and status = 'active'
  ) then raise exception 'Creator device is not authorised'; end if;

  -- Serialise every claim for this conversation.
  perform 1 from public.conversations where id = p_conversation_id for update;

  select coalesce(max(key_version), 0) into v_max
  from public.conversation_key_envelopes where conversation_id = p_conversation_id;

  -- A key version that already has envelopes is never re-minted; only the next
  -- version can be claimed.
  if p_key_version <> v_max + 1 then return false; end if;

  select creator_device_id, claimed_at into v_creator, v_claimed_at
  from public.conversation_key_bootstrap
  where conversation_id = p_conversation_id and key_version = p_key_version
  for update;

  if not found then
    insert into public.conversation_key_bootstrap(conversation_id, key_version, creator_device_id, claimed_at)
    values (p_conversation_id, p_key_version, p_device_id, now());
    return true;
  end if;

  if v_creator = p_device_id then
    update public.conversation_key_bootstrap set claimed_at = now()
    where conversation_id = p_conversation_id and key_version = p_key_version;
    return true;
  end if;

  select d.user_id into v_creator_user_id
  from public.identity_devices d
  where d.device_id = v_creator and d.status = 'active'
  limit 1;

  if v_creator_user_id is not null then
    select exists (
      select 1 from public.conversation_members cm
      where cm.conversation_id = p_conversation_id and cm.user_id = v_creator_user_id
    ) into v_creator_is_member;
  end if;

  -- A claim held by a revoked, missing or departed device, or older than 30s, is abandoned.
  if not v_creator_is_member or v_claimed_at < now() - interval '30 seconds' then
    update public.conversation_key_bootstrap
       set creator_device_id = p_device_id, claimed_at = now()
     where conversation_id = p_conversation_id and key_version = p_key_version;
    return true;
  end if;

  return false;
end;
$function$;

revoke all on function public.claim_conversation_key_bootstrap(uuid, uuid, integer) from public, anon;
grant execute on function public.claim_conversation_key_bootstrap(uuid, uuid, integer) to authenticated, service_role;

-- Save envelope -----------------------------------------------------------------
drop function if exists public.save_conversation_key_envelope(uuid, uuid, uuid, text, text, uuid);

create or replace function public.save_conversation_key_envelope(
  p_conversation_id uuid,
  p_user_id uuid,
  p_device_id uuid,
  p_wrapped_key text,
  p_nonce text,
  p_created_by_device_id uuid,
  p_key_version integer default 1
)
returns public.conversation_key_envelopes
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $function$
declare
  v_row public.conversation_key_envelopes;
  v_creator_key text;
begin
  if auth.uid() is null then raise exception 'Sign in required'; end if;
  if p_key_version is null or p_key_version < 1 then raise exception 'Invalid key version'; end if;
  if p_wrapped_key !~ '^[0-9a-f]+$' or length(p_wrapped_key) not between 2 and 1024
     or p_nonce !~ '^[0-9a-f]+$' or length(p_nonce) not between 2 and 128 then
    raise exception 'Malformed envelope';
  end if;

  if not exists (
    select 1 from public.conversation_members
    where conversation_id = p_conversation_id and user_id = auth.uid()
  ) then raise exception 'Conversation membership required'; end if;

  if not exists (
    select 1
    from public.conversation_members cm
    join public.identity_devices d on d.user_id = cm.user_id
    where cm.conversation_id = p_conversation_id
      and d.device_id = p_device_id
      and d.user_id = p_user_id
      and d.status = 'active'
  ) then raise exception 'Target device is not an active conversation member'; end if;

  select d.public_key into v_creator_key
  from public.identity_devices d
  where d.device_id = p_created_by_device_id and d.user_id = auth.uid() and d.status = 'active';
  if v_creator_key is null then raise exception 'Envelope creator device is not authorised'; end if;

  insert into public.conversation_key_envelopes(
    conversation_id, user_id, device_id, wrapped_key, nonce, created_by_device_id, key_version, creator_public_key
  )
  values (
    p_conversation_id, p_user_id, p_device_id, p_wrapped_key, p_nonce, p_created_by_device_id, p_key_version, v_creator_key
  )
  on conflict (conversation_id, device_id, key_version) do nothing
  returning * into v_row;

  if v_row.conversation_id is not null then return v_row; end if;

  select * into v_row
  from public.conversation_key_envelopes
  where conversation_id = p_conversation_id and device_id = p_device_id and key_version = p_key_version
  limit 1;
  return v_row;
end;
$function$;

revoke all on function public.save_conversation_key_envelope(uuid, uuid, uuid, text, text, uuid, integer) from public, anon;
grant execute on function public.save_conversation_key_envelope(uuid, uuid, uuid, text, text, uuid, integer) to authenticated, service_role;

-- Messages may only reference a key version that exists ----------------------
create or replace function public.guard_message_key_version()
returns trigger
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $function$
begin
  if new.key_version > greatest(1, coalesce(
    (select max(e.key_version) from public.conversation_key_envelopes e where e.conversation_id = new.conversation_id), 1)) then
    raise exception 'Unknown conversation key version' using errcode = '22023';
  end if;
  return new;
end;
$function$;

drop trigger if exists messages_guard_key_version on public.messages;
create trigger messages_guard_key_version
  before insert on public.messages
  for each row execute function public.guard_message_key_version();
