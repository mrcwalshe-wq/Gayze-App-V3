-- Fix: intents.can_host is text, not boolean.
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
