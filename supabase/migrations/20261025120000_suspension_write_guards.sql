-- Suspension enforcement that does not depend on the PostgREST pre-request hook.
--
-- The hook (20261025111000) needs `alter role authenticator`, which Supabase reserves
-- for its superuser. Until it can be enabled, a suspended member is stopped here, at
-- the data layer: a BEFORE INSERT/UPDATE trigger on every table a member writes to
-- refuses the write when the caller's JWT subject has a row in account_restrictions.
--
-- Why triggers: they fire for direct REST writes AND for SECURITY DEFINER RPCs
-- (submit_interest, accept_interest, schedule_encrypted_message, ...), which bypass RLS.
-- Calls with no user subject (service role, pg_cron, auth triggers on sign-up) pass.
-- Reads of a member's own rows are not blocked; their sessions are deleted and the
-- account banned, so the access token simply lapses within its lifetime (3600 s).
-- Non-destructive: only adds a function and triggers.

create or replace function public.gayze_block_suspended_writes()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
declare uid uuid;
begin
  begin
    uid := nullif(current_setting('request.jwt.claims', true)::jsonb ->> 'sub', '')::uuid;
  exception when others then
    return new; -- no or non-user claims: nothing to enforce
  end;
  if uid is not null and exists (select 1 from public.account_restrictions where user_id = uid and status = 'suspended') then
    raise exception 'account_suspended' using errcode = 'PT403', hint = 'This account is suspended.';
  end if;
  return new;
end $$;
revoke execute on function public.gayze_block_suspended_writes() from public, anon, authenticated;

do $$
declare t text;
begin
  foreach t in array array[
    'messages', 'interests', 'gazes', 'intents', 'stories', 'scheduled_messages', 'conversation_members',
    'conversations', 'profile_photos', 'profiles', 'push_subscriptions', 'safety_checkins', 'gatherings',
    'gathering_rsvps', 'message_user_state'
  ] loop
    if to_regclass('public.' || t) is not null then
      execute format('create or replace trigger gayze_suspended_guard before insert or update on public.%I for each row execute function public.gayze_block_suspended_writes()', t);
    end if;
  end loop;
end $$;

-- Rollback: see docs/ADMIN_GUIDE.md ("Rolling back suspension enforcement").
