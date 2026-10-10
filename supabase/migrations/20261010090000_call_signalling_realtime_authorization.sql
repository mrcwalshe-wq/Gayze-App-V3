-- WebRTC call signalling authorization (Supabase Realtime private channels).
--
-- The client now joins its personal channel `gayze-user-<userId>` and each call
-- channel `gayze-call-<conversationId>` with config.private = true. For private
-- channels Realtime evaluates RLS on realtime.messages, so until these policies
-- exist ALL call signalling is denied. Previously any authenticated client could
-- subscribe to another user's ring channel and inject SDP/ICE for any call.
--
-- Rules:
--   * Only the owner of gayze-user-<uid> may receive on it.
--   * A broadcast must carry payload.callerId = auth.uid(): nobody can speak as a peer.
--   * Ringing (a call-request/call-end sent to a user channel) requires the sender and
--     the target to share the conversation named in the payload.
--   * Call-channel traffic requires conversation membership of the topic's conversation.
--
-- Assumes public.conversation_members(conversation_id, user_id) as used throughout the
-- existing migrations (its DDL is not in this repository).

create or replace function public.gayze_call_is_member(p_conversation text)
returns boolean
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
begin
  if auth.uid() is null or p_conversation is null then return false; end if;
  return exists (
    select 1 from public.conversation_members m
    where m.conversation_id::text = p_conversation and m.user_id = auth.uid()
  );
end
$$;

create or replace function public.gayze_call_pair_member(p_conversation text, p_peer text)
returns boolean
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
begin
  if auth.uid() is null or p_conversation is null or p_peer is null then return false; end if;
  return exists (
    select 1
    from public.conversation_members me
    join public.conversation_members peer on peer.conversation_id = me.conversation_id
    where me.conversation_id::text = p_conversation
      and me.user_id = auth.uid()
      and peer.user_id::text = p_peer
  );
end
$$;

revoke all on function public.gayze_call_is_member(text) from public;
revoke all on function public.gayze_call_pair_member(text, text) from public;
grant execute on function public.gayze_call_is_member(text) to authenticated;
grant execute on function public.gayze_call_pair_member(text, text) to authenticated;

alter table realtime.messages enable row level security;

drop policy if exists gayze_call_signal_receive on realtime.messages;
create policy gayze_call_signal_receive on realtime.messages
for select to authenticated
using (
  extension = 'broadcast'
  and (
    realtime.topic() = 'gayze-user-' || auth.uid()::text
    or (
      realtime.topic() like 'gayze-call-%'
      and public.gayze_call_is_member(substring(realtime.topic() from 12))
    )
  )
);

drop policy if exists gayze_call_signal_send on realtime.messages;
create policy gayze_call_signal_send on realtime.messages
for insert to authenticated
with check (
  extension = 'broadcast'
  and event = 'call-signal'
  and payload->>'callerId' = auth.uid()::text
  and (
    (
      realtime.topic() = 'gayze-user-' || (payload->>'targetUserId')
      and public.gayze_call_pair_member(payload->>'conversationId', payload->>'targetUserId')
    )
    or (
      realtime.topic() like 'gayze-call-%'
      and substring(realtime.topic() from 12) = payload->>'conversationId'
      and public.gayze_call_is_member(payload->>'conversationId')
    )
  )
);
