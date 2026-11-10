-- Investor-grade management information for the owner console.
--
-- 1. A daily activity ledger. "Active" until now meant "took an action or signed in", which misses people who simply open the app
--    (sessions are long-lived, so a returning member creates no new sign-in). The presence heartbeat already runs while the app is
--    open, so it now also records one row per member per day (London time). Rows before this migration are back-filled from
--    actions and tagged source = 'events', so the console can say which days are measured and which are inferred.
-- 2. admin_investor_metrics(): aggregate counts only, from real tables. Nothing is estimated, and nothing about content, location
--    or any individual is returned. Executable by service_role only, like every other admin_* function.

create table if not exists public.member_daily_activity (
  user_id uuid not null references auth.users(id) on delete cascade,
  day date not null,
  source text not null default 'heartbeat' check (source in ('heartbeat', 'events')),
  first_seen_at timestamptz not null default now(),
  primary key (user_id, day)
);
create index if not exists member_daily_activity_day_idx on public.member_daily_activity(day);
alter table public.member_daily_activity enable row level security;
revoke all on public.member_daily_activity from anon, authenticated;

insert into public.member_daily_activity (user_id, day, source)
select e.uid, (e.at at time zone 'Europe/London')::date, 'events'
from public.admin_activity_events() e
join auth.users u on u.id = e.uid
group by 1, 2
on conflict do nothing;

create or replace function public.presence_heartbeat(p_status text default 'online')
returns void language plpgsql security definer set search_path to 'public', 'pg_temp' as $$
declare uid uuid := auth.uid();
begin
  if uid is null then raise exception 'not authenticated'; end if;
  insert into public.user_presence(user_id, status, last_active_at)
  values (uid, case when p_status = 'away' then 'away' else 'online' end, now())
  on conflict (user_id) do update set status = excluded.status, last_active_at = excluded.last_active_at;
  update public.profiles set last_seen_at = now() where id = uid and (last_seen_at is null or last_seen_at < now() - interval '1 minute');
  -- One row per member per day. A real open outranks an inferred day.
  insert into public.member_daily_activity(user_id, day, source)
  values (uid, (now() at time zone 'Europe/London')::date, 'heartbeat')
  on conflict (user_id, day) do update set source = 'heartbeat' where public.member_daily_activity.source = 'events';
end $function$;

create or replace function public.admin_investor_metrics(p_weeks integer default 12)
returns jsonb language plpgsql stable security definer set search_path to 'public', 'auth', 'pg_temp' as $$
declare
  w integer := least(greatest(coalesce(p_weeks, 12), 4), 52);
  today date := (now() at time zone 'Europe/London')::date;
  wk0 date := date_trunc('week', (now() at time zone 'Europe/London')::date)::date - (least(greatest(coalesce(p_weeks, 12), 4), 52) - 1) * 7;
  out jsonb;
