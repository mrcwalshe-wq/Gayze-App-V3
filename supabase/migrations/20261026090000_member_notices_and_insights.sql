-- Member notices (broadcasts, admin messages, gathering updates) and admin insights.
-- Additive only: new tables and functions, one replaced function (toggle_gathering_rsvp).
-- Everything admin_* is service_role only; members can only read and mark their own notices.

-- ---------------------------------------------------------------------------
-- 1. Member notices
-- ---------------------------------------------------------------------------
create table if not exists public.member_notices (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  actor_id uuid references auth.users(id) on delete set null,
  kind text not null check (kind in ('broadcast', 'admin_message', 'gathering_rsvp', 'gathering_full')),
  title text not null check (char_length(title) between 1 and 80),
  body text not null check (char_length(body) between 1 and 500),
  url text not null default '/' check (url like '/%' and url not like '//%'),
  dedupe_key text,
  broadcast_id uuid,
  created_at timestamptz not null default now(),
  read_at timestamptz,
  push_processed_at timestamptz,
  unique (user_id, kind, dedupe_key)
);
create index if not exists member_notices_user_created_idx on public.member_notices (user_id, created_at desc);
create index if not exists member_notices_broadcast_idx on public.member_notices (broadcast_id) where broadcast_id is not null;

alter table public.member_notices enable row level security;
revoke all on public.member_notices from anon, authenticated;
grant select on public.member_notices to authenticated;
create policy member_notices_select_own on public.member_notices for select to authenticated
  using (user_id = (select auth.uid()));

create or replace function public.get_my_notices(p_limit integer default 50)
returns table (id uuid, kind text, title text, body text, url text, created_at timestamptz, read_at timestamptz)
language sql stable security definer set search_path = public, pg_temp as $$
  select n.id, n.kind, n.title, n.body, n.url, n.created_at, n.read_at
  from public.member_notices n
  where n.user_id = (select auth.uid())
  order by n.created_at desc
  limit least(greatest(coalesce(p_limit, 50), 1), 100);
$$;

create or replace function public.mark_notices_read(p_ids uuid[] default null)
returns integer language plpgsql security definer set search_path = public, pg_temp as $$
declare n integer;
begin
  if (select auth.uid()) is null then raise exception 'not authenticated'; end if;
  update public.member_notices set read_at = now()
  where user_id = (select auth.uid()) and read_at is null and (p_ids is null or id = any (p_ids));
  get diagnostics n = row_count;
  return n;
end $$;

revoke execute on function public.get_my_notices(integer) from public, anon;
revoke execute on function public.mark_notices_read(uuid[]) from public, anon;
grant execute on function public.get_my_notices(integer) to authenticated, service_role;
grant execute on function public.mark_notices_read(uuid[]) to authenticated, service_role;

-- Push: every new notice is handed to send-push (same durable bridge as other notifications).
create or replace function public.member_notice_dispatch()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
begin
  perform public.gayze_notification_http_dispatch(jsonb_build_object('noticeId', new.id));
  return new;
end $$;
revoke execute on function public.member_notice_dispatch() from public, anon, authenticated;

create trigger member_notice_dispatch_trg after insert on public.member_notices
  for each row execute function public.member_notice_dispatch();

-- ---------------------------------------------------------------------------
-- 2. Gatherings: the host is always going; hosts are told when someone joins
-- ---------------------------------------------------------------------------
create or replace function public.toggle_gathering_rsvp(p_gathering_id uuid)
returns boolean language plpgsql set search_path = public, pg_temp as $$
declare
  uid uuid := (select auth.uid());
  g record;
  current_status text;
  current_count integer;
