-- Database advisor hygiene (16 Nov 2026 advisor run). No behaviour change: indexes, three policy rewrites with identical
-- meaning, a surrogate key on a log table, a pinned search_path, and removal of policies that cannot change any decision.
-- Safe to run more than once. Nothing here reads or rewrites member data apart from adding the key column in section 3.

-- 1. unindexed_foreign_keys (24). One covering index per foreign key the advisor listed. Plain CREATE INDEX (not CONCURRENTLY,
--    which cannot run inside a migration transaction): these tables hold tens to a few thousand rows, so the lock is momentary.
--    Columns that are null on almost every row (who unsent, who revoked, who consumed, the acting admin) get a partial index,
--    the form this schema already uses for such columns and one the advisor accepts as covering.
create index if not exists admin_broadcasts_created_by_idx on public.admin_broadcasts (created_by);
create index if not exists album_photos_owner_id_idx on public.album_photos (owner_id);
create index if not exists album_shares_owner_id_idx on public.album_shares (owner_id);
create index if not exists call_sessions_caller_id_idx on public.call_sessions (caller_id);
create index if not exists call_sessions_conversation_id_idx on public.call_sessions (conversation_id);
create index if not exists call_signals_recipient_id_idx on public.call_signals (recipient_id);
create index if not exists call_signals_sender_id_idx on public.call_signals (sender_id);
create index if not exists conversation_archives_conversation_id_idx on public.conversation_archives (conversation_id);
create index if not exists conversation_key_envelopes_user_device_idx on public.conversation_key_envelopes (user_id, device_id);
create index if not exists gathering_rsvps_user_id_idx on public.gathering_rsvps (user_id);
create index if not exists gatherings_host_id_idx on public.gatherings (host_id);
create index if not exists gayze_notifications_actor_id_idx on public.gayze_notifications (actor_id) where actor_id is not null;
create index if not exists gazes_from_user_id_idx on public.gazes (from_user_id);
create index if not exists member_notices_actor_id_idx on public.member_notices (actor_id) where actor_id is not null;
create index if not exists message_user_state_user_id_idx on public.message_user_state (user_id);
create index if not exists messages_unsent_by_idx on public.messages (unsent_by) where unsent_by is not null;
create index if not exists past_meets_revoked_by_idx on public.past_meets (revoked_by) where revoked_by is not null;
create index if not exists past_meets_user_b_idx on public.past_meets (user_b);
create index if not exists peer_identity_verifications_peer_user_id_idx on public.peer_identity_verifications (peer_user_id);
create index if not exists qr_meet_tokens_consumed_by_idx on public.qr_meet_tokens (consumed_by) where consumed_by is not null;
create index if not exists reliability_events_counterparty_user_id_idx on public.reliability_events (counterparty_user_id);
create index if not exists reliability_events_source_event_id_idx on public.reliability_events (source_event_id) where source_event_id is not null;
create index if not exists scheduled_messages_conversation_id_idx on public.scheduled_messages (conversation_id);
create index if not exists stories_user_id_idx on public.stories (user_id);

-- 2. auth_rls_initplan on public.profile_photos. Same predicate (the row is yours); auth.uid() is wrapped in a scalar subquery so
--    it is evaluated once per statement instead of once per row. ALTER POLICY keeps the command and the role (authenticated).
alter policy profile_photos_insert_own on public.profile_photos with check (user_id = (select auth.uid()));
alter policy profile_photos_update_own on public.profile_photos using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
alter policy profile_photos_delete_own on public.profile_photos using (user_id = (select auth.uid()));

-- 3. no_primary_key on public.gayze_send_log. The table is an append-only send log (from, to, when) with no natural key that is
--    guaranteed unique, so it gets a surrogate identity key. Its only reader and writer, gayze_enforce_send_cooldown(), names its
--    columns explicitly, so an extra column changes nothing for it. The API roles have no access to this table.
do $$
begin
  if not exists (select 1 from pg_constraint where conrelid = 'public.gayze_send_log'::regclass and contype = 'p') then
    alter table public.gayze_send_log add column if not exists id bigint generated always as identity;
    alter table public.gayze_send_log add constraint gayze_send_log_pkey primary key (id);
  end if;
end $$;

-- 4. function_search_path_mutable on private.call_live_status. It is a pure CASE over its two arguments and references no
--    schema object, so an empty search_path is correct.
alter function private.call_live_status(text, timestamptz) set search_path = '';

-- 5. multiple_permissive_policies. Permissive policies for the same command are OR-ed together, so:
--    a) conversation_members.member_self_all is FOR ALL with USING (false) and WITH CHECK (false). "x OR false" is x for SELECT, and
--       for INSERT/UPDATE/DELETE "only a false policy" and "no policy" both deny (row level security stays enabled). Removing it
--       changes no decision. Membership is still written only by the SECURITY DEFINER functions.
--    b) safety_checkins has checkins_self_all (FOR ALL, user_id = auth.uid()) plus three single-command policies with the same
--       predicate for SELECT, INSERT and UPDATE. "x OR x" is x, so the three are removed and the FOR ALL policy, which also carries
--       DELETE, stays.
drop policy if exists member_self_all on public.conversation_members;
drop policy if exists "users read own safety checkins" on public.safety_checkins;
drop policy if exists "users create own safety checkins" on public.safety_checkins;
drop policy if exists "users update own safety checkins" on public.safety_checkins;
