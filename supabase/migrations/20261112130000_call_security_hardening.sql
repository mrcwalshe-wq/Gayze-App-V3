-- 1. An accepted GAYZE must only ever be recorded by the server.
--    People could insert their own row into public.interests with status = 'mutual' (the insert policy only checked
--    from_user_id, and the triggers skip rows that are not 'pending'), which satisfied the "accepted GAYZE" check for calls.
--    The app never writes this table directly: sending, accepting and declining all go through SECURITY DEFINER functions
--    (submit_interest, accept_interest, decline_interest), which are unaffected.
drop policy if exists interests_sender_insert on public.interests;
revoke insert, update, delete, truncate, references, trigger on public.interests from anon, authenticated;
revoke select on public.interests from anon;

-- 2. Call signals to a person's own topic (ring, cancel, decline) may only be sent by someone who shares a conversation
--    with them. Any signed-in person could send to any gayze-user-<id> topic before.
do $$
begin
  if to_regclass('realtime.messages') is null then return; end if;
  execute 'drop policy if exists gayze_webrtc_private_send on realtime.messages';
  execute $policy$
    create policy gayze_webrtc_private_send on realtime.messages for insert to authenticated
    with check (
      extension = 'broadcast' and (
        (select realtime.topic()) = 'gayze-user-' || (select auth.uid())::text
        or (
          (select realtime.topic()) ~ '^gayze-user-[0-9a-fA-F-]{36}$'
          and exists (
            select 1
            from public.conversation_members recipient_member
            join public.conversation_members sender_member on sender_member.conversation_id = recipient_member.conversation_id
            where recipient_member.user_id::text = substring((select realtime.topic()) from 12)
              and sender_member.user_id = (select auth.uid())
          )
        )
        or (
          (select realtime.topic()) ~ '^gayze-call-[0-9a-fA-F-]{36}$'
          and exists (
            select 1 from public.conversation_members cm
            where cm.conversation_id::text = substring((select realtime.topic()) from 12)
              and cm.user_id = (select auth.uid())
          )
        )
      )
    )
  $policy$;
end $$;