begin
  if uid is null then raise exception 'not authenticated'; end if;
  select id, host_id, capacity into g from public.gatherings where id = p_gathering_id;
  if not found then raise exception 'gathering not found'; end if;

  -- A host cannot leave their own gathering; the call just confirms they are in.
  if g.host_id = uid then
    insert into public.gathering_rsvps(gathering_id, user_id, status) values (p_gathering_id, uid, 'attending')
    on conflict (gathering_id, user_id) do update set status = 'attending', updated_at = now();
    return true;
  end if;

  select status into current_status from public.gathering_rsvps where gathering_id = p_gathering_id and user_id = uid;
  if current_status = 'attending' then
    update public.gathering_rsvps set status = 'cancelled', updated_at = now()
    where gathering_id = p_gathering_id and user_id = uid;
    return false;
  end if;

  select count(*)::integer into current_count from public.gathering_rsvps where gathering_id = p_gathering_id and status = 'attending';
  if current_count >= g.capacity then raise exception 'gathering is full'; end if;

  insert into public.gathering_rsvps(gathering_id, user_id, status) values (p_gathering_id, uid, 'attending')
  on conflict (gathering_id, user_id) do update set status = 'attending', updated_at = now();
  return true;
end $$;

create or replace function public.gathering_rsvp_notify()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
declare
  g record;
  who text;
  total integer;
begin
  if new.status <> 'attending' then return new; end if;
  if tg_op = 'UPDATE' and old.status = 'attending' then return new; end if;

  select id, host_id, title, capacity into g from public.gatherings where id = new.gathering_id;
  if not found or g.host_id = new.user_id then return new; end if;

  select coalesce(nullif(btrim(display_name), ''), 'Someone') into who from public.profiles where id = new.user_id;
  insert into public.member_notices (user_id, actor_id, kind, title, body, url, dedupe_key)
  values (g.host_id, new.user_id, 'gathering_rsvp', 'New guest',
          left(coalesce(who, 'Someone') || ' is going to ' || g.title, 500), '/later', new.gathering_id::text || ':' || new.user_id::text)
  on conflict (user_id, kind, dedupe_key) do nothing;

  select count(*) into total from public.gathering_rsvps where gathering_id = new.gathering_id and status = 'attending';
  if total >= g.capacity then
    insert into public.member_notices (user_id, kind, title, body, url, dedupe_key)
    values (g.host_id, 'gathering_full', 'Your gathering is full', left(g.title || ' has reached its limit of ' || g.capacity || ' people.', 500), '/later', g.id::text)
    on conflict (user_id, kind, dedupe_key) do nothing;
  end if;
  return new;
end $$;
revoke execute on function public.gathering_rsvp_notify() from public, anon, authenticated;

create trigger gathering_rsvp_notify_trg after insert or update of status on public.gathering_rsvps
  for each row execute function public.gathering_rsvp_notify();

-- ---------------------------------------------------------------------------
-- 3. Broadcasts and direct messages from the admin console
-- ---------------------------------------------------------------------------
create table if not exists public.admin_broadcasts (
  id uuid primary key default gen_random_uuid(),
  created_by uuid not null references auth.users(id),
  title text not null,
  body text not null,
  url text not null default '/',
  audience jsonb not null,
  recipient_count integer not null default 0,
  created_at timestamptz not null default now()
);
alter table public.admin_broadcasts enable row level security;
revoke all on public.admin_broadcasts from anon, authenticated;

-- Audience: {"scope":"all"|"active"|"inactive"|"intent"|"push"|"user", "days":n, "intent":text, "user":uuid}
-- Suspended accounts and administrators are never targeted.
create or replace function public.admin_resolve_audience(p_audience jsonb)
returns table (user_id uuid)
language plpgsql stable security definer set search_path = public, auth, pg_temp as $$
declare
  scope text := coalesce(p_audience ->> 'scope', 'all');
  days integer := least(greatest(coalesce((p_audience ->> 'days')::integer, 30), 1), 365);
