-- ===========================================================================
-- GAYZE — Web Push notifications
--
-- Adds:
--   1. public.push_subscriptions      — one row per browser/device endpoint
--   2. public.notification_preferences — per-user category switches
--   3. public.notification_dispatch_log — server-side de-duplication / anti-spam
--   4. Trigger plumbing that asks the `send-push` Edge Function to fan out
--
-- Security model:
--   * RLS is ON for every table. A user can only ever see or mutate their own
--     rows. There is no policy that exposes another user's endpoint or keys.
--   * The VAPID private key lives only in Edge Function secrets, never here
--     and never in a column.
--   * Preferences are enforced server-side inside the Edge Function as well as
--     being honoured by the UI (see §Preference helper below).
-- ===========================================================================

create extension if not exists pgcrypto;

-- ---------------------------------------------------------------------------
-- 1. Push subscriptions
-- ---------------------------------------------------------------------------

create table if not exists public.push_subscriptions (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references auth.users (id) on delete cascade,
  endpoint    text not null,
  p256dh      text not null,
  auth        text not null,
  user_agent  text,
  platform    text,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  last_used_at timestamptz,
  constraint push_subscriptions_endpoint_key unique (endpoint)
);

comment on table public.push_subscriptions is
  'Web Push endpoints owned by a Gayze user. Never readable across users.';

create index if not exists push_subscriptions_user_id_idx
  on public.push_subscriptions (user_id);

alter table public.push_subscriptions enable row level security;
alter table public.push_subscriptions force row level security;

drop policy if exists "push_subscriptions_select_own" on public.push_subscriptions;
create policy "push_subscriptions_select_own"
  on public.push_subscriptions for select
  to authenticated
  using (user_id = (select auth.uid()));

-- A user may only ever insert a row that belongs to themselves. This is what
-- prevents user A from attaching user B's device endpoint to their own account.
drop policy if exists "push_subscriptions_insert_own" on public.push_subscriptions;
create policy "push_subscriptions_insert_own"
  on public.push_subscriptions for insert
  to authenticated
  with check (user_id = (select auth.uid()));

drop policy if exists "push_subscriptions_update_own" on public.push_subscriptions;
create policy "push_subscriptions_update_own"
  on public.push_subscriptions for update
  to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

drop policy if exists "push_subscriptions_delete_own" on public.push_subscriptions;
create policy "push_subscriptions_delete_own"
  on public.push_subscriptions for delete
  to authenticated
  using (user_id = (select auth.uid()));

-- ---------------------------------------------------------------------------
-- 2. Notification preferences
-- ---------------------------------------------------------------------------

create table if not exists public.notification_preferences (
  user_id            uuid primary key references auth.users (id) on delete cascade,
  push_enabled       boolean not null default true,
  messages           boolean not null default true,
  intent_activity    boolean not null default true,
  connections        boolean not null default true,
  intent_expiry      boolean not null default true,
  safety             boolean not null default true,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now()
);

comment on table public.notification_preferences is
  'Per-user push categories. Enforced server-side by the send-push function.';

alter table public.notification_preferences enable row level security;
alter table public.notification_preferences force row level security;

drop policy if exists "notification_preferences_select_own" on public.notification_preferences;
create policy "notification_preferences_select_own"
  on public.notification_preferences for select
  to authenticated
  using (user_id = (select auth.uid()));

drop policy if exists "notification_preferences_upsert_own" on public.notification_preferences;
create policy "notification_preferences_upsert_own"
  on public.notification_preferences for insert
  to authenticated
  with check (user_id = (select auth.uid()));

drop policy if exists "notification_preferences_update_own" on public.notification_preferences;
create policy "notification_preferences_update_own"
  on public.notification_preferences for update
  to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

-- ---------------------------------------------------------------------------
-- 3. Dispatch log — server-side anti-spam
-- ---------------------------------------------------------------------------

create table if not exists public.notification_dispatch_log (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null references auth.users (id) on delete cascade,
  category     text not null,
  dedupe_key   text not null,
  created_at   timestamptz not null default now(),
  constraint notification_dispatch_dedupe_key unique (user_id, category, dedupe_key)
);

