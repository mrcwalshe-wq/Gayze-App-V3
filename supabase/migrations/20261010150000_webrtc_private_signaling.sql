-- Restrict GAYZE WebRTC signalling to authenticated call participants.
-- The client must join these topics with config.private = true.
-- Public-channel behaviour is unchanged; these policies govern private channels.

drop policy if exists "gayze_webrtc_private_read" on realtime.messages;
drop policy if exists "gayze_webrtc_private_send" on realtime.messages;

create policy "gayze_webrtc_private_read"
on realtime.messages
for select
to authenticated
using (
  (
    realtime.topic() = 'gayze-user-' || (select auth.uid())::text
  )
  or
  (
    realtime.topic() ~ '^gayze-call-[0-9a-fA-F-]{36}$'
    and exists (
      select 1
      from public.conversation_members cm
      where cm.conversation_id::text = substring(realtime.topic() from 12)
        and cm.user_id = (select auth.uid())
    )
  )
);

create policy "gayze_webrtc_private_send"
on realtime.messages
for insert
to authenticated
with check (
  (
    realtime.topic() ~ '^gayze-user-[0-9a-fA-F-]{36}$'
    and coalesce(payload->>'callerId', payload->'payload'->>'callerId') = (select auth.uid())::text
    and coalesce(payload->>'targetUserId', payload->'payload'->>'targetUserId') = substring(realtime.topic() from 12)
  )
  or
  (
    realtime.topic() ~ '^gayze-call-[0-9a-fA-F-]{36}$'
    and exists (
      select 1
      from public.conversation_members cm
      where cm.conversation_id::text = substring(realtime.topic() from 12)
        and cm.user_id = (select auth.uid())
    )
    and coalesce(payload->>'callerId', payload->'payload'->>'callerId') = (select auth.uid())::text
  )
);
