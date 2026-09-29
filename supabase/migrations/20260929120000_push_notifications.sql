-- ===========================================================================
-- GAYZE — Web Push notifications
--
-- Adds:
--   1. public.push_subscriptions       — one row per browser/device endpoint
--   2. public.notification_preferences — per-user category switches
--   3. public.notification_dispatch_log — server-side exactly-once / anti-spam
--   4. Trigger + sweep plumbing that asks the `send-push` Edge Function to fan out
--
-- IMPORTANT — the base Gayze schema (profiles, messages, conversations,
-- conversation_members, intents, interests, safety_checkins, ...) is NOT
-- defined by any migration in this repository (see docs/BACKEND_REQUIREMENTS.md).
-- This migration therefore:
--   * never redefines or alters any pre-existing application object;
--   * refuses to run (preflight below) if a name it wants to own is already
--     taken by something it did not create;
--   * only attaches the `messages` trigger after confirming the table and the
--     three columns the trigger reads actually exist, and otherwise skips it
--     with a WARNING instead of failing or guessing;
--   * makes every trigger/sweep failure non-fatal to the originating write.
--
-- Security model:
--   * RLS is ON (and FORCED) for every table. A user can only ever see or
--     mutate their own rows. There is no policy that exposes another user's
--     endpoint or keys. RLS is NOT relaxed anywhere in this migration.
--   * The VAPID private key lives only in Edge Function secrets, never here
--     and never in a column.
--   * Preferences are enforced server-side inside the Edge Function as well as
--     being honoured by the UI (see "Preference helper" below).
-- ===========================================================================

create extension if not exists pgcrypto;

-- ---------------------------------------------------------------------------
-- 0. Preflight — never overwrite something this migration does not own.
--
--    Every object created here carries a comment that starts with 'gayze-push:'.
--    Re-running the migration is fine (it finds its own objects); colliding
--    with a pre-existing application object aborts the whole migration
--    (Supabase runs each migration in a transaction) before anything changes.
-- ---------------------------------------------------------------------------

do $$
declare
  v_fn  text;
  v_tbl text;
  v_oid oid;
begin
  foreach v_fn in array array[
    'public.gayze_push_set_updated_at()',
    'public.gayze_push_has_columns(text, text[])',
    'public.push_category_enabled(uuid, text)',
    'public.request_push_dispatch(jsonb)',
    'public.on_message_notify_push()',
    'public.sweep_expiring_intents()',
    'public.sweep_expired_safety_checkins()'
  ] loop
    v_oid := to_regprocedure(v_fn);
    if v_oid is not null
       and coalesce(obj_description(v_oid, 'pg_proc'), '') not like 'gayze-push:%' then
      raise exception
        '[GAYZE] % already exists and was not created by the push migration; refusing to overwrite it',
        v_fn;
    end if;
  end loop;

  foreach v_tbl in array array[
    'public.push_subscriptions',
    'public.notification_preferences',
    'public.notification_dispatch_log'
  ] loop
    v_oid := to_regclass(v_tbl);
    if v_oid is not null
       and coalesce(obj_description(v_oid, 'pg_class'), '') not like 'gayze-push:%' then
      raise exception
        '[GAYZE] table % already exists and was not created by the push migration; refusing to reuse it',
        v_tbl;
    end if;
  end loop;
end;
$$;

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
  'gayze-push: Web Push endpoints owned by a Gayze user. Never readable across users.';

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