begin
  with
  u as (select id, (created_at at time zone 'Europe/London')::date jd, created_at from auth.users where deleted_at is null),
  a as (select user_id uid, day d from public.member_daily_activity),
  aw as (select uid, date_trunc('week', d)::date ws from a where d >= wk0 - 7 group by 1, 2),
  wks as (select (wk0 + 7 * i)::date ws from generate_series(0, w - 1) i),
  ga as (
    select wks.ws,
      (select count(*) from u where date_trunc('week', u.jd)::date = wks.ws) new_n,
      (select count(*) from aw where aw.ws = wks.ws) active_n,
      (select count(*) from aw x join u on u.id = x.uid where x.ws = wks.ws and date_trunc('week', u.jd)::date < wks.ws
         and exists (select 1 from aw y where y.uid = x.uid and y.ws = wks.ws - 7)) retained_n,
      (select count(*) from aw x join u on u.id = x.uid where x.ws = wks.ws and date_trunc('week', u.jd)::date < wks.ws
         and not exists (select 1 from aw y where y.uid = x.uid and y.ws = wks.ws - 7)) resurrected_n,
      (select count(*) from aw y join u on u.id = y.uid where y.ws = wks.ws - 7
         and not exists (select 1 from aw x where x.uid = y.uid and x.ws = wks.ws)) churned_n
    from wks),
  coh as (
    select date_trunc('week', jd)::date cws, count(*) n,
      count(*) filter (where jd + 1 <= today) e1,
      count(*) filter (where jd + 1 <= today and exists (select 1 from a where a.uid = u.id and a.d = u.jd + 1)) r1,
      count(*) filter (where jd + 7 <= today) e7,
      count(*) filter (where jd + 7 <= today and exists (select 1 from a where a.uid = u.id and a.d = u.jd + 7)) r7,
      count(*) filter (where jd + 30 <= today) e30,
      count(*) filter (where jd + 30 <= today and exists (select 1 from a where a.uid = u.id and a.d = u.jd + 30)) r30
    from u group by 1),
  dau30 as (select g.d, (select count(*) from a where a.d = g.d) n from (select (today - s)::date d from generate_series(0, 29) s) g),
  mau as (select count(distinct uid) n from a where d > today - 30),
  wau as (select count(distinct uid) n from a where d > today - 7),
  firstmsg as (
    select distinct on (conversation_id) conversation_id, sender_id, created_at from public.messages order by conversation_id, created_at),
  conv30 as (select * from firstmsg where created_at > now() - interval '30 days'),
  intent_first as (select user_id, min(created_at) t from public.intents group by 1),
  msg_first as (select sender_id uid, min(created_at) t from public.messages group by 1)
  select jsonb_build_object(
    'generatedAt', now(), 'weeks', w, 'timezone', 'Europe/London',
    'dataQuality', jsonb_build_object(
      'measuredFrom', (select min(day) from public.member_daily_activity where source = 'heartbeat'),
      'measuredDays', (select count(distinct day) from public.member_daily_activity where source = 'heartbeat'),
      'inferredBefore', 'Days before the first measured day are inferred from actions (intents, messages, Gayzes, interests, sign-ins), so they undercount people who only opened the app.',
      'members', (select count(*) from u)),
    'benchmarks', jsonb_build_object(
      'source', 'a16z consumer social benchmarks (n-day, bounded retention). Dating and social apps vary; use as a guide, not a target.',
      'stickiness', jsonb_build_object('ok', 30, 'good', 40, 'great', 50),
      'd1', jsonb_build_object('ok', 50, 'good', 60, 'great', 70),
      'd7', jsonb_build_object('ok', 35, 'good', 40, 'great', 50),
      'd30', jsonb_build_object('ok', 20, 'good', 25, 'great', 30),
      'typicalApp', jsonb_build_object('d1', 26, 'd7', 13, 'd30', 7, 'source', 'Adjust median across mobile app categories')),
    'headline', jsonb_build_object(
      'members', (select count(*) from u),
      'new7d', (select count(*) from u where jd > today - 7),
      'newPrev7d', (select count(*) from u where jd > today - 14 and jd <= today - 7),
      'new30d', (select count(*) from u where jd > today - 30),
      'dauToday', (select n from dau30 where d = today),
      'dauAvg7d', (select round(avg(n)::numeric, 1) from dau30 where d > today - 7),
      'wau', (select n from wau), 'mau', (select n from mau),
      'stickinessDauMau', (select case when (select n from mau) > 0 then round(100 * (select avg(n) from dau30 where d > today - 7) / (select n from mau), 1) end),
      'stickinessWauMau', (select case when (select n from mau) > 0 then round(100.0 * (select n from wau) / (select n from mau), 1) end)),
    'dau30', (select jsonb_agg(jsonb_build_object('day', d, 'n', n) order by d) from dau30),
    'weekly', (select jsonb_agg(jsonb_build_object(
        'week', ws, 'new', new_n, 'active', active_n, 'retained', retained_n, 'resurrected', resurrected_n, 'churned', churned_n,
        'quickRatio', case when churned_n > 0 then round((new_n + resurrected_n)::numeric / churned_n, 2) end,
        'partial', ws = date_trunc('week', today)::date) order by ws) from ga),
    'cohorts', (select jsonb_agg(jsonb_build_object('week', cws, 'size', n,
        'd1', jsonb_build_object('kept', r1, 'eligible', e1), 'd7', jsonb_build_object('kept', r7, 'eligible', e7), 'd30', jsonb_build_object('kept', r30, 'eligible', e30)) order by cws)
        from coh where cws >= wk0),
    'retentionAll', jsonb_build_object(
      'd1', (select jsonb_build_object('kept', sum(r1), 'eligible', sum(e1)) from coh),
      'd7', (select jsonb_build_object('kept', sum(r7), 'eligible', sum(e7)) from coh),
      'd30', (select jsonb_build_object('kept', sum(r30), 'eligible', sum(e30)) from coh)),
    'activation', jsonb_build_object(
      'steps', jsonb_build_array(
        jsonb_build_object('step', 'Signed up', 'n', (select count(*) from u)),
        jsonb_build_object('step', 'Created a profile', 'n', (select count(*) from public.profiles p join u on u.id = p.id)),
        jsonb_build_object('step', 'Added a photo', 'n', (select count(*) from public.profiles p join u on u.id = p.id where p.avatar_path is not null)),
        jsonb_build_object('step', 'Set an intent', 'n', (select count(*) from intent_first i join u on u.id = i.user_id)),
        jsonb_build_object('step', 'Sent a Gayze or interest', 'n', (select count(*) from u where exists (select 1 from public.gazes g where g.from_user_id = u.id) or exists (select 1 from public.interests i where i.from_user_id = u.id))),
        jsonb_build_object('step', 'Sent a message', 'n', (select count(*) from msg_first m join u on u.id = m.uid))),
      'medianHoursToFirstIntent', (select round((percentile_cont(0.5) within group (order by extract(epoch from (i.t - u.created_at)) / 3600))::numeric, 1) from intent_first i join u on u.id = i.user_id where i.t >= u.created_at),
      'medianHoursToFirstMessage', (select round((percentile_cont(0.5) within group (order by extract(epoch from (m.t - u.created_at)) / 3600))::numeric, 1) from msg_first m join u on u.id = m.uid where m.t >= u.created_at)),
    'marketplace', jsonb_build_object(
      'liveIntentsNow', (select count(*) from public.intents where expires_at > now() and not coalesce(is_paused, false)),
      'activeToday', (select n from dau30 where d = today),
      'membersWithIntentLast7d', (select count(distinct user_id) from public.intents where created_at > now() - interval '7 days'),
      'interestsSent30d', (select count(*) from public.interests where created_at > now() - interval '30 days'),
      'interestsMutual30d', (select count(*) from public.interests where created_at > now() - interval '30 days' and status = 'mutual'),
      'gazesSent30d', (select count(*) from public.gazes where created_at > now() - interval '30 days'),
      'conversationsStarted30d', (select count(*) from conv30),
      'conversationsReplied24h30d', (select count(*) from conv30 c where exists (select 1 from public.messages m where m.conversation_id = c.conversation_id and m.sender_id <> c.sender_id and m.created_at <= c.created_at + interval '24 hours')),
      'messages30d', (select count(*) from public.messages where created_at > now() - interval '30 days')),
    'adoption', jsonb_build_object(
      'intentsCreated30d', (select count(*) from public.intents where created_at > now() - interval '30 days'),
      'callsStarted30d', (select count(*) from public.call_sessions where created_at > now() - interval '30 days'),
      'callsAnswered30d', (select count(*) from public.call_sessions where created_at > now() - interval '30 days' and status = 'answered'),
      'callUsers30d', (select count(distinct x) from (select caller_id x from public.call_sessions where created_at > now() - interval '30 days' union select callee_id from public.call_sessions where created_at > now() - interval '30 days') s),
      'gatheringsCreated30d', (select count(*) from public.gatherings where created_at > now() - interval '30 days'),
      'gatheringRsvps30d', (select count(*) from public.gathering_rsvps where created_at > now() - interval '30 days'),
      'safetyCheckins30d', (select count(*) from public.safety_checkins where created_at > now() - interval '30 days'),
      'albumsCreated', (select count(*) from public.albums),
      'albumShares30d', (select count(*) from public.album_shares where created_at > now() - interval '30 days'),
      'pushEnabledMembers', (select count(distinct user_id) from public.push_subscriptions)),
    'safety', jsonb_build_object(
      'reports30d', (select count(*) from public.reports where created_at > now() - interval '30 days'),
      'openReports', (select count(*) from public.reports where coalesce(status, 'open') = 'open'),
      'blocks', (select count(*) from public.blocks),
      'suspended', (select count(*) from public.account_restrictions where status = 'suspended')),
    'revenue', jsonb_build_object('status', 'not_monetised', 'note', 'GAYZE has no revenue yet. Revenue, ARPU, CAC and LTV are not shown because there is nothing real to show.')
  ) into out;
  return out;
end $$;

revoke all on function public.admin_investor_metrics(integer) from public, anon, authenticated;
grant execute on function public.admin_investor_metrics(integer) to service_role;
