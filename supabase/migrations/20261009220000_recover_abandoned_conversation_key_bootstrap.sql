-- Recover E2EE bootstrap locks owned by devices that are no longer members.
-- No message rows, ciphertext, device identities, or envelopes are modified.
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
  v_creator_user_id uuid;
  v_creator_is_member boolean := false;
begin
  if v_uid is null then raise exception 'Sign in required'; end if;
  if not exists (
    select 1 from public.conversation_members
    where conversation_id=p_conversation_id and user_id=v_uid
  ) then raise exception 'Conversation membership required'; end if;
  if not exists (
    select 1 from public.identity_devices
    where device_id=p_device_id and user_id=v_uid and status='active'
  ) then raise exception 'Creator device is not authorised'; end if;

  select creator_device_id, claimed_at into v_creator, v_claimed_at
  from public.conversation_key_bootstrap
  where conversation_id=p_conversation_id for update;

  if not found then
    insert into public.conversation_key_bootstrap(conversation_id,creator_device_id,claimed_at)
    values(p_conversation_id,p_device_id,now())
    on conflict (conversation_id) do nothing;
    select creator_device_id, claimed_at into v_creator, v_claimed_at
    from public.conversation_key_bootstrap
    where conversation_id=p_conversation_id for update;
  end if;

  if v_creator=p_device_id then
    update public.conversation_key_bootstrap set claimed_at=now()
    where conversation_id=p_conversation_id and creator_device_id=p_device_id;
    return true;
  end if;

  select d.user_id into v_creator_user_id
  from public.identity_devices d
  where d.device_id=v_creator and d.status='active';
  if v_creator_user_id is not null then
    select exists (
      select 1 from public.conversation_members cm
      where cm.conversation_id=p_conversation_id and cm.user_id=v_creator_user_id
    ) into v_creator_is_member;
  end if;

  if not v_creator_is_member or v_claimed_at < now() - interval '30 seconds' then
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

create or replace function public.guard_conversation_key_envelope_creator()
returns trigger language plpgsql security definer set search_path=public,pg_temp
as $$
declare
  v_creator uuid;
  v_creator_user_id uuid;
  v_creator_is_member boolean := false;
  v_status text;
begin
  select creator_device_id into v_creator
  from public.conversation_key_bootstrap
  where conversation_id=new.conversation_id for update;

  if not found then
    insert into public.conversation_key_bootstrap(conversation_id,creator_device_id,claimed_at)
    values(new.conversation_id,new.created_by_device_id,now())
    on conflict (conversation_id) do nothing;
    select creator_device_id into v_creator
    from public.conversation_key_bootstrap
    where conversation_id=new.conversation_id for update;
  end if;

  if v_creator is distinct from new.created_by_device_id then
    select user_id,status into v_creator_user_id,v_status
    from public.identity_devices where device_id=v_creator;
    if v_creator_user_id is not null and coalesce(v_status,'revoked')='active' then
      select exists (
        select 1 from public.conversation_members cm
        where cm.conversation_id=new.conversation_id and cm.user_id=v_creator_user_id
      ) into v_creator_is_member;
    end if;
    if not v_creator_is_member then
      update public.conversation_key_bootstrap
        set creator_device_id=new.created_by_device_id,claimed_at=now()
      where conversation_id=new.conversation_id;
    else
      raise exception 'Another authorised conversation member owns key provisioning';
    end if;
  end if;
  return new;
end;
$$;
