-- Align the database notification contract with the recipient-facing Gayze UI.
-- Chats and Notifications expect interest:<request-id>:received for a received
-- request. The old trigger emitted an unrelated request-id/timestamp key, so
-- the received-Gayze row could never match the UI filter.

create or replace function public.gayze_interest_notification()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if new.status = 'pending'
     and (tg_op = 'INSERT' or (tg_op = 'UPDATE' and old.status is distinct from new.status)) then
    perform public.gayze_enqueue_notification(
      new.to_user_id,
      new.from_user_id,
      'gaze',
      'interest:' || new.id::text || ':received',
      '/notifications'
    );
  end if;

  if new.status = 'mutual'
     and (tg_op = 'INSERT' or (tg_op = 'UPDATE' and old.status is distinct from new.status)) then
    perform public.gayze_enqueue_notification(
      new.to_user_id,
      new.from_user_id,
      'connection',
      'interest:' || new.id::text,
      '/messages'
    );
    perform public.gayze_enqueue_notification(
      new.from_user_id,
      new.to_user_id,
      'connection',
      'interest:' || new.id::text,
      '/messages'
    );
  end if;

  return new;
end;
$$;

revoke all on function public.gayze_interest_notification() from public, anon, authenticated;

-- Backfill pending requests created since the previous recovery window began.
-- The prior recovery migration is idempotent; this uses the same canonical key.
insert into public.gayze_notifications (user_id, actor_id, category, event_key, url)
select
  i.to_user_id,
  i.from_user_id,
  'gaze',
  'interest:' || i.id::text || ':received',
  '/notifications'
from public.interests i
where i.status = 'pending'
  and i.created_at >= now() - interval '7 days'
  and not exists (
    select 1
    from public.gayze_notifications n
    where n.user_id = i.to_user_id
      and n.category = 'gaze'
      and n.event_key = 'interest:' || i.id::text || ':received'
  )
on conflict (user_id, category, event_key) do nothing;
