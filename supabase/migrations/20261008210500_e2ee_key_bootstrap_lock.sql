-- Serialize first-key creation for a conversation.
-- The key itself never enters this table; this is only a short-lived creator lock.
create table if not exists public.conversation_key_bootstrap (
  conversation_id uuid primary key references public.conversations(id) on delete cascade,
  creator_device_id uuid not null,
  claimed_at timestamptz not null default now()
);

alter table public.conversation_key_bootstrap enable row level security;

revoke all on table public.conversation_key_bootstrap from public,anon,authenticated;

create or replace function public.claim_conversation_key_bootstrap(
  p_conversation_id uuid,
  p_device_id uuid
)
returns boolean
language plpgsql
security definer
set search_path=public,pg_temp
as $$
declare
  v_uid uuid := auth.uid();
  v_creator uuid;
  v_claimed_at timestamptz;
begin
  if v_uid is null then raise exception 'Sign in required'; end if;

  if not exists (
    select 1 from public.conversation_members
    where conversation_id=p_conversation_id and user_id=v_uid
  ) then
    raise exception 'Conversation membership required';
  end if;

  if not exists (
    select 1 from public.identity_devices
    where device_id=p_device_id and user_id=v_uid and status='active'
  ) then
    raise exception 'Creator device is not authorised';
  end if;

  select creator_device_id, claimed_at
    into v_creator, v_claimed_at
  from public.conversation_key_bootstrap
  where conversation_id=p_conversation_id
  for update;

  if not found then
    insert into public.conversation_key_bootstrap(conversation_id,creator_device_id,claimed_at)
    values(p_conversation_id,p_device_id,now());
    return true;
  end if;

  if v_creator=p_device_id then
    return true;
  end if;

  if v_claimed_at < now() - interval '30 seconds' then
    update public.conversation_key_bootstrap
      set creator_device_id=p_device_id, claimed_at=now()
    where conversation_id=p_conversation_id;
    return true;
  end if;

  return false;
end;
$$;

revoke all on function public.claim_conversation_key_bootstrap(uuid,uuid) from public,anon;
grant execute on function public.claim_conversation_key_bootstrap(uuid,uuid) to authenticated;
