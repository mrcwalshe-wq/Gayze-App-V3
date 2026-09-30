-- ============================================================================
-- Profile / "About you" rework — additive data model
-- ============================================================================
-- Scope (deliberately additive only):
--   1. Seven nullable columns on `profiles` for the PUBLIC profile tier.
--   2. A new `profile_intimacy` table for the SENSITIVE tier, with owner-only
--      RLS, plus `get_profile_intimacy(uuid)` which is the ONLY way other
--      users can read it and which enforces the visibility setting.
--
-- Nothing existing is altered: no column is dropped or retyped, no existing
-- policy is touched, no existing function is replaced. `private.discover_right_now`
-- and the other discovery RPCs are untouched, so no new field can leak through
-- discovery — their return column lists are fixed and remain so.
--
-- Existing users need no data migration: existing `profiles.interests` values
-- (Meet, Drinks, Date, Chat, Group, Hookup · …) ARE the "What I'm looking for"
-- selections and are reused as-is. All new columns default to NULL/unset.
--
-- REUSED existing columns: display_name, age, bio, neighborhood, interests
--   (looking-for), privacy_setting, avatar_path, profile_photos.
-- NEW public columns:  pronouns, height_cm, body_type, hobbies, boundaries,
--   my_setup, availability.
-- NEW sensitive table: profile_intimacy (role, preferences, experience,
--   visibility — defaulting to the privacy-preserving 'connections').
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. Public profile tier — additive columns, all nullable ("unset")
-- ---------------------------------------------------------------------------
alter table public.profiles
  add column if not exists pronouns    text,
  add column if not exists height_cm   smallint,
  add column if not exists body_type   text,
  add column if not exists hobbies     text[],
  add column if not exists boundaries  text[],
  add column if not exists my_setup    text[],
  add column if not exists availability text[];

comment on column public.profiles.pronouns is
  'Optional pronouns (free text, e.g. "he/him"). Public profile tier.';
comment on column public.profiles.height_cm is
  'Optional height in centimetres. Public profile tier.';
comment on column public.profiles.body_type is
  'Optional self-described body type. Public profile tier.';
comment on column public.profiles.hobbies is
  'Interest/hobby chips. Public profile tier.';
comment on column public.profiles.boundaries is
  'Compatibility boundary chips (e.g. "No smoking", "Safer sex"). Public profile tier.';
comment on column public.profiles.my_setup is
  'Hosting/travel compatibility tags (e.g. "Sometimes host"). Standing preference; per-broadcast values stay on intents.can_host / intents.travel_willingness.';
comment on column public.profiles.availability is
  'Standing availability tags. The live broadcast remains the intents system.';

-- ---------------------------------------------------------------------------
-- 2. Sensitive tier — owner-only table
-- ---------------------------------------------------------------------------
create table if not exists public.profile_intimacy (
  user_id             uuid primary key references public.profiles (id) on delete cascade,
  intimacy_role       text,
  intimacy_prefs      text[] not null default '{}',
  intimacy_experience text,
  -- 'everyone' | 'connections' | 'private'. Default is privacy-preserving:
  -- sensitive preferences must never become public automatically.
  intimacy_visibility text not null default 'connections'
    check (intimacy_visibility in ('everyone', 'connections', 'private')),
  updated_at          timestamptz not null default now()
);

comment on table public.profile_intimacy is
  'Sensitive intimacy preferences. Owner-only RLS; other users read exclusively through get_profile_intimacy(), which enforces intimacy_visibility.';

alter table public.profile_intimacy enable row level security;

drop policy if exists profile_intimacy_owner on public.profile_intimacy;
create policy profile_intimacy_owner on public.profile_intimacy
  for all
  to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

grant select, insert, update on public.profile_intimacy to authenticated;

-- ---------------------------------------------------------------------------
-- 3. Visibility-enforcing read path for other users
-- ---------------------------------------------------------------------------
-- Returns the row only when the caller is allowed to see it:
--   * the owner always sees their own row;
--   * visibility = 'everyone'    -> any authenticated caller;
--   * visibility = 'connections' -> only users who share a conversation with
--     the owner (a mutual interest creates one via submit_interest). The
--     check reuses the live, SECURITY DEFINER `get_my_conversations()`;
--   * visibility = 'private'     -> nobody but the owner.
-- SECURITY DEFINER is required: the table itself is owner-only under RLS.
create or replace function public.get_profile_intimacy(p_user_id uuid)
returns table (
  intimacy_role       text,
  intimacy_prefs      text[],
  intimacy_experience text,
  intimacy_visibility text
)
language sql
stable
security definer
set search_path = public
as $$
  select pi.intimacy_role,
         pi.intimacy_prefs,
         pi.intimacy_experience,
         pi.intimacy_visibility
  from public.profile_intimacy pi
  where pi.user_id = p_user_id
    and (
      pi.user_id = (select auth.uid())
      or pi.intimacy_visibility = 'everyone'
      or (
        pi.intimacy_visibility = 'connections'
        and exists (
          select 1 from public.get_my_conversations() g
          where g.user_id = p_user_id
        )
      )
    );
$$;

revoke execute on function public.get_profile_intimacy(uuid) from public, anon;
grant execute on function public.get_profile_intimacy(uuid) to authenticated;

comment on function public.get_profile_intimacy(uuid) is
  'Visibility-enforced read of profile_intimacy for peer profiles. Never part of discovery RPCs.';
