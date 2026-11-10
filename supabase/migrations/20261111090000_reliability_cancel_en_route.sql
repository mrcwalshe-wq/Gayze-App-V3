-- Reliability, round two: cancelling after you have set off counts against you; a safety reason never does.
--
-- Builds on the Past meets migration (20261107170000). A person's score is now the share of their last 10 COUNTED outcomes that were
-- real, QR-confirmed meets. Two things are counted:
--   qr_past_meet     a meet both people confirmed in person (positive)
--   cancel_en_route  they had set off for a meetup and then cancelled it for a non-safety reason (negative)
-- Not counted at all: a cancellation for safety reasons, a cancellation before setting off, and silent no-shows (nothing here can
-- prove who was in the wrong, so it stays neutral). A number is shown only once there are 3 counted outcomes.
-- The report comes from the person's own phone (it is about their own behaviour, and the cancellation is also visible in the chat).

alter table public.reliability_events drop constraint if exists reliability_events_event_type_check;
alter table public.reliability_events add constraint reliability_events_event_type_check check (event_type in ('qr_past_meet', 'cancel_en_route'));

create or replace function private.reliability_compute(p_user uuid)
returns jsonb language sql stable security definer set search_path = public, pg_temp as $$
  with counted as (
    select counterparty_user_id, event_type from public.reliability_events
    where user_id = p_user order by occurred_at desc, id desc limit 10
  ), agg as (
    select count(*)::int as total, (count(*) filter (where event_type = 'qr_past_meet'))::int as ok,
           (count(*) filter (where event_type = 'cancel_en_route'))::int as cancelled,
           count(distinct counterparty_user_id)::int as people
    from counted
  )
  select jsonb_build_object(
    'verified_meets', (select count(*) from public.past_meets pm where pm.status = 'confirmed' and p_user in (pm.user_a, pm.user_b)),
    'people', agg.people,
    'counted', agg.total,
    'cancelled_en_route', agg.cancelled,
    'score', case when agg.total >= 3 then round(100.0 * agg.ok / agg.total)::int end,
    'level', case when agg.total < 3 then 'new'
                  when 100.0 * agg.ok / agg.total >= 90 then 'highly_reliable'
                  when 100.0 * agg.ok / agg.total >= 70 then 'reliable'
                  else 'building' end
  ) from agg;
$$;
revoke all on function private.reliability_compute(uuid) from public, anon, authenticated;

-- The person cancelled a meetup they had already set off for. p_meeting is the meetup's id (so a repeat tap counts once).
create or replace function public.report_meet_cancel(p_peer uuid, p_meeting text, p_reason text)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare uid uuid := auth.uid(); v_bucket bigint; v_inserted integer;
begin
  if uid is null then raise exception 'not authenticated'; end if;
  if p_reason not in ('safety', 'changed_plans') then raise exception 'invalid_reason'; end if;
  if p_peer is null or p_peer = uid or p_meeting is null or length(p_meeting) < 1 or length(p_meeting) > 80 then raise exception 'invalid_request'; end if;
  -- A safety reason is never held against anyone, and nothing is recorded about it.
  if p_reason = 'safety' then return jsonb_build_object('counted', false, 'mine', private.reliability_compute(uid)); end if;
  if (select count(*) from public.reliability_events where user_id = uid and event_type = 'cancel_en_route' and occurred_at > now() - interval '1 day') >= 10 then
    raise exception 'RATE_LIMIT';
  end if;
  v_bucket := ('x' || substr(md5(p_meeting), 1, 15))::bit(60)::bigint;
  insert into public.reliability_events(user_id, counterparty_user_id, event_type, weight, window_bucket)
  values (uid, p_peer, 'cancel_en_route', 1, v_bucket) on conflict do nothing;
  get diagnostics v_inserted = row_count;
  perform private.reliability_refresh(uid);
  return jsonb_build_object('counted', v_inserted > 0, 'mine', private.reliability_compute(uid));
end $$;
revoke all on function public.report_meet_cancel(uuid, text, text) from public, anon;
grant execute on function public.report_meet_cancel(uuid, text, text) to authenticated;
