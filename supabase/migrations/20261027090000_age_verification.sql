-- Age verification (Yoti). One row per member. Only the age-verify edge functions
-- (service role) write it; members can read their own row to see whether they have passed.
-- No ID images, selfies or birth dates are stored: only the outcome and the method used.
create table if not exists public.age_verifications (
  user_id uuid primary key references auth.users(id) on delete cascade,
  provider text not null default 'yoti',
  session_id text,
  status text not null default 'pending' check (status in ('pending', 'verified', 'failed')),
  method text,
  verified_at timestamptz,
  updated_at timestamptz not null default now()
);

alter table public.age_verifications enable row level security;

drop policy if exists "Members read their own age verification" on public.age_verifications;
create policy "Members read their own age verification"
  on public.age_verifications
  for select
  to authenticated
  using (user_id = auth.uid());

revoke all on public.age_verifications from anon;
revoke insert, update, delete on public.age_verifications from authenticated;
grant select on public.age_verifications to authenticated;
