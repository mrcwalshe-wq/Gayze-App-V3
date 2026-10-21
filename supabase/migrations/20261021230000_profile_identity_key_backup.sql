-- Account-level E2EE identity storage so every device signed in to the same
-- profile derives the same identity and can open existing conversation keys.
create table if not exists public.profile_identity_keys (
  user_id uuid primary key references auth.users(id) on delete cascade,
  identity jsonb not null,
  created_at timestamptz not null default now()
);

alter table public.profile_identity_keys enable row level security;

drop policy if exists "profile_identity_keys_select_own" on public.profile_identity_keys;
create policy "profile_identity_keys_select_own" on public.profile_identity_keys
  for select to authenticated using (user_id = (select auth.uid()));

drop policy if exists "profile_identity_keys_insert_own" on public.profile_identity_keys;
create policy "profile_identity_keys_insert_own" on public.profile_identity_keys
  for insert to authenticated with check (user_id = (select auth.uid()));

revoke all on public.profile_identity_keys from anon, public;
grant select, insert on public.profile_identity_keys to authenticated;
