-- Admin console, part 2: owner bootstrap, suspension enforcement, rate limiting
-- and the remaining read models. Additive and non-destructive: nothing here
-- alters existing rows or existing application functions.
--
-- Replaces admin_list_accounts(text,int,int) from 20261025100000 with a version
-- that sorts (whitelisted). That earlier function has never been called by
-- anything but the admin Edge Function, which is introduced in this change.

-- ---------------------------------------------------------------------------
-- Owner bootstrap: controlled, one-off, never reachable from the browser.
-- ---------------------------------------------------------------------------
create or replace function public.admin_bootstrap_owner(p_email text)
returns jsonb language plpgsql security definer set search_path = public, auth, pg_temp as $$
declare
  matches int;
  uid uuid;
  verified timestamptz;
  banned timestamptz;
  removed timestamptz;
  idents int;
begin
  if exists (select 1 from public.app_admins where role = 'owner') then
    raise exception 'owner_already_exists';
  end if;
  if p_email is null or btrim(p_email) = '' then
    raise exception 'email_required';
  end if;

  select count(*) into matches from auth.users where lower(email) = lower(btrim(p_email));
  if matches <> 1 then
    raise exception 'expected_exactly_one_account_found_%', matches;
  end if;

  select u.id, u.email_confirmed_at, u.banned_until, u.deleted_at
    into uid, verified, banned, removed
  from auth.users u where lower(u.email) = lower(btrim(p_email));

  if verified is null then raise exception 'account_email_not_verified'; end if;
  if removed is not null then raise exception 'account_deleted'; end if;
  if banned is not null and banned > now() then raise exception 'account_banned'; end if;
  select count(*) into idents from auth.identities where user_id = uid;
  if idents = 0 then raise exception 'account_has_no_identity'; end if;

  insert into public.app_admins (user_id, role, granted_by) values (uid, 'owner', null);
  insert into public.admin_audit_log (actor_id, action, target_type, target_id, outcome, metadata)
  values (null, 'owner.bootstrap', 'user', uid::text, 'success',
          jsonb_build_object('method', 'sql_bootstrap', 'db_session_user', session_user, 'at', now()));

  return jsonb_build_object('userId', uid, 'role', 'owner');
end $$;

-- ---------------------------------------------------------------------------
-- Rate limiting: one counter per actor, per bucket name, per minute.
-- ---------------------------------------------------------------------------
create table if not exists public.admin_rate_window (
  actor text not null,
  bucket text not null,
  window_start timestamptz not null,
  hits int not null default 0,
  primary key (actor, bucket, window_start)
);
alter table public.admin_rate_window enable row level security;
revoke all on public.admin_rate_window from anon, authenticated;

-- Returns true while the caller is under the limit; false once exceeded.
create or replace function public.admin_rate_hit(p_actor text, p_bucket text, p_limit int)
returns boolean language plpgsql security definer set search_path = public, pg_temp as $$
declare w timestamptz := date_trunc('minute', now()); n int;
begin
  delete from public.admin_rate_window where window_start < now() - interval '1 hour';
  insert into public.admin_rate_window (actor, bucket, window_start, hits) values (left(p_actor, 80), left(p_bucket, 40), w, 1)
  on conflict (actor, bucket, window_start) do update set hits = public.admin_rate_window.hits + 1
  returning hits into n;
  return n <= p_limit;
end $$;

-- ---------------------------------------------------------------------------
-- Suspension enforcement for every PostgREST request (REST + RPC).
-- The Edge Function additionally bans the auth user (no new sign-ins/refresh)
-- and deletes their sessions.
-- ---------------------------------------------------------------------------
create or replace function public.gayze_pre_request()
returns void language plpgsql stable security definer set search_path = public, pg_temp as $$
declare uid uuid;
begin
  begin
    uid := nullif(current_setting('request.jwt.claims', true)::jsonb ->> 'sub', '')::uuid;
  exception when others then
    return; -- no or non-user claims (anon / service role): nothing to enforce
  end;
  if uid is null then return; end if;
  if exists (select 1 from public.account_restrictions where user_id = uid and status = 'suspended') then
    raise exception 'account_suspended' using errcode = 'PT403', hint = 'This account is suspended.';
  end if;
end $$;
grant execute on function public.gayze_pre_request() to anon, authenticated, service_role;

-- A signed-in client calls this once per session to learn whether it is suspended.
-- A suspended caller never reaches the body: gayze_pre_request() rejects them first.
create or replace function public.my_account_status()
returns text language sql stable security invoker set search_path = public, pg_temp as $$ select 'active'::text $$;
revoke execute on function public.my_account_status() from public, anon;
grant execute on function public.my_account_status() to authenticated;

-- The hook itself is switched on by the next migration, after the function has
-- been exercised, so a mistake here cannot take the API down.

