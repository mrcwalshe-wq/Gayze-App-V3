-- Prevent two devices from creating different first conversation keys.
-- The bootstrap row records only the creator device, never the conversation key.
create or replace function public.guard_conversation_key_envelope_creator()
returns trigger language plpgsql security definer set search_path=public,pg_temp
as $$
declare
  v_creator uuid;
  v_status text;
begin
  select creator_device_id into v_creator
  from public.conversation_key_bootstrap
  where conversation_id=new.conversation_id
  for update;

  if not found then
    insert into public.conversation_key_bootstrap(conversation_id,creator_device_id,claimed_at)
    values(new.conversation_id,new.created_by_device_id,now())
    on conflict (conversation_id) do nothing;
    select creator_device_id into v_creator
    from public.conversation_key_bootstrap
    where conversation_id=new.conversation_id;
  end if;

  if v_creator <> new.created_by_device_id then
    select status into v_status
    from public.identity_devices
    where device_id=v_creator;

    if coalesce(v_status,'revoked') <> 'active' then
      update public.conversation_key_bootstrap
        set creator_device_id=new.created_by_device_id, claimed_at=now()
      where conversation_id=new.conversation_id;
    else
      raise exception 'Another device owns conversation key provisioning';
    end if;
  end if;

  return new;
end;
$$;

drop trigger if exists trg_guard_conversation_key_envelope_creator on public.conversation_key_envelopes;
create trigger trg_guard_conversation_key_envelope_creator
before insert on public.conversation_key_envelopes
for each row execute function public.guard_conversation_key_envelope_creator();
