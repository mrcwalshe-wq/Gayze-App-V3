-- Do not create inbox rows or dispatch pushes when the actor and recipient
-- have a block in either direction. System events with no actor remain allowed.
create or replace function public.gayze_suppress_blocked_notification()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $gayze_notice_fn$
begin
  if new.actor_id is not null
     and exists (
       select 1 from public.blocks b
       where (b.blocker_id = new.user_id and b.blocked_id = new.actor_id)
          or (b.blocker_id = new.actor_id and b.blocked_id = new.user_id)
     ) then
    return null;
  end if;
  return new;
end;
$gayze_notice_fn$;

drop trigger if exists gayze_suppress_blocked_notification on public.gayze_notifications;
create trigger gayze_suppress_blocked_notification
before insert on public.gayze_notifications
for each row execute function public.gayze_suppress_blocked_notification();