-- ---------------------------------------------------------------------------
-- Session revocation. Deleting sessions cascades to refresh tokens, so the
-- device cannot mint another access token; the current one lapses at expiry.
-- ---------------------------------------------------------------------------
create or replace function public.admin_revoke_sessions(p_user uuid)
returns int language plpgsql security definer set search_path = public, auth, pg_temp as $$
declare n int;
begin
  with d as (delete from auth.sessions where user_id = p_user returning 1) select count(*) into n from d;
  return n;
end $$;

-- ---------------------------------------------------------------------------
-- Account directory with whitelisted sorting (replaces the unsorted version).
-- ---------------------------------------------------------------------------
drop function if exists public.admin_list_accounts(text, integer, integer);
create or replace function public.admin_list_accounts(p_query text, p_limit int, p_offset int, p_sort text default 'created_desc')
returns jsonb language plpgsql stable security definer set search_path = public, auth, pg_temp as $$
declare q text := nullif(btrim(coalesce(p_query, '')), '');
        -- LIKE metacharacters in the search text are literals, not wildcards.
        ql text := '%' || replace(replace(replace(coalesce(nullif(btrim(coalesce(p_query, '')), ''), ''), E'\\', E'\\\\'), '%', E'\\%'), '_', E'\\_') || '%';
        lim int := greatest(1, least(coalesce(p_limit, 25), 100));
        off int := greatest(0, least(coalesce(p_offset, 0), 100000));
        total bigint; rows jsonb;
