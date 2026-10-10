-- Recover recent pending Gayze requests that predate or missed the
-- notification trigger. Keep this bounded to recent requests and idempotent:
-- do not replay requests older than 48 hours or duplicate an existing inbox event.
-- The INSERT trigger on gayze_notifications handles normal push dispatch.
insert into public.gayze_notifications (user_id, actor_id, category, event_key, url)
select
  i.to_user_id,
  i.from_user_id,
  'gaze',
  'interest:' || i.id::text || ':received',
  '/notifications'
from public.interests i
where i.status = 'pending'
  and i.created_at >= now() - interval '48 hours'
  and not exists (
    select 1
    from public.gayze_notifications n
    where n.user_id = i.to_user_id
      and n.category = 'gaze'
      and n.event_key = 'interest:' || i.id::text || ':received'
  )
on conflict (user_id, category, event_key) do nothing;