create index if not exists notification_dispatch_log_recent_idx
  on public.notification_dispatch_log (user_id, category, created_at desc);

alter table public.notification_dispatch_log enable row level security;
alter table public.notification_dispatch_log force row level security;

-- Deliberately no policies for `authenticated`: this table is service-role only.
-- Users never read or write their own dispatch log.

-- ---------------------------------------------------------------------------
-- 4. updated_at maintenance
-- ---------------------------------------------------------------------------

create or replace function public.touch_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists push_subscriptions_touch on public.push_subscriptions;
create trigger push_subscriptions_touch
  before update on public.push_subscriptions
  for each row execute function public.touch_updated_at();

drop trigger if exists notification_preferences_touch on public.notification_preferences;
create trigger notification_preferences_touch
  before update on public.notification_preferences
  for each row execute function public.touch_updated_at();

-- ---------------------------------------------------------------------------
-- 5. Preference helper (used by the Edge Function via service role)
-- ---------------------------------------------------------------------------

create or replace function public.push_category_enabled(p_user uuid, p_category text)
returns boolean
language sql
security definer
set search_path = public
as $$
  select coalesce(
    (
      select
        prefs.push_enabled
        and case p_category
          when 'message'         then prefs.messages
          when 'intent'          then prefs.intent_activity
          when 'connection'      then prefs.connections
          when 'intent_expiring' then prefs.intent_expiry
          when 'safety'          then prefs.safety
          when 'test'            then true
          else true
        end
      from public.notification_preferences prefs
      where prefs.user_id = p_user
    ),
    -- No preference row yet => defaults are all-on.
    true
  );
$$;

revoke all on function public.push_category_enabled(uuid, text) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 6. Dispatch plumbing
--
-- `request_push_dispatch` posts an event to the `send-push` Edge Function using
-- pg_net. The function URL and the shared dispatch secret are read from Vault
-- so no secret is ever stored in a table or in this migration.
--
-- Required Vault secrets (Dashboard -> Project Settings -> Vault):
--   gayze_functions_url    e.g. https://<project-ref>.functions.supabase.co
--   gayze_push_dispatch_secret  a long random string, also set as the
--                               PUSH_DISPATCH_SECRET Edge Function secret.
--
-- If pg_net or the Vault secrets are absent this degrades to a no-op warning:
-- message delivery and the rest of Gayze are never blocked by push.
-- ---------------------------------------------------------------------------

create extension if not exists pg_net with schema extensions;

create or replace function public.request_push_dispatch(p_payload jsonb)
returns void
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_url    text;
  v_secret text;
begin
  begin
    select decrypted_secret into v_url
      from vault.decrypted_secrets where name = 'gayze_functions_url';
    select decrypted_secret into v_secret
      from vault.decrypted_secrets where name = 'gayze_push_dispatch_secret';
  exception when others then
    raise warning '[GAYZE] push dispatch secrets unavailable: %', sqlerrm;
    return;
  end;

  if v_url is null or v_secret is null then
    raise warning '[GAYZE] push dispatch not configured; skipping';
    return;
  end if;

  perform net.http_post(
    url     := v_url || '/send-push',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-gayze-dispatch-secret', v_secret
    ),
    body    := p_payload,
    timeout_milliseconds := 5000
  );
exception when others then
  -- Push must never break the originating write.
  raise warning '[GAYZE] push dispatch failed: %', sqlerrm;
end;
$$;

revoke all on function public.request_push_dispatch(jsonb) from public, anon, authenticated;

-- 6a. New message -> notify every other conversation member.
create or replace function public.on_message_notify_push()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_sender_name text;
begin
  select coalesce(nullif(trim(p.display_name), ''), 'Someone')
    into v_sender_name
    from public.profiles p
   where p.id = new.sender_id;

  perform public.request_push_dispatch(jsonb_build_object(
    'event', 'message',
    'conversationId', new.conversation_id,
    'senderId', new.sender_id,
    'senderName', coalesce(v_sender_name, 'Someone'),
    'messageId', new.id
  ));

  return new;
