-- Restrict GAYZE WebRTC signalling to authenticated private channels.
-- The WebRTC client joins these topics with config.private = true.
-- Existing public channels are unchanged by these policies.

drop policy if exists "gayze_webrtc_private_read" on realtime.messages;
drop policy if exists "gayze_webrtc_private_send" on realtime.messages;

create policy "gayze_webrtc_private_read"
on realtime.messages
for select
to authenticated
using (
  extension = 'broadcast'
  and (
    (select realtime.topic()) = 'gayze-user-' || (select auth.uid())::text
    or (
      (select realtime.topic()) ~ '^gayze-call-[0-9a-fA-F-]{36}$'
      and exists (
        select 1
        from public.conversation_members cm
        where cm.conversation_id::text = substring((select realtime.topic()) from 12)
          and cm.user_id = (select auth.uid())
      )
    )
  )
);

create policy "gayze_webrtc_private_send"
on realtime.messages
for insert
to authenticated
with check (
  extension = 'broadcast'
  and (
    -- The recipient alone can read their user feed. Any authenticated user
    -- may send a ring event to that feed; the client validates the referenced
    -- conversation and caller before presenting the incoming-call UI.
    (select realtime.topic()) ~ '^gayze-user-[0-9a-fA-F-]{36}$'
    or (
      (select realtime.topic()) ~ '^gayze-call-[0-9a-fA-F-]{36}$'
      and exists (
        select 1
        from public.conversation_members cm
        where cm.conversation_id::text = substring((select realtime.topic()) from 12)
          and cm.user_id = (select auth.uid())
      )
    )
  )
);
