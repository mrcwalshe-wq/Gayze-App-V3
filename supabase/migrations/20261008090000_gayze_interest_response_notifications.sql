-- GAYZE interest response notifications
-- Incoming Gayze: recipient is notified on creation.
-- Accepted Gayze: existing accept_interest -> gayze_connection_notification handles this.
-- Declined Gayze: sender receives a private notification; recipient's decision is not exposed beyond this response.

create or replace function public.gayze_interest_notification()
returns trigger language plpgsql security definer set search_path=public,pg_temp
as $function$
begin
  if tg_op = 'INSERT' and new.status = 'pending' then
    perform public.gayze_enqueue_notification(
      new.to_user_id,
      new.from_user_id,
      'gaze',
      'interest:'||new.id::text||':received',
      '/notifications'
    );
  elsif tg_op = 'UPDATE' and old.status = 'pending' and new.status = 'declined' then
    perform public.gayze_enqueue_notification(
      new.from_user_id,
      new.to_user_id,
      'connection',
      'interest:'||new.id::text||':declined',
      '/notifications'
    );
  end if;
  return new;
end;
$function$;

drop trigger if exists trg_gayze_interest_notification on public.interests;
create trigger trg_gayze_interest_notification
after insert or update of status on public.interests
for each row execute function public.gayze_interest_notification();

revoke all on function public.gayze_interest_notification() from public,anon,authenticated;
