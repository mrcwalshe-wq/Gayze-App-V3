-- Enforce one outgoing Gayze per user in any rolling 24-hour window.
-- The database owns the cooldown so clients cannot bypass it by refreshing or switching devices.
begin;

create table if not exists public.gayze_send_cooldowns (
  user_id uuid primary key references auth.users(id) on delete cascade,
  last_sent_at timestamptz not null
);

alter table public.gayze_send_cooldowns enable row level security;
revoke all on public.gayze_send_cooldowns from public, anon, authenticated;

create or replace function public.gayze_enforce_send_cooldown()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_user_id uuid;
  v_last_sent timestamptz;
  v_remaining integer;
begin
  if tg_table_name = 'interests' then
    -- A newly created or reactivated pending interest represents a sent Gayze.
    if new.status <> 'pending' or
       (tg_op = 'UPDATE' and old.status is not distinct from new.status) then
      return new;
    end if;
    v_user_id := new.from_user_id;
  else
    -- Repeat Gayzes to an existing connection are recorded in gazes.
    v_user_id := new.from_user_id;
    -- The first mutual match writes a pending interest and a gaze in one
    -- transaction; don't double-count that same send.
    if exists (
      select 1 from public.gayze_send_cooldowns
      where user_id = v_user_id and last_sent_at = transaction_timestamp()
    ) then
      return new;
    end if;
  end if;

  insert into public.gayze_send_cooldowns(user_id, last_sent_at)
  values (v_user_id, '-infinity'::timestamptz)
  on conflict (user_id) do nothing;

  select last_sent_at into v_last_sent
  from public.gayze_send_cooldowns
  where user_id = v_user_id
  for update;

  if v_last_sent > '-infinity'::timestamptz
     and v_last_sent > now() - interval '24 hours' then
    v_remaining := greatest(1, ceil(extract(epoch from (v_last_sent + interval '24 hours' - now())))::integer);
    raise exception using
      errcode = 'P0001',
      message = 'GAYZE_COOLDOWN',
      detail = jsonb_build_object('retry_after_seconds', v_remaining)::text;
  end if;

  update public.gayze_send_cooldowns
  set last_sent_at = now()
  where user_id = v_user_id;

  return new;
end;
$$;

drop trigger if exists interests_gayze_send_cooldown on public.interests;
create trigger interests_gayze_send_cooldown
before insert or update of status on public.interests
for each row execute function public.gayze_enforce_send_cooldown();

drop trigger if exists gazes_gayze_send_cooldown on public.gazes;
create trigger gazes_gayze_send_cooldown
before insert on public.gazes
for each row execute function public.gayze_enforce_send_cooldown();

revoke all on function public.gayze_enforce_send_cooldown() from public, anon, authenticated;
commit;
