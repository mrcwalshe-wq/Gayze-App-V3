-- Messaging access-control hardening.
--
-- 1. SECURITY: `member_self_all` (ALL, authenticated, user_id = auth.uid()) let
--    any signed-in user INSERT themselves into ANY conversation and then read
--    its messages and key envelopes through the member-based SELECT policies.
--    The client never writes conversation_members directly: conversations and
--    both membership rows are created atomically, in one SECURITY DEFINER
--    transaction, by public.accept_interest(); members leave via
--    public.leave_conversation(). Dropping the policy therefore needs no
--    client change. conversation_members_member_read (SELECT) is untouched.
-- 2. Table privileges: anon and authenticated held INSERT/UPDATE/DELETE/TRUNCATE
--    on the messaging tables. RLS blocked most of it, but TRUNCATE is not
--    subject to RLS at all. Reduce each role to exactly what the client uses.
-- 3. accept_interest(): serialise the per-pair conversation lookup so two
--    simultaneous accepts (A->B and B->A) cannot create two conversations.

-- Fail fast instead of queueing behind long transactions (and blocking every
-- query behind us); re-run the migration if this ever trips.
set lock_timeout = '5s';

-- 1. Self-join exploit -------------------------------------------------------
drop policy if exists member_self_all on public.conversation_members;

-- 2. Privileges --------------------------------------------------------------
revoke all on table
  public.conversations,
  public.conversation_members,
  public.messages,
  public.conversation_key_envelopes,
  public.conversation_key_bootstrap,
  public.identity_devices
from anon;

revoke truncate, references, trigger on table
  public.conversations,
  public.conversation_members,
  public.messages,
  public.conversation_key_envelopes,
  public.conversation_key_bootstrap,
  public.identity_devices
from authenticated;

-- Conversations/memberships are written only by SECURITY DEFINER RPCs.
revoke insert, update, delete on table public.conversations, public.conversation_members from authenticated;

-- The client inserts messages and reads them. Edit/unsend/expiry/delete-for-me
-- all run through SECURITY DEFINER RPCs, so a member can never rewrite
-- ciphertext in place.
revoke update, delete on table public.messages from authenticated;

-- Envelopes and bootstrap claims are written only by the guarded RPCs.
revoke insert, update, delete on table
  public.conversation_key_envelopes,
  public.conversation_key_bootstrap
from authenticated;

-- Device rows are written only by register_identity_device / revoke_identity_device
-- (which enforce the fingerprint and recent-verification rules). The self_insert and
-- self_update policies let a user bypass both, including un-revoking a device.
drop policy if exists identity_devices_self_insert on public.identity_devices;
drop policy if exists identity_devices_self_update on public.identity_devices;
revoke insert, update, delete on table public.identity_devices from authenticated;

-- 3. One conversation per pair ----------------------------------------------
create or replace function public.accept_interest(p_interest_id uuid)
returns jsonb
language plpgsql
security definer
set search_path to 'public', 'private'
as $function$
declare uid uuid:=auth.uid(); v_from uuid; v_to uuid; v_conversation uuid;
begin
  if uid is null then raise exception 'not authenticated'; end if;
  select from_user_id,to_user_id into v_from,v_to from public.interests where id=p_interest_id and status='pending' for update;
  if v_from is null or v_to is null then raise exception 'interest is unavailable'; end if;
  if v_to<>uid then raise exception 'not authorized'; end if;
  update public.interests set status='mutual' where id=p_interest_id;
  -- Both directions of a pair take the same lock, so the lookup below sees any
  -- conversation committed by a concurrent accept.
  perform pg_advisory_xact_lock(hashtextextended(least(uid::text, v_from::text) || ':' || greatest(uid::text, v_from::text), 0));
  select cm.conversation_id into v_conversation from public.conversation_members cm join public.conversation_members cm2 on cm2.conversation_id=cm.conversation_id where cm.user_id=uid and cm2.user_id=v_from limit 1;
  if v_conversation is null then
    insert into public.conversations default values returning id into v_conversation;
    insert into public.conversation_members(conversation_id,user_id) values(v_conversation,uid),(v_conversation,v_from);
  end if;
  perform public.gayze_connection_notification(v_conversation);
  return jsonb_build_object('accepted',true,'interest_id',p_interest_id,'conversation_id',v_conversation,'recipient_id',v_from);
end;
$function$;
