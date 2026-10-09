-- Fix device identifier foreign keys for E2EE envelopes.
-- The client stores identity_devices.device_id, not the table row id.
-- A device_id is unique per user, so enforce the recipient relation as a composite FK.
alter table public.conversation_key_envelopes
  drop constraint if exists conversation_key_envelopes_device_id_fkey;

alter table public.conversation_key_envelopes
  add constraint conversation_key_envelopes_user_device_fkey
  foreign key (user_id, device_id)
  references public.identity_devices(user_id, device_id)
  on delete cascade;

-- created_by_device_id also stores device_id, not identity_devices.id.
-- Creator ownership and active status are validated in the RPC and trigger.
alter table public.conversation_key_envelopes
  drop constraint if exists conversation_key_envelopes_created_by_device_id_fkey;