begin
  select count(*) into total
  from auth.users u left join public.profiles p on p.id = u.id
  where q is null or u.email ilike ql or p.display_name ilike ql
     or p.handle ilike ql or u.id::text = q;

  select coalesce(jsonb_agg(t.r order by t.rn), '[]'::jsonb) into rows from (
    select row_number() over (order by
        case when p_sort = 'created_asc' then u.created_at end asc nulls last,
        case when p_sort = 'signin_desc' then u.last_sign_in_at end desc nulls last,
        case when p_sort = 'signin_asc' then u.last_sign_in_at end asc nulls last,
        case when p_sort = 'reports_desc' then (select count(*) from public.reports r3 where r3.reported_id = u.id) end desc nulls last,
        u.created_at desc) rn,
      jsonb_build_object(
        'id', u.id,
        'email', u.email,
        'displayName', p.display_name,
        'handle', p.handle,
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
    where q is null or u.email ilike ql or p.display_name ilike ql
       or p.handle ilike ql or u.id::text = q
    order by 1
    limit lim offset off
  ) t;
  return jsonb_build_object('total', total, 'limit', lim, 'offset', off, 'rows', rows);
end $$;

-- ---------------------------------------------------------------------------
-- Moderation, audit search, photo problems, auth events.
-- ---------------------------------------------------------------------------
create or replace function public.admin_list_reports(p_status text, p_limit int, p_offset int)
returns jsonb language plpgsql stable security definer set search_path = public, auth, pg_temp as $$
declare lim int := greatest(1, least(coalesce(p_limit, 25), 100));
        off int := greatest(0, least(coalesce(p_offset, 0), 100000));
        total bigint; rows jsonb;
begin
  select count(*) into total from public.reports r where p_status is null or r.status = p_status;
  select coalesce(jsonb_agg(x order by (x->>'createdAt') desc), '[]'::jsonb) into rows from (
    select jsonb_build_object(
      'id', r.id, 'reason', r.reason, 'details', left(r.details, 1000), 'status', r.status, 'createdAt', r.created_at,
      'reporterId', r.reporter_id, 'reportedId', r.reported_id,
      'reporterName', (select display_name from public.profiles where id = r.reporter_id),
      'reportedName', (select display_name from public.profiles where id = r.reported_id),
      'reportedSuspended', exists (select 1 from public.account_restrictions ar where ar.user_id = r.reported_id)
    ) x
    from public.reports r where p_status is null or r.status = p_status
    order by r.created_at desc limit lim offset off
  ) t;
  return jsonb_build_object('total', total, 'limit', lim, 'offset', off, 'rows', rows);
end $$;

create or replace function public.admin_update_report(p_report uuid, p_status text)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare prior text;
begin
  if p_status not in ('open', 'reviewing', 'resolved', 'dismissed') then raise exception 'invalid_status'; end if;
  select status into prior from public.reports where id = p_report for update;
  if not found then raise exception 'report_not_found'; end if;
  update public.reports set status = p_status where id = p_report;
  return jsonb_build_object('id', p_report, 'from', prior, 'to', p_status);
end $$;

create or replace function public.admin_audit_search(p_query text, p_outcome text, p_limit int, p_offset int)
returns jsonb language plpgsql stable security definer set search_path = public, auth, pg_temp as $$
declare q text := nullif(btrim(coalesce(p_query, '')), '');
        ql text := '%' || replace(replace(replace(coalesce(nullif(btrim(coalesce(p_query, '')), ''), ''), E'\\', E'\\\\'), '%', E'\\%'), '_', E'\\_') || '%';
        lim int := greatest(1, least(coalesce(p_limit, 50), 200));
        off int := greatest(0, least(coalesce(p_offset, 0), 100000));
        total bigint; rows jsonb;
begin
  select count(*) into total from public.admin_audit_log l
  where (p_outcome is null or l.outcome = p_outcome)
    and (q is null or l.action ilike ql or l.target_id = q or l.actor_id::text = q);
  select coalesce(jsonb_agg(x order by (x->>'id')::bigint desc), '[]'::jsonb) into rows from (
    select jsonb_build_object(
      'id', l.id, 'createdAt', l.created_at, 'action', l.action, 'outcome', l.outcome,
      'actorId', l.actor_id, 'actorEmail', (select email from auth.users where id = l.actor_id),
      'targetType', l.target_type, 'targetId', l.target_id, 'metadata', l.metadata
    ) x
    from public.admin_audit_log l
    where (p_outcome is null or l.outcome = p_outcome)
      and (q is null or l.action ilike ql or l.target_id = q or l.actor_id::text = q)
    order by l.id desc limit lim offset off
  ) t;
  return jsonb_build_object('total', total, 'limit', lim, 'offset', off, 'rows', rows);
end $$;

-- Which profile photo rows point at files that are not in storage. No URLs, no tokens.
create or replace function public.admin_profile_photo_problems(p_user uuid)
returns jsonb language plpgsql stable security definer set search_path = public, storage, pg_temp as $$
declare out jsonb;
begin
  select jsonb_build_object(
    'photoRows', (select count(*) from public.profile_photos where user_id = p_user),
    'missingFiles', coalesce((select jsonb_agg(jsonb_build_object('photoId', pp.id, 'sortOrder', pp.sort_order, 'isPrimary', pp.is_primary))
        from public.profile_photos pp
        where pp.user_id = p_user
          and not exists (select 1 from storage.objects o where o.bucket_id = 'profile-photos' and o.name = pp.storage_path)), '[]'::jsonb),
    'avatarSet', (select avatar_path is not null from public.profiles where id = p_user),
    'avatarMissing', coalesce((select p.avatar_path is not null
        and not exists (select 1 from storage.objects o where o.bucket_id = 'profile-photos' and o.name = p.avatar_path)
        and not exists (select 1 from public.profile_photos pp where pp.user_id = p.id and pp.storage_path = p.avatar_path)
        from public.profiles p where p.id = p_user), false)
  ) into out;
  return out;
end $$;

-- Observable authentication events. Returns available=false when the project
-- does not write auth audit entries to the database (the usual hosted default).
create or replace function public.admin_auth_events(p_limit int)
returns jsonb language plpgsql stable security definer set search_path = public, auth, pg_temp as $$
declare n bigint; rows jsonb;
begin
  select count(*) into n from auth.audit_log_entries;
  if n = 0 then
    return jsonb_build_object('available', false, 'reason', 'No authentication events are stored in the database for this project.', 'rows', '[]'::jsonb);
  end if;
  select coalesce(jsonb_agg(jsonb_build_object('at', e.created_at, 'action', e.payload ->> 'action', 'logType', e.payload ->> 'log_type') order by e.created_at desc), '[]'::jsonb)
    into rows from (select * from auth.audit_log_entries order by created_at desc limit greatest(1, least(coalesce(p_limit, 50), 200))) e;
  return jsonb_build_object('available', true, 'rows', rows);
end $$;

create or replace function public.admin_cron_status()
returns jsonb language sql stable security definer set search_path = public, cron, pg_temp as $$
  select coalesce(jsonb_agg(jsonb_build_object('jobId', j.jobid, 'name', j.jobname, 'schedule', j.schedule, 'active', j.active,
    'lastRunAt', (select max(start_time) from cron.job_run_details d where d.jobid = j.jobid),
    'lastStatus', (select d.status from cron.job_run_details d where d.jobid = j.jobid order by d.start_time desc limit 1)) order by j.jobid), '[]'::jsonb)
  from cron.job j
$$;

do $$
declare fn text;
begin
  foreach fn in array array[
    'public.admin_bootstrap_owner(text)',
    'public.admin_rate_hit(text, text, integer)',
    'public.admin_revoke_sessions(uuid)',
    'public.admin_list_accounts(text, integer, integer, text)',
    'public.admin_list_reports(text, integer, integer)',
    'public.admin_update_report(uuid, text)',
    'public.admin_audit_search(text, text, integer, integer)',
    'public.admin_profile_photo_problems(uuid)',
    'public.admin_auth_events(integer)',
    'public.admin_cron_status()'
  ] loop
    execute format('revoke execute on function %s from public, anon, authenticated', fn);
    execute format('grant execute on function %s to service_role', fn);
  end loop;
end $$;