-- Shared-device note: an endpoint belongs to exactly one user at a time
-- (UNIQUE endpoint). The client releases it on sign-out (unsubscribe + delete
-- under the signed-in user's own RLS). If that cleanup could not run, the next
-- user on the device is given a FRESH endpoint by the client instead of
-- re-claiming the old one, and the old endpoint is revoked with the push
-- service, so it can only ever 404/410 and is pruned by `send-push`. No
-- policy here lets one user take over another user's row.

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
  'gayze-push: per-user push categories. Enforced server-side by the send-push function.';

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
-- 3. Dispatch log — server-side exactly-once / anti-spam
--
--    (user_id, category, dedupe_key) is UNIQUE. Claiming a key is an INSERT;
--    a second claim fails with unique_violation, which is how "exactly once"
--    is enforced for connection, intent-expiry and safety pushes.
-- ---------------------------------------------------------------------------

create table if not exists public.notification_dispatch_log (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null references auth.users (id) on delete cascade,
  category     text not null,
  dedupe_key   text not null,
  created_at   timestamptz not null default now(),
  constraint notification_dispatch_dedupe_key unique (user_id, category, dedupe_key)
);

comment on table public.notification_dispatch_log is
  'gayze-push: service-role-only exactly-once ledger for push dispatches.';

create index if not exists notification_dispatch_log_recent_idx
  on public.notification_dispatch_log (user_id, category, created_at desc);

alter table public.notification_dispatch_log enable row level security;
alter table public.notification_dispatch_log force row level security;

-- Deliberately no policies for `authenticated`: this table is service-role only.
-- Users never read or write their own dispatch log.

-- ---------------------------------------------------------------------------
-- 4. Helpers
--
--    `updated_at` maintenance uses a push-specific function. The generic name
--    `touch_updated_at` is deliberately NOT used: it may already exist in the
--    live project with different behaviour, and `create or replace` would
--    silently change it for every table that uses it.
-- ---------------------------------------------------------------------------

create or replace function public.gayze_push_set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

comment on function public.gayze_push_set_updated_at() is
  'gayze-push: maintains updated_at on push tables only.';

drop trigger if exists push_subscriptions_touch on public.push_subscriptions;
create trigger push_subscriptions_touch
  before update on public.push_subscriptions
  for each row execute function public.gayze_push_set_updated_at();

drop trigger if exists notification_preferences_touch on public.notification_preferences;
create trigger notification_preferences_touch
  before update on public.notification_preferences
  for each row execute function public.gayze_push_set_updated_at();

-- True only when `public.<p_table>` is an ordinary/partitioned table that has
-- every column in p_columns. Used to avoid guessing about the base schema.
create or replace function public.gayze_push_has_columns(p_table text, p_columns text[])
returns boolean
language sql
stable
set search_path = pg_catalog, public
as $$
  select
    exists (
      select 1
        from pg_class c
        join pg_namespace n on n.oid = c.relnamespace
       where n.nspname = 'public' and c.relname = p_table and c.relkind in ('r', 'p')
    )
    and (
      select count(distinct a.attname)
        from pg_attribute a
        join pg_class c on c.oid = a.attrelid
        join pg_namespace n on n.oid = c.relnamespace
       where n.nspname = 'public'
         and c.relname = p_table
         and a.attnum > 0
         and not a.attisdropped
         and a.attname = any (p_columns)
    ) = cardinality(p_columns);
$$;

comment on function public.gayze_push_has_columns(text, text[]) is
  'gayze-push: schema guard used by the push triggers and sweeps.';

revoke all on function public.gayze_push_has_columns(text, text[]) from public, anon, authenticated;

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

comment on function public.push_category_enabled(uuid, text) is
  'gayze-push: server-side preference gate for send-push.';

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

comment on function public.request_push_dispatch(jsonb) is
  'gayze-push: pg_net bridge to the send-push Edge Function (never raises).';

revoke all on function public.request_push_dispatch(jsonb) from public, anon, authenticated;

-- 6a. New message -> notify every other conversation member.
--     The body is wrapped so that NO failure here (missing profile row,
--     unexpected column, pg_net down) can ever abort the message INSERT.
create or replace function public.on_message_notify_push()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_sender_name text;
begin
  begin
    begin
      select coalesce(nullif(trim(p.display_name), ''), 'Someone')
        into v_sender_name
        from public.profiles p
       where p.id = new.sender_id;
    exception when others then
      v_sender_name := null;
    end;

    perform public.request_push_dispatch(jsonb_build_object(
      'event', 'message',
      'conversationId', new.conversation_id,
      'senderId', new.sender_id,
      'senderName', coalesce(v_sender_name, 'Someone'),
      'messageId', new.id
    ));
  exception when others then
    raise warning '[GAYZE] message push trigger failed: %', sqlerrm;
  end;

  return new;
end;
$$;

comment on function public.on_message_notify_push() is
  'gayze-push: AFTER INSERT trigger body for public.messages (never raises).';

revoke all on function public.on_message_notify_push() from public, anon, authenticated;

-- Attach only to a real `messages` table that has the columns the trigger
-- reads (id, conversation_id, sender_id — all three are written/selected by the
-- client in src/services/supabaseService.ts). Otherwise skip with a warning.
do $$
begin
  if public.gayze_push_has_columns('messages', array['id', 'conversation_id', 'sender_id']) then
    execute 'drop trigger if exists messages_notify_push on public.messages';
    execute 'create trigger messages_notify_push
               after insert on public.messages
               for each row execute function public.on_message_notify_push()';
  else
    raise warning
      '[GAYZE] public.messages (id, conversation_id, sender_id) not found; message push trigger NOT installed';
  end if;
end;
$$;

-- 6b. "Connection" (mutual interest) is intentionally NOT a database trigger.
--
--     The state transition to "mutual" happens inside the `submit_interest`
--     RPC, whose definition is not in this repository, so there is no table
--     event this migration can safely treat as "mutual was just created".
--     The authoritative signal is the RPC's own result ({ mutual, conversation_id }).
--     The client forwards exactly that to `send-push` (action: 'connection'),
--     which verifies the caller belongs to that two-person conversation and then
--     claims (peer, 'connection', conversation_id) in notification_dispatch_log,
--     so the push fires at most once per conversation regardless of retries or
--     of both users calling it.
--
--     Likewise there is no interests trigger for the generic "someone is
--     interested" (`intent`) push: it would need interests.to_user_id /
--     interests.intent_id, which are not confirmed by anything in this repo.

-- 6c. Intent expiry sweep. Schedule with pg_cron, e.g.:
--   select cron.schedule('gayze-intent-expiry', '*/5 * * * *',
--                        $$select public.sweep_expiring_intents()$$);
--   Columns read: intents.id, user_id, expires_at, is_paused (all read or
--   written by src/services/supabaseService.ts).
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
  if not public.gayze_push_has_columns('intents', array['id', 'user_id', 'expires_at', 'is_paused']) then
    raise warning '[GAYZE] public.intents (id, user_id, expires_at, is_paused) not found; intent expiry sweep skipped';
    return 0;
  end if;

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

comment on function public.sweep_expiring_intents() is
  'gayze-push: cron sweep, one push per intent nearing expiry.';

revoke all on function public.sweep_expiring_intents() from public, anon, authenticated;

-- 6d. Safety check-in expiry.
--     A safety timer running out without the user ending it is a genuine
--     safety event — the only situation in which Gayze sends a safety push.
--     Only check-ins that expired within the last hour are considered, so the
--     first run can never replay historical check-ins that were simply never
--     closed. Schedule alongside the intent sweep:
--       select cron.schedule('gayze-safety-expiry', '* * * * *',
--                            $$select public.sweep_expired_safety_checkins()$$);
--     Columns read: safety_checkins.id, user_id, status, expires_at (all read
--     or written by src/services/supabaseService.ts).
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
  if not public.gayze_push_has_columns('safety_checkins', array['id', 'user_id', 'status', 'expires_at']) then
    raise warning '[GAYZE] public.safety_checkins (id, user_id, status, expires_at) not found; safety sweep skipped';
    return 0;
  end if;

  for v_row in
    select c.id, c.user_id
      from public.safety_checkins c
     where c.status = 'active'
       and c.expires_at <= now()
       and c.expires_at >  now() - interval '1 hour'
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

comment on function public.sweep_expired_safety_checkins() is
  'gayze-push: cron sweep, one push per expired safety check-in.';

revoke all on function public.sweep_expired_safety_checkins() from public, anon, authenticated;