end;
$$;

drop trigger if exists messages_notify_push on public.messages;
create trigger messages_notify_push
  after insert on public.messages
  for each row execute function public.on_message_notify_push();

-- 6b. Interest in an intent.
--     A reciprocal interest is a real connection, so both sides are told and
--     the weaker "someone is interested" ping is suppressed for that case.
create or replace function public.on_interest_notify_push()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_mutual boolean;
begin
  select exists (
    select 1
      from public.interests prior
     where prior.from_user_id = new.to_user_id
       and prior.to_user_id   = new.from_user_id
       and prior.id <> new.id
       and coalesce(prior.status, 'pending') <> 'withdrawn'
  ) into v_mutual;

  if v_mutual then
    perform public.request_push_dispatch(jsonb_build_object(
      'event', 'connection', 'toUserId', new.to_user_id));
    perform public.request_push_dispatch(jsonb_build_object(
      'event', 'connection', 'toUserId', new.from_user_id));
  else
    perform public.request_push_dispatch(jsonb_build_object(
      'event', 'intent',
      'toUserId', new.to_user_id,
      'fromUserId', new.from_user_id,
      'intentId', new.intent_id
    ));
  end if;

  return new;
end;
$$;

do $$
begin
  if to_regclass('public.interests') is not null then
    execute 'drop trigger if exists interests_notify_push on public.interests';
    execute 'create trigger interests_notify_push
               after insert on public.interests
               for each row execute function public.on_interest_notify_push()';
  end if;
end;
$$;

-- 6c. Intent expiry sweep. Schedule with pg_cron, e.g.:
--   select cron.schedule('gayze-intent-expiry', '*/5 * * * *',
--                        $$select public.sweep_expiring_intents()$$);
create or replace function public.sweep_expiring_intents()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row   record;
  v_count integer := 0;
begin
  for v_row in
    select i.id, i.user_id, i.expires_at
      from public.intents i
     where i.is_paused is not true
       and i.expires_at > now()
       and i.expires_at <= now() + interval '15 minutes'
  loop
    -- One notification per intent, ever. This is the anti-spam guarantee.
    begin
      insert into public.notification_dispatch_log (user_id, category, dedupe_key)
      values (v_row.user_id, 'intent_expiring', v_row.id::text);
    exception when unique_violation then
      continue;
    end;

    perform public.request_push_dispatch(jsonb_build_object(
      'event', 'intent_expiring',
      'toUserId', v_row.user_id,
      'intentId', v_row.id,
      'expiresAt', v_row.expires_at
    ));
    v_count := v_count + 1;
  end loop;

  return v_count;
end;
$$;

revoke all on function public.sweep_expiring_intents() from public, anon, authenticated;

-- 6d. Safety check-in expiry.
--     A safety timer running out without the user ending it is a genuine
--     safety event — the only situation in which Gayze sends a safety push.
--     Schedule alongside the intent sweep:
--       select cron.schedule('gayze-safety-expiry', '* * * * *',
--                            $$select public.sweep_expired_safety_checkins()$$);
create or replace function public.sweep_expired_safety_checkins()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row   record;
  v_count integer := 0;
begin
  if to_regclass('public.safety_checkins') is null then
    return 0;
  end if;

  for v_row in
    select c.id, c.user_id
      from public.safety_checkins c
     where c.status = 'active'
       and c.expires_at <= now()
  loop
    -- One safety push per check-in, ever.
    begin
      insert into public.notification_dispatch_log (user_id, category, dedupe_key)
      values (v_row.user_id, 'safety', v_row.id::text);
    exception when unique_violation then
      continue;
    end;

    perform public.request_push_dispatch(jsonb_build_object(
      'event', 'safety',
      'toUserId', v_row.user_id,
      'message', 'Your safety check-in timer has ended. Confirm you are safe.'
    ));
    v_count := v_count + 1;
  end loop;

  return v_count;
end;
$$;

revoke all on function public.sweep_expired_safety_checkins() from public, anon, authenticated;
