-- Intent model v2: a signal is three separate choices.
--   availability: when (starts_at / expires_at, already stored)
--   activity:     what the person is up for (new: intents.activities)
--   connection:   what kinds of connection they are open to (new: intents.connections)
-- "Open to more" is a separate, PRIVATE flag (public.intent_openness). It is never returned by discovery, never shown on a
-- profile and never filterable. There is deliberately no function that reads someone else's value: a "mutual" lookup would
-- let anyone switch theirs on and read the other person's setting. The mutual prompt is sent by the server only when both
-- are on (a later step), so the absence of a prompt reveals nothing.
-- Additive: the old `mode` and `intent` columns stay and keep working while the app changes over.

alter table public.intents add column if not exists activities text[] not null default '{}';
alter table public.intents add column if not exists connections text[] not null default '{}';

-- Back-fill from the existing signals (see the prototype's "Existing signals" table).
update public.intents set
  activities = case intent
    when 'Hookup' then array['spontaneous']
    when 'Hookup · Host' then array['spontaneous']
    when 'Hookup · Travel' then array['spontaneous']
    when 'Hookup · Car' then array['spontaneous']
    when 'Hookup · Outdoor' then array['walks']
    when 'Meet' then array['spontaneous']
    when 'Drinks' then array['drinks']
    when 'Date' then array['drinks']
    when 'Chat' then array['chat']
    when 'Group' then array['spontaneous']
    else array['spontaneous'] end,
  connections = case intent
    when 'Meet' then array['new']
    when 'Drinks' then array['social']
    when 'Date' then array['dating']
    when 'Chat' then array['new']
    when 'Group' then array['friends']
    else '{}'::text[] end
where activities = '{}';

alter table public.intents drop constraint if exists intents_activities_known;
alter table public.intents add constraint intents_activities_known check (
  activities <@ array['coffee','drinks','food','walks','music','fitness','explore','culture','games','chat','spontaneous']::text[]
  and cardinality(activities) <= 6);
alter table public.intents drop constraint if exists intents_connections_known;
alter table public.intents add constraint intents_connections_known check (
  connections <@ array['new','friends','dating','see','social']::text[] and cardinality(connections) <= 5);

-- Private "Open to more" flag. Own row only.
create table if not exists public.intent_openness (
  user_id uuid primary key references auth.users(id) on delete cascade,
  open_to_more boolean not null default false,
  updated_at timestamptz not null default now()
);
alter table public.intent_openness enable row level security;
alter table public.intent_openness force row level security;
drop policy if exists intent_openness_own on public.intent_openness;
create policy intent_openness_own on public.intent_openness for all to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
revoke all on public.intent_openness from anon, authenticated;
grant select, insert, update on public.intent_openness to authenticated;

-- Carry the old meaning across: anyone who has used the old private mode keeps "open to more" switched on.
insert into public.intent_openness (user_id, open_to_more)
select distinct user_id, true from public.intents where mode = 'private'
on conflict (user_id) do nothing;

create or replace function public.set_open_to_more(p_enabled boolean)
returns boolean language plpgsql security definer set search_path = public, pg_temp as $$
declare uid uuid := (select auth.uid());
begin
  if uid is null then raise exception 'not authenticated'; end if;
  insert into public.intent_openness (user_id, open_to_more, updated_at) values (uid, coalesce(p_enabled, false), now())
  on conflict (user_id) do update set open_to_more = excluded.open_to_more, updated_at = now();
  return coalesce(p_enabled, false);
end $$;
revoke all on function public.set_open_to_more(boolean) from public, anon;
grant execute on function public.set_open_to_more(boolean) to authenticated;
