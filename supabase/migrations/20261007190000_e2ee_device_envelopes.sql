-- Device-aware E2EE hardening for direct and group conversations.
-- Existing ciphertext and existing envelopes are never rewritten or deleted.
-- A key is generated only when the conversation has been read successfully
-- and no envelope exists at all.

create or replace function public.get_conversation_member_devices(p_conversation_id uuid)
returns table(
  user_id uuid,
  device_id uuid,
  public_key text,
  device_label text,
  last_seen_at timestamptz,
  status text
)
language sql
security definer
stable
set search_path=public,pg_temp
as $$
  select d.user_id,d.device_id,d.public_key,d.device_label,d.last_seen_at,d.status
  from public.conversation_members cm
  join public.identity_devices d
    on d.user_id=cm.user_id
   and d.status='active'
  where cm.conversation_id=p_conversation_id
    and exists (
      select 1 from public.conversation_members me
      where me.conversation_id=p_conversation_id
        and me.user_id=(select auth.uid())
    )
  order by cm.user_id,d.created_at;
$$;

revoke all on function public.get_conversation_member_devices(uuid) from public,anon;
grant execute on function public.get_conversation_member_devices(uuid) to authenticated;

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
declare v_row public.conversation_key_envelopes;
  v_inserted integer;
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
