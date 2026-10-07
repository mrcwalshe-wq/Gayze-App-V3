-- GAYZE profile preferences persistence fix.
-- Additive and idempotent. The public profile fields are written directly to
-- profiles; sensitive intimacy preferences are isolated in profile_intimacy.

alter table public.profiles
  add column if not exists pronouns text,
  add column if not exists height_cm smallint,
  add column if not exists body_type text,
  add column if not exists hobbies text[],
  add column if not exists boundaries text[],
  add column if not exists my_setup text[],
  add column if not exists availability text[];

create table if not exists public.profile_intimacy (
  user_id uuid primary key references public.profiles(id) on delete cascade,
  intimacy_role text,
  intimacy_prefs text[] not null default '{}',
  intimacy_experience text,
  intimacy_visibility text not null default 'connections'
    check (intimacy_visibility in ('everyone','connections','private')),
  updated_at timestamptz not null default now()
);

alter table public.profile_intimacy enable row level security;
drop policy if exists profile_intimacy_owner on public.profile_intimacy;
create policy profile_intimacy_owner on public.profile_intimacy
  for all to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

grant select, insert, update on public.profile_intimacy to authenticated;

-- The client needs a stable owner-read path even on environments where the
-- conversation membership RPC has not yet been installed. Connections-only
-- visibility is therefore enforced only when that RPC exists.
create or replace function public.get_profile_intimacy(p_user_id uuid)
returns table (
  intimacy_role text,
  intimacy_prefs text[],
  intimacy_experience text,
  intimacy_visibility text
)
language plpgsql stable security definer set search_path = public
as $$
declare
  can_read boolean := false;
  has_conversation_rpc boolean := false;
begin
  if p_user_id = (select auth.uid()) then
    can_read := true;
  end if;

  select exists (
    select 1 from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'get_my_conversations'
  ) into has_conversation_rpc;

  if not can_read and has_conversation_rpc then
    execute $q$
      select exists (
        select 1 from public.get_my_conversations() g
        where g.user_id = $1
      )
    $q$ into can_read using p_user_id;
  end if;

  return query
    select pi.intimacy_role, pi.intimacy_prefs,
           pi.intimacy_experience, pi.intimacy_visibility
    from public.profile_intimacy pi
    where pi.user_id = p_user_id
      and (can_read or pi.intimacy_visibility = 'everyone');
end;
$$;

revoke execute on function public.get_profile_intimacy(uuid) from public, anon;
grant execute on function public.get_profile_intimacy(uuid) to authenticated;
