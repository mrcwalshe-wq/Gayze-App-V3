-- Prevent two devices from creating different first conversation keys.
-- The bootstrap row records only the creator device, never the conversation key.
create or replace function public.save_conversation_key_envelope(
  p_conversation_id uuid,
  p_user_id uuid,
  p_device_id uuid,
  p_wrapped_key text,
  p_nonce text,
  p_created_by_device_id uuid
)
returns public.conversation_key_envelopes
language plpgsql
security definer
set search_path=public,pg_temp
as $$
declare
  v_row public.conversation_key_envelopes;
  v_inserted integer;
  v_creator uuid;
  v_creator_status text;
begin
  if auth.uid() is null then raise exception 'Sign in required'; end if;

  if not exists (
    select 1 from public.conversation_members
    where conversation_id=p_conversation_id and user_id=auth.uid()
  ) then raise exception 'Conversation membership required'; end if;

  if not exists (
    select 1
    from public.conversation_members cm
    join public.identity_devices d on d.user_id=cm.user_id
    where cm.conversation_id=p_conversation_id
      and d.device_id=p_device_id
      and d.user_id=p_user_id
      and d.status='active'
  ) then raise exception 'Target device is not an active conversation member'; end if;

  if not exists (
    select 1 from public.identity_devices
    where device_id=p_created_by_device_id
      and user_id=auth.uid()
      and status='active'
  ) then raise exception 'Envelope creator device is not authorised'; end if;

  -- The first envelope claims the conversation's key creator. A concurrent
  -- caller with another creator device blocks on the unique conversation row,
  -- then is rejected instead of writing an envelope for a different key.
  select creator_device_id into v_creator
  from public.conversation_key_bootstrap
  where conversation_id=p_conversation_id
  for update;

  if not found then
    insert into public.conversation_key_bootstrap(conversation_id,creator_device_id,claimed_at)
    values(p_conversation_id,p_created_by_device_id,now())
    on conflict (conversation_id) do nothing;

    select creator_device_id into v_creator
    from public.conversation_key_bootstrap
    where conversation_id=p_conversation_id
    for update;
  end if;

  if v_creator <> p_created_by_device_id then
    select status into v_creator_status
    from public.identity_devices
    where device_id=v_creator;

    if coalesce(v_creator_status,'revoked') <> 'active' then
      update public.conversation_key_bootstrap
        set creator_device_id=p_created_by_device_id, claimed_at=now()
      where conversation_id=p_conversation_id;
      v_creator := p_created_by_device_id;
    else
      raise exception 'Another device owns conversation key provisioning';
    end if;
  end if;

  insert into public.conversation_key_envelopes(
    conversation_id,user_id,device_id,wrapped_key,nonce,created_by_device_id
  )
  values(
    p_conversation_id,p_user_id,p_device_id,p_wrapped_key,p_nonce,p_created_by_device_id
  )
  on conflict do nothing
  returning * into v_row;

  get diagnostics v_inserted = row_count;
  if v_inserted = 1 then return v_row; end if;

  select * into v_row
  from public.conversation_key_envelopes
  where conversation_id=p_conversation_id and device_id=p_device_id
  limit 1;
  return v_row;
end;
$$;

revoke all on function public.save_conversation_key_envelope(uuid,uuid,uuid,text,text,uuid) from public,anon;
grant execute on function public.save_conversation_key_envelope(uuid,uuid,uuid,text,text,uuid) to authenticated;
