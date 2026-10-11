-- Restore the safety-check-in columns still used by the app.
-- Keep partner_user_id intact for deployments that use account-linked check-ins.
alter table public.safety_checkins
  add column if not exists partner_name text,
  add column if not exists created_at timestamptz not null default now(),
  add column if not exists ended_at timestamptz;

comment on column public.safety_checkins.partner_name is
  'Optional display name entered for the safety check-in; may be used when no linked partner account is selected.';
