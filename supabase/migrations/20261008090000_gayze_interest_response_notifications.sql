-- GAYZE interest response notifications
-- Durable notification wiring for the intent-interest lifecycle.
--
-- INSERT pending       -> recipient gets "Someone sent you a Gayze".
-- pending -> mutual    -> handled by accept_incoming_interest via
--                         gayze_connection_notification (no duplicate here).
-- pending -> declined  -> sender gets "Your Gayze was declined" under the Gayzes preference.
--
-- Fail fast if either the interest table or durable notification function
-- is missing. This migration does not guess at the production schema.

do $guard$
begin
  if to_regclass('public.interests') is null then
    raise exception 'GAYZE interest notification migration requires public.interests';
  end if;

  if to_regprocedure('public.gayze_enqueue_notification(uuid,uuid,text,text,text)') is null then
    raise exception 'GAYZE interest notification migration requires public.gayze_enqueue_notification(uuid,uuid,text,text,text)';
  end if;

  if not exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'interests'
      and column_name = 'from_user_id'
  )
  or not exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'interests'
      and column_name = 'to_user_id'
  )
  or not exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'interests'
      and column_name = 'status'
  ) then
    raise exception 'GAYZE interest notification migration requires interests.from_user_id, interests.to_user_id and interests.status';
  end if;
end
$guard$;

create or replace function public.gayze_interest_notification()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $function$
begin
  if tg_op = 'INSERT' and new.status = 'pending' then
    perform public.gayze_enqueue_notification(
      new.to_user_id,
      new.from_user_id,
      'gaze',
      'interest:' || new.id::text || ':received',
      '/notifications'
    );
  elsif tg_op = 'UPDATE'
        and old.status = 'pending'
        and new.status = 'declined' then
    perform public.gayze_enqueue_notification(
      new.from_user_id,
      new.to_user_id,
      'gaze',
      'interest:' || new.id::text || ':declined',
      '/notifications'
    );
  end if;

  return new;
end;
$function$;

drop trigger if exists trg_gayze_interest_notification on public.interests;

create trigger trg_gayze_interest_notification
after insert or update of status on public.interests
for each row
execute function public.gayze_interest_notification();

revoke all on function public.gayze_interest_notification() from public, anon, authenticated;
