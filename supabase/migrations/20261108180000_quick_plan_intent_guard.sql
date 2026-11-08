-- While you host a live quick plan (one starting within 24 hours, or begun in the last 3), you can't post a Right now intent.
-- A Later intent is fine. The app explains this and offers to cancel the plan; this is the backstop.
create or replace function public.gayze_guard_intent_vs_quick_plan()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if tg_op = 'UPDATE' and new.starts_at is not distinct from old.starts_at then return new; end if;
  -- Later means it starts more than two hours from now; anything sooner is a live intent.
  if new.starts_at >= now() + interval '2 hours' then return new; end if;
  if exists (
    select 1 from public.gatherings g
    where g.host_id = new.user_id and g.cancelled_at is null and g.tags ? 'quick'
      and g.scheduled_at > now() - interval '3 hours' and g.scheduled_at < now() + interval '24 hours'
  ) then
    raise exception 'QUICK_PLAN_LIVE: end your quick plan before posting a live intent, or set the intent for later.';
  end if;
  return new;
end $$;

drop trigger if exists gayze_guard_intent_vs_quick_plan on public.intents;
create trigger gayze_guard_intent_vs_quick_plan before insert or update on public.intents
  for each row execute function public.gayze_guard_intent_vs_quick_plan();
