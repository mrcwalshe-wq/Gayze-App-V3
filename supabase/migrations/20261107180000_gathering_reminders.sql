-- Reminders for plans (Later): everyone who is going (the host and accepted guests) gets a notification
-- about a day before and again about an hour before. Each is sent once (the event key makes it idempotent).
-- The copy is generic on purpose (no plan title on a lock screen).

alter table public.gayze_notifications drop constraint if exists gayze_notifications_category_check;
alter table public.gayze_notifications add constraint gayze_notifications_category_check
  check (category = any (array['message','gaze','connection','intent_expiring','safety','test','call','missed_call','gathering_reminder']));

create or replace function public.gayze_enqueue_gathering_reminders()
returns integer language plpgsql security definer set search_path = public, pg_temp as $$
declare n integer := 0; r record;
begin
  -- About a day ahead: the plan starts within the next 24h but not within 23h.
  for r in
    select g.id, rs.user_id from public.gatherings g
    join public.gathering_rsvps rs on rs.gathering_id = g.id and rs.status = 'attending'
    where g.scheduled_at > now() + interval '23 hours' and g.scheduled_at <= now() + interval '24 hours'
  loop
    perform public.gayze_enqueue_notification(r.user_id, null, 'gathering_reminder', r.id::text || ':24h', '/later');
    n := n + 1;
  end loop;
  -- About an hour ahead: the plan starts within the next hour.
  for r in
    select g.id, rs.user_id from public.gatherings g
    join public.gathering_rsvps rs on rs.gathering_id = g.id and rs.status = 'attending'
    where g.scheduled_at > now() and g.scheduled_at <= now() + interval '1 hour'
  loop
    perform public.gayze_enqueue_notification(r.user_id, null, 'gathering_reminder', r.id::text || ':1h', '/later');
    n := n + 1;
  end loop;
  return n;
end $$;
revoke all on function public.gayze_enqueue_gathering_reminders() from public, anon, authenticated;
grant execute on function public.gayze_enqueue_gathering_reminders() to service_role;

select cron.schedule('gayze-gathering-reminders', '*/5 * * * *', 'select public.gayze_enqueue_gathering_reminders()');