begin
  if scope not in ('all', 'active', 'inactive', 'intent', 'push', 'user') then raise exception 'invalid_audience'; end if;
  return query
  select u.id from auth.users u
  where u.deleted_at is null
    and not exists (select 1 from public.account_restrictions r where r.user_id = u.id and r.status = 'suspended')
    and not exists (select 1 from public.app_admins a where a.user_id = u.id)
    and case scope
      when 'all' then true
      when 'active' then exists (select 1 from public.profiles p where p.id = u.id and p.last_seen_at > now() - make_interval(days => days))
      when 'inactive' then not exists (select 1 from public.profiles p where p.id = u.id and p.last_seen_at > now() - make_interval(days => days))
      when 'intent' then exists (select 1 from public.intents i where i.user_id = u.id and i.expires_at > now() and not coalesce(i.is_paused, false)
                                   and (p_audience ->> 'intent' is null or i.intent ilike (replace(replace(replace(p_audience ->> 'intent', '\', '\\'), '%', '\%'), '_', '\_') || '%')))
      when 'push' then exists (select 1 from public.push_subscriptions s where s.user_id = u.id)
      when 'user' then u.id = (p_audience ->> 'user')::uuid
      else false end;
end $$;

create or replace function public.admin_audience_count(p_audience jsonb)
returns integer language sql stable security definer set search_path = public, auth, pg_temp as $$
  select count(*)::integer from public.admin_resolve_audience(p_audience);
$$;

create or replace function public.admin_send_broadcast(p_actor uuid, p_title text, p_body text, p_url text, p_audience jsonb)
returns jsonb language plpgsql security definer set search_path = public, auth, pg_temp as $$
declare
  bid uuid := gen_random_uuid();
  total integer;
  kind_text text := case when coalesce(p_audience ->> 'scope', 'all') = 'user' then 'admin_message' else 'broadcast' end;
begin
  select count(*) into total from public.admin_resolve_audience(p_audience);
  if total = 0 then raise exception 'empty_audience'; end if;
  if total > 50000 then raise exception 'audience_too_large'; end if;

  insert into public.admin_broadcasts (id, created_by, title, body, url, audience, recipient_count)
  values (bid, p_actor, p_title, p_body, coalesce(nullif(p_url, ''), '/'), p_audience, total);

  insert into public.member_notices (user_id, actor_id, kind, title, body, url, dedupe_key, broadcast_id)
  select a.user_id, p_actor, kind_text, p_title, p_body, coalesce(nullif(p_url, ''), '/'), bid::text, bid
  from public.admin_resolve_audience(p_audience) a;

  return jsonb_build_object('broadcastId', bid, 'recipients', total);
end $$;

create or replace function public.admin_list_broadcasts(p_limit integer default 25)
returns jsonb language sql stable security definer set search_path = public, pg_temp as $$
  select coalesce(jsonb_agg(row_to_json(t)), '[]'::jsonb) from (
    select b.id, b.title, b.body, b.url, b.audience, b.recipient_count, b.created_at,
           (select count(*) from public.member_notices n where n.broadcast_id = b.id and n.read_at is not null) as read_count,
           (select count(*) from public.member_notices n where n.broadcast_id = b.id and n.push_processed_at is not null) as pushed_count
    from public.admin_broadcasts b order by b.created_at desc limit least(greatest(coalesce(p_limit, 25), 1), 100)
  ) t;
$$;

-- ---------------------------------------------------------------------------
-- 4. Insights: aggregate-only product analytics for the owner
--    Deliberately excludes the intimacy/preference profile fields; nothing
--    here returns an individual's data.
-- ---------------------------------------------------------------------------
create or replace function public.admin_activity_events()
returns table (uid uuid, at timestamptz, kind text)
language sql stable security definer set search_path = public, auth, pg_temp as $$
  select user_id, created_at, 'intent' from public.intents
  union all select sender_id, created_at, 'message' from public.messages
  union all select from_user_id, created_at, 'gayze' from public.gazes
  union all select from_user_id, created_at, 'interest' from public.interests
  union all select user_id, created_at, 'story' from public.stories
  union all select user_id, created_at, 'signin' from auth.sessions;
$$;

create or replace function public.admin_insights(p_days integer default 30, p_tz text default 'Europe/London')
returns jsonb language plpgsql stable security definer set search_path = public, auth, pg_temp as $$
declare
  d integer := least(greatest(coalesce(p_days, 30), 1), 365);
  since timestamptz := now() - make_interval(days => least(greatest(coalesce(p_days, 30), 1), 365));
  tz text := case when exists (select 1 from pg_timezone_names where name = p_tz) then p_tz else 'Europe/London' end;
  total_users integer;
  out jsonb;
begin
  select count(*) into total_users from auth.users where deleted_at is null;

  select jsonb_build_object(
    'generatedAt', now(), 'days', d, 'timezone', tz,

    'totals', jsonb_build_object(
      'members', total_users,
      'newInPeriod', (select count(*) from auth.users where created_at >= since),
      'activeInPeriod', (select count(distinct uid) from public.admin_activity_events() where at >= since and kind <> 'signin'),
      'active1d', (select count(distinct uid) from public.admin_activity_events() where at >= now() - interval '1 day'),
      'active7d', (select count(distinct uid) from public.admin_activity_events() where at >= now() - interval '7 days'),
      'active30d', (select count(distinct uid) from public.admin_activity_events() where at >= now() - interval '30 days'),
      'withPush', (select count(distinct user_id) from public.push_subscriptions),
      'verifiedProfiles', (select count(*) from public.profiles where coalesce(safety_verified, false))
    ),

    'signupsByDay', (select coalesce(jsonb_agg(jsonb_build_object('day', g.day, 'n', coalesce(c.n, 0)) order by g.day), '[]'::jsonb)
      from (select (date_trunc('day', now() at time zone tz) - make_interval(days => s))::date as day from generate_series(0, d - 1) s) g
      left join (select (created_at at time zone tz)::date as day, count(*) n from auth.users where created_at >= since group by 1) c on c.day = g.day),

    'activeByDay', (select coalesce(jsonb_agg(jsonb_build_object('day', g.day, 'n', coalesce(c.n, 0)) order by g.day), '[]'::jsonb)
      from (select (date_trunc('day', now() at time zone tz) - make_interval(days => s))::date as day from generate_series(0, d - 1) s) g
      left join (select (at at time zone tz)::date as day, count(distinct uid) n from public.admin_activity_events() where at >= since and kind <> 'signin' group by 1) c on c.day = g.day),

    'signInsByHour', (select coalesce(jsonb_agg(jsonb_build_object('hour', h, 'n', coalesce(c.n, 0)) order by h), '[]'::jsonb)
      from generate_series(0, 23) h
      left join (select extract(hour from created_at at time zone tz)::int hr, count(*) n from auth.sessions where created_at >= since group by 1) c on c.hr = h),

    'activityByHour', (select coalesce(jsonb_agg(jsonb_build_object('hour', h, 'n', coalesce(c.n, 0)) order by h), '[]'::jsonb)
      from generate_series(0, 23) h
      left join (select extract(hour from at at time zone tz)::int hr, count(*) n from public.admin_activity_events() where at >= since and kind <> 'signin' group by 1) c on c.hr = h),

    'activityByWeekday', (select coalesce(jsonb_agg(jsonb_build_object('dow', w, 'n', coalesce(c.n, 0)) order by w), '[]'::jsonb)
      from generate_series(0, 6) w
      left join (select extract(dow from at at time zone tz)::int dw, count(*) n from public.admin_activity_events() where at >= since and kind <> 'signin' group by 1) c on c.dw = w),

    'intents', jsonb_build_object(
      'createdInPeriod', (select count(*) from public.intents where created_at >= since),
      'liveNow', (select count(*) from public.intents where expires_at > now() and not coalesce(is_paused, false)),
      'byMode', (select coalesce(jsonb_agg(jsonb_build_object('label', mode, 'n', n) order by n desc), '[]'::jsonb)
        from (select coalesce(mode, 'unknown') mode, count(*) n from public.intents where created_at >= since group by 1) q),
      'top', (select coalesce(jsonb_agg(jsonb_build_object('label', label, 'n', n) order by n desc), '[]'::jsonb)
        from (select split_part(intent, ' · ', 1) label, count(*) n from public.intents where created_at >= since group by 1 order by n desc limit 10) q),
      'topVariants', (select coalesce(jsonb_agg(jsonb_build_object('label', intent, 'n', n) order by n desc), '[]'::jsonb)
        from (select intent, count(*) n from public.intents where created_at >= since group by 1 order by n desc limit 10) q),
      'byHour', (select coalesce(jsonb_agg(jsonb_build_object('hour', h, 'n', coalesce(c.n, 0)) order by h), '[]'::jsonb)
        from generate_series(0, 23) h
        left join (select extract(hour from created_at at time zone tz)::int hr, count(*) n from public.intents where created_at >= since group by 1) c on c.hr = h),
      'avgHours', (select round(avg(extract(epoch from (expires_at - coalesce(starts_at, created_at))) / 3600)::numeric, 1) from public.intents where created_at >= since and expires_at > coalesce(starts_at, created_at)),
      'travelWilling', (select count(*) filter (where travel_willingness is not null and travel_willingness <> '' and lower(travel_willingness) not in ('no', 'none', 'false')) from public.intents where created_at >= since),
      'canHost', (select count(*) filter (where can_host is not null and btrim(can_host) <> '') from public.intents where created_at >= since)
    ),

    'engagement', jsonb_build_object(
      'gayzesSent', (select count(*) from public.gazes where created_at >= since),
      'interestsSent', (select count(*) from public.interests where created_at >= since),
      'interestsByStatus', (select coalesce(jsonb_agg(jsonb_build_object('label', coalesce(status, 'unknown'), 'n', n) order by n desc), '[]'::jsonb)
        from (select status, count(*) n from public.interests where created_at >= since group by 1) q),
      'conversationsStarted', (select count(*) from public.conversations where created_at >= since),
      'messagesSent', (select count(*) from public.messages where created_at >= since),
      'messagesPerActiveMember', (select round((select count(*) from public.messages where created_at >= since)::numeric
         / nullif((select count(distinct uid) from public.admin_activity_events() where at >= since and kind <> 'signin'), 0), 1)),
      'storiesPosted', (select count(*) from public.stories where created_at >= since)
    ),

    'gatherings', jsonb_build_object(
      'created', (select count(*) from public.gatherings where created_at >= since),
      'goingTotal', (select count(*) from public.gathering_rsvps where status = 'attending' and created_at >= since),
      'byCategory', (select coalesce(jsonb_agg(jsonb_build_object('label', coalesce(category, 'other'), 'n', n) order by n desc), '[]'::jsonb)
        from (select category, count(*) n from public.gatherings where created_at >= since group by 1) q),
      'avgFillPercent', (select round(avg(100.0 * least(1, a.n::numeric / nullif(g.capacity, 0))), 0)
        from public.gatherings g left join lateral (select count(*) n from public.gathering_rsvps r where r.gathering_id = g.id and r.status = 'attending') a on true
        where g.created_at >= since)
    ),

    'audience', jsonb_build_object(
      'ageBands', (select coalesce(jsonb_agg(jsonb_build_object('label', band, 'n', n) order by ord), '[]'::jsonb)
        from (select case when age < 25 then '18-24' when age < 35 then '25-34' when age < 45 then '35-44' when age < 55 then '45-54' else '55+' end band,
                     case when age < 25 then 1 when age < 35 then 2 when age < 45 then 3 when age < 55 then 4 else 5 end ord, count(*) n
              from public.profiles where age is not null and age >= 18 group by 1, 2) q),
      'neighbourhoods', (select coalesce(jsonb_agg(jsonb_build_object('label', label, 'n', n) order by n desc), '[]'::jsonb)
        from (select initcap(btrim(neighborhood)) label, count(*) n from public.profiles where neighborhood is not null and btrim(neighborhood) <> '' group by 1 order by n desc limit 8) q),
      'topInterests', (select coalesce(jsonb_agg(jsonb_build_object('label', label, 'n', n) order by n desc), '[]'::jsonb)
        from (select initcap(btrim(interest)) label, count(*) n from public.profile_interests group by 1 order by n desc limit 10) q),
      'profileCompleteness', jsonb_build_object(
        'withPhoto', (select count(distinct user_id) from public.profile_photos),
        'withBio', (select count(*) from public.profiles where bio is not null and btrim(bio) <> ''),
        'profiles', (select count(*) from public.profiles))
    ),

    'notifications', jsonb_build_object(
      'pushEnabledMembers', (select count(distinct user_id) from public.push_subscriptions),
      'optedOutOfPush', (select count(*) from public.notification_preferences where push_enabled = false),
      'categoryOptOuts', jsonb_build_object(
        'messages', (select count(*) from public.notification_preferences where messages = false),
        'intentActivity', (select count(*) from public.notification_preferences where intent_activity = false),
        'connections', (select count(*) from public.notification_preferences where connections = false),
        'intentExpiry', (select count(*) from public.notification_preferences where intent_expiry = false),
        'safety', (select count(*) from public.notification_preferences where safety = false)),
      'inboxCreated', (select count(*) from public.gayze_notifications where created_at >= since),
      'deliveriesByState', (select coalesce(jsonb_agg(jsonb_build_object('label', state, 'n', n) order by n desc), '[]'::jsonb)
        from (select state, count(*) n from public.gayze_notification_deliveries where created_at >= since group by 1) q)
    ),

    'funnel', jsonb_build_array(
      jsonb_build_object('step', 'Signed up', 'n', total_users),
      jsonb_build_object('step', 'Created a profile', 'n', (select count(*) from public.profiles)),
      jsonb_build_object('step', 'Added a photo', 'n', (select count(distinct user_id) from public.profile_photos)),
      jsonb_build_object('step', 'Set an intent', 'n', (select count(distinct user_id) from public.intents)),
      jsonb_build_object('step', 'Sent a Gayze or interest', 'n', (select count(distinct uid) from public.admin_activity_events() where kind in ('gayze', 'interest'))),
      jsonb_build_object('step', 'Sent a message', 'n', (select count(distinct sender_id) from public.messages))
    ),

    'retention', jsonb_build_object(
      'eligible', (select count(*) from auth.users where created_at < now() - interval '7 days' and deleted_at is null),
      'returnedAfterDay1', (select count(distinct u.id) from auth.users u where u.created_at < now() - interval '7 days' and u.deleted_at is null
         and exists (select 1 from public.admin_activity_events() e where e.uid = u.id and e.at >= u.created_at + interval '1 day')),
      'activeLast7d', (select count(distinct u.id) from auth.users u where u.created_at < now() - interval '7 days' and u.deleted_at is null
         and exists (select 1 from public.admin_activity_events() e where e.uid = u.id and e.at >= now() - interval '7 days'))
    ),

    'safety', jsonb_build_object(
      'reportsInPeriod', (select count(*) from public.reports where created_at >= since),
      'openReports', (select count(*) from public.reports where coalesce(status, 'open') = 'open'),
      'blocks', (select count(*) from public.blocks),
      'checkinsInPeriod', (select count(*) from public.safety_checkins where created_at >= since),
      'suspended', (select count(*) from public.account_restrictions where status = 'suspended')
    )
  ) into out;

  return out;
end $$;

-- ---------------------------------------------------------------------------
-- 5. Privileges: admin functions are service_role only
-- ---------------------------------------------------------------------------
do $$
declare fn text;
begin
  foreach fn in array array[
    'public.admin_resolve_audience(jsonb)', 'public.admin_audience_count(jsonb)',
    'public.admin_send_broadcast(uuid, text, text, text, jsonb)', 'public.admin_list_broadcasts(integer)',
    'public.admin_activity_events()', 'public.admin_insights(integer, text)'
  ] loop
    execute format('revoke execute on function %s from public, anon, authenticated', fn);
    execute format('grant execute on function %s to service_role', fn);
  end loop;
end $$;
