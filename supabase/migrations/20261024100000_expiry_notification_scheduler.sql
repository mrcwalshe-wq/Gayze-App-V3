-- "Your intent is ending soon" and "Your safety check-in has ended" notifications
-- were designed (categories, copy, preferences, push dispatch) but nothing ever
-- created them: production has zero rows of either kind. This adds the missing
-- scheduler. Every minute it enqueues, at most once per item (the enqueue
-- function de-duplicates on user/category/event key):
--   * intent_expiring: live, unpaused intents ending within 15 minutes
--   * safety: active safety check-ins that ended within the last hour
-- Each enqueue fires the existing notification trigger, which sends the push.
create extension if not exists pg_cron;

create or replace function public.gayze_enqueue_expiry_notifications()
returns integer
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $function$
declare
  n integer := 0;
  r record;
begin
  for r in
    select id, user_id from public.intents
    where is_paused is not true and expires_at > now() and expires_at <= now() + interval '15 minutes'
  loop
    perform public.gayze_enqueue_notification(r.user_id, null, 'intent_expiring', r.id::text, '/profile');
    n := n + 1;
  end loop;

  for r in
    select id, user_id from public.safety_checkins
    where status = 'active' and expires_at <= now() and expires_at > now() - interval '1 hour'
  loop
    perform public.gayze_enqueue_notification(r.user_id, null, 'safety', r.id::text, '/profile');
    n := n + 1;
  end loop;

  return n;
end;
$function$;

revoke all on function public.gayze_enqueue_expiry_notifications() from public, anon, authenticated;

select cron.schedule(
  'gayze-expiry-notifications',
  '* * * * *',
  $job$select public.gayze_enqueue_expiry_notifications()$job$
);
