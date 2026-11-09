-- Gayze limit, per person: one Gayze to the same person per 24 hours, and at most 20 in 24 hours overall.
-- (Replaces the single global once-a-day limit, which locked a sender out of everyone after one send.)
create table if not exists public.gayze_send_log (
  from_user_id uuid not null,
  to_user_id uuid not null,
  sent_at timestamptz not null default now()
);
create index if not exists gayze_send_log_from_to_idx on public.gayze_send_log (from_user_id, to_user_id, sent_at desc);
create index if not exists gayze_send_log_from_idx on public.gayze_send_log (from_user_id, sent_at desc);
alter table public.gayze_send_log enable row level security;
revoke all on public.gayze_send_log from anon, authenticated;

create or replace function public.gayze_enforce_send_cooldown()
returns trigger
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $function$
declare
  v_from uuid := new.from_user_id;
  v_to uuid := new.to_user_id;
  v_last timestamptz;
  v_count integer;
  v_oldest timestamptz;
  v_remaining integer;
  c_daily_cap constant integer := 20;
begin
  if tg_table_name = 'interests' then
    -- A newly created or reactivated pending interest is a sent Gayze.
    if new.status <> 'pending' or (tg_op = 'UPDATE' and old.status is not distinct from new.status) then
      return new;
    end if;
  else
    -- The first mutual match writes an interest and a gaze in one transaction: count that send once.
    if exists (select 1 from public.gayze_send_log where from_user_id = v_from and to_user_id = v_to and sent_at = transaction_timestamp()) then
      return new;
    end if;
  end if;

  -- Serialise this sender's sends so two taps cannot both pass.
  perform pg_advisory_xact_lock(hashtextextended(v_from::text, 0));

  select max(sent_at) into v_last from public.gayze_send_log
   where from_user_id = v_from and to_user_id = v_to and sent_at > now() - interval '24 hours';
  if v_last is not null then
    v_remaining := greatest(1, ceil(extract(epoch from (v_last + interval '24 hours' - now())))::integer);
    raise exception using errcode = 'P0001', message = 'GAYZE_COOLDOWN',
      detail = jsonb_build_object('retry_after_seconds', v_remaining)::text;
  end if;

  select count(*), min(sent_at) into v_count, v_oldest from public.gayze_send_log
   where from_user_id = v_from and sent_at > now() - interval '24 hours';
  if v_count >= c_daily_cap then
    v_remaining := greatest(1, ceil(extract(epoch from (v_oldest + interval '24 hours' - now())))::integer);
    raise exception using errcode = 'P0001', message = 'GAYZE_COOLDOWN',
      detail = jsonb_build_object('retry_after_seconds', v_remaining)::text;
  end if;

  insert into public.gayze_send_log(from_user_id, to_user_id, sent_at) values (v_from, v_to, now());
  return new;
end;
$function$;
