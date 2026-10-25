-- Owner-only admin console: roles, audit log, restrictions and read models.
--
-- Design:
--   * Authorisation is a row in public.app_admins. Nothing in the browser can read
--     or write it: RLS is on with no policies and every client role is revoked.
--   * All admin reads/writes go through the `admin-api` Edge Function, which
--     authenticates the caller's JWT, checks app_admins with the service role,
--     rate limits, executes the action and writes public.admin_audit_log.
--   * The helper functions below are executable by service_role only, so even a
--     signed-in user calling /rest/v1/rpc/admin_* directly is refused.
--   * No owner is granted here. Bootstrap is a deliberate, one-off statement
--     documented in docs/ADMIN_GUIDE.md.

create table if not exists public.app_admins (
  user_id uuid primary key references auth.users (id) on delete cascade,
  role text not null check (role in ('owner', 'admin')),
  granted_by uuid,
  created_at timestamptz not null default now()
);
-- At most one owner.
create unique index if not exists app_admins_single_owner on public.app_admins ((role)) where role = 'owner';
alter table public.app_admins enable row level security;
revoke all on public.app_admins from anon, authenticated;

create table if not exists public.admin_audit_log (
  id bigint generated always as identity primary key,
  actor_id uuid,
  action text not null,
  target_type text,
  target_id text,
  outcome text not null check (outcome in ('success', 'denied', 'error', 'reauth_required')),
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create index if not exists admin_audit_log_created_idx on public.admin_audit_log (created_at desc);
create index if not exists admin_audit_log_actor_idx on public.admin_audit_log (actor_id, created_at desc);
create index if not exists admin_audit_log_target_idx on public.admin_audit_log (target_id, created_at desc);
alter table public.admin_audit_log enable row level security;
revoke all on public.admin_audit_log from anon, authenticated;

create or replace function public.admin_audit_log_immutable()
returns trigger language plpgsql set search_path = public, pg_temp as $$
begin
  raise exception 'admin_audit_log is append-only';
end $$;
drop trigger if exists admin_audit_log_no_update on public.admin_audit_log;
create trigger admin_audit_log_no_update before update or delete on public.admin_audit_log
  for each row execute function public.admin_audit_log_immutable();
revoke execute on function public.admin_audit_log_immutable() from public, anon, authenticated;

create table if not exists public.account_restrictions (
  user_id uuid primary key references auth.users (id) on delete cascade,
  status text not null check (status in ('suspended')),
  reason text,
  created_by uuid,
  created_at timestamptz not null default now()
);
alter table public.account_restrictions enable row level security;
revoke all on public.account_restrictions from anon, authenticated;

-- Dashboard metrics. Only counts; never message content or locations.
create or replace function public.admin_dashboard_metrics()
returns jsonb language plpgsql stable security definer set search_path = public, auth, cron, pg_temp as $$
declare out jsonb;
begin
  select jsonb_build_object(
    'generatedAt', now(),
    'registrations', jsonb_build_object(
      'total', (select count(*) from auth.users),
      'last24h', (select count(*) from auth.users where created_at > now() - interval '24 hours'),
      'last7d', (select count(*) from auth.users where created_at > now() - interval '7 days'),
      'last30d', (select count(*) from auth.users where created_at > now() - interval '30 days'),
      'unverified', (select count(*) from auth.users where email_confirmed_at is null)
    ),
    -- "Active" = profile.last_seen_at inside the window (set by the app's presence heartbeat).
    'active', jsonb_build_object(
      'definition', 'profiles.last_seen_at within window',
      'last24h', (select count(*) from public.profiles where last_seen_at > now() - interval '24 hours'),
      'last7d', (select count(*) from public.profiles where last_seen_at > now() - interval '7 days')
    ),
    'intents', jsonb_build_object(
      'live', (select count(*) from public.intents where expires_at > now() and not coalesce(is_paused, false)),
      'paused', (select count(*) from public.intents where expires_at > now() and coalesce(is_paused, false)),
      'expired', (select count(*) from public.intents where expires_at <= now()),
      'createdLast24h', (select count(*) from public.intents where created_at > now() - interval '24 hours')
    ),
    'messaging', jsonb_build_object(
      'conversations', (select count(*) from public.conversations),
      'messagesLast24h', (select count(*) from public.messages where created_at > now() - interval '24 hours'),
      'messagesLast7d', (select count(*) from public.messages where created_at > now() - interval '7 days')
    ),
    'moderation', jsonb_build_object(
      'openReports', (select count(*) from public.reports where coalesce(status, 'open') = 'open'),
      'totalReports', (select count(*) from public.reports),
      'blocks', (select count(*) from public.blocks),
      'suspended', (select count(*) from public.account_restrictions where status = 'suspended')
    ),
    'notifications', jsonb_build_object(
      'pushSubscriptions', (select count(*) from public.push_subscriptions),
      'inboxLast24h', (select count(*) from public.gayze_notifications where created_at > now() - interval '24 hours'),
      'deliveriesLast24h', coalesce((
        select jsonb_object_agg(state, n) from (
          select state, count(*) n from public.gayze_notification_deliveries
          where created_at > now() - interval '24 hours' group by state
        ) s), '{}'::jsonb)
    ),
    'jobs', jsonb_build_object(
      'cronRunsLast24h', (select count(*) from cron.job_run_details where start_time > now() - interval '24 hours'),
      'cronFailedLast24h', (select count(*) from cron.job_run_details where start_time > now() - interval '24 hours' and status = 'failed')
    )
  ) into out;
  return out;
end $$;

-- Searchable, paginated account directory.
create or replace function public.admin_list_accounts(p_query text, p_limit int, p_offset int)
returns jsonb language plpgsql stable security definer set search_path = public, auth, pg_temp as $$
declare q text := nullif(btrim(coalesce(p_query, '')), '');
        lim int := greatest(1, least(coalesce(p_limit, 25), 100));
        off int := greatest(0, coalesce(p_offset, 0));
        total bigint; rows jsonb;
begin
  select count(*) into total
  from auth.users u left join public.profiles p on p.id = u.id
  where q is null or u.email ilike '%' || q || '%' or p.display_name ilike '%' || q || '%'
     or p.handle ilike '%' || q || '%' or u.id::text = q;

  select coalesce(jsonb_agg(r order by (r->>'createdAt') desc), '[]'::jsonb) into rows from (
    select jsonb_build_object(
      'id', u.id,
      'email', u.email,
      'displayName', p.display_name,
      'createdAt', u.created_at,
      'lastSignInAt', u.last_sign_in_at,
      'emailVerified', u.email_confirmed_at is not null,
      'providers', coalesce((select jsonb_agg(i.provider order by i.provider) from auth.identities i where i.user_id = u.id), '[]'::jsonb),
      'profileComplete', (p.display_name is not null and p.age is not null and p.avatar_path is not null),
      'status', case when ar.user_id is not null then 'suspended' else 'active' end,
      'reportsAgainst', (select count(*) from public.reports r2 where r2.reported_id = u.id),
      'role', a.role
    ) r
    from auth.users u
    left join public.profiles p on p.id = u.id
    left join public.account_restrictions ar on ar.user_id = u.id
    left join public.app_admins a on a.user_id = u.id
    where q is null or u.email ilike '%' || q || '%' or p.display_name ilike '%' || q || '%'
       or p.handle ilike '%' || q || '%' or u.id::text = q
    order by u.created_at desc
    limit lim offset off
  ) t;
  return jsonb_build_object('total', total, 'limit', lim, 'offset', off, 'rows', rows);
end $$;

-- One account's operational detail. No message content, no precise location.
create or replace function public.admin_account_detail(p_user uuid)
returns jsonb language plpgsql stable security definer set search_path = public, auth, pg_temp as $$
declare out jsonb;
begin
  select jsonb_build_object(
    'id', u.id,
    'email', u.email,
    'phone', u.phone is not null,
    'createdAt', u.created_at,
    'lastSignInAt', u.last_sign_in_at,
    'emailVerifiedAt', u.email_confirmed_at,
    'bannedUntil', u.banned_until,
    'providers', coalesce((select jsonb_agg(jsonb_build_object('provider', i.provider, 'createdAt', i.created_at, 'lastSignInAt', i.last_sign_in_at)) from auth.identities i where i.user_id = u.id), '[]'::jsonb),
    'profile', (select jsonb_build_object(
        'displayName', p.display_name, 'handle', p.handle, 'age', p.age, 'hasAvatar', p.avatar_path is not null,
        'hasBio', coalesce(length(btrim(p.bio)), 0) > 0, 'privacy', p.privacy_setting,
        'lastSeenAt', p.last_seen_at, 'hideOnlineStatus', p.hide_online_status,
        'safetyVerified', p.safety_verified, 'photos', (select count(*) from public.profile_photos pp where pp.user_id = p.id)
      ) from public.profiles p where p.id = u.id),
    'restriction', (select jsonb_build_object('status', ar.status, 'reason', ar.reason, 'createdAt', ar.created_at) from public.account_restrictions ar where ar.user_id = u.id),
    'counts', jsonb_build_object(
      'liveIntents', (select count(*) from public.intents i where i.user_id = u.id and i.expires_at > now()),
      'conversations', (select count(*) from public.conversation_members cm where cm.user_id = u.id),
      'pushSubscriptions', (select count(*) from public.push_subscriptions s where s.user_id = u.id),
      'reportsAgainst', (select count(*) from public.reports r where r.reported_id = u.id),
      'reportsFiled', (select count(*) from public.reports r where r.reporter_id = u.id),
      'blockedBy', (select count(*) from public.blocks b where b.blocked_id = u.id),
      'blocking', (select count(*) from public.blocks b where b.blocker_id = u.id)
    ),
    'reports', coalesce((select jsonb_agg(jsonb_build_object('id', r.id, 'reason', r.reason, 'status', r.status, 'createdAt', r.created_at) order by r.created_at desc)
        from (select * from public.reports where reported_id = u.id order by created_at desc limit 20) r), '[]'::jsonb),
    'role', (select a.role from public.app_admins a where a.user_id = u.id)
  ) into out
  from auth.users u where u.id = p_user;
  return out;
end $$;

-- Reversible side effects of a suspension (the sign-in ban itself is applied by the Edge Function).
create or replace function public.admin_set_suspension(p_user uuid, p_suspend boolean, p_reason text, p_actor uuid)
returns void language plpgsql security definer set search_path = public, auth, pg_temp as $$
begin
  if p_suspend then
    insert into public.account_restrictions (user_id, status, reason, created_by)
    values (p_user, 'suspended', left(p_reason, 500), p_actor)
    on conflict (user_id) do update set status = 'suspended', reason = excluded.reason, created_by = excluded.created_by, created_at = now();
    -- Stop being discoverable and stop receiving pushes while suspended.
    update public.intents set is_paused = true where user_id = p_user and expires_at > now();
    delete from public.push_subscriptions where user_id = p_user;
  else
    delete from public.account_restrictions where user_id = p_user;
  end if;
end $$;

-- Operational feeds.
create or replace function public.admin_delivery_failures(p_limit int)
returns jsonb language sql stable security definer set search_path = public, pg_temp as $$
  select coalesce(jsonb_agg(jsonb_build_object('notificationId', d.notification_id, 'state', d.state, 'statusCode', d.status_code, 'createdAt', d.created_at, 'host', split_part(split_part(d.endpoint, '://', 2), '/', 1)) order by d.created_at desc), '[]'::jsonb)
  from (select * from public.gayze_notification_deliveries where state <> 'accepted' order by created_at desc limit greatest(1, least(coalesce(p_limit, 50), 200))) d
$$;

create or replace function public.admin_failed_jobs(p_limit int)
returns jsonb language sql stable security definer set search_path = public, cron, pg_temp as $$
  select coalesce(jsonb_agg(jsonb_build_object('jobId', r.jobid, 'status', r.status, 'message', left(r.return_message, 300), 'startedAt', r.start_time) order by r.start_time desc), '[]'::jsonb)
  from (select * from cron.job_run_details where status = 'failed' order by start_time desc limit greatest(1, least(coalesce(p_limit, 50), 200))) r
$$;

do $$
declare fn text;
begin
  foreach fn in array array[
    'public.admin_dashboard_metrics()',
    'public.admin_list_accounts(text, integer, integer)',
    'public.admin_account_detail(uuid)',
    'public.admin_set_suspension(uuid, boolean, text, uuid)',
    'public.admin_delivery_failures(integer)',
    'public.admin_failed_jobs(integer)'
  ] loop
    execute format('revoke execute on function %s from public, anon, authenticated', fn);
    execute format('grant execute on function %s to service_role', fn);
  end loop;
end $$;
