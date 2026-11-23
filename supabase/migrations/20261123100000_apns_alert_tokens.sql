-- Ordinary notifications (a Gayze, a message, a missed call) reach the installed iPhone app through Apple's push service.
-- Until now the app only registered a VoIP token (for calls), and everything else was Web Push, which the app cannot receive.
-- The phone registers its notification token here; send-push sends to it alongside Web Push.
-- Separate from voip_tokens: a different token from Apple, sent to a different topic.

create table if not exists public.apns_tokens (
  token text primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  environment text not null check (environment in ('sandbox', 'production')),
  device_id text,
  updated_at timestamptz not null default now()
);
create index if not exists apns_tokens_user_idx on public.apns_tokens (user_id);
create index if not exists apns_tokens_device_idx on public.apns_tokens (device_id);
alter table public.apns_tokens enable row level security;
revoke all on public.apns_tokens from anon, authenticated;

-- One notification token per phone, owned by whoever is signed in on it. A reinstall gets a new token: the phone's earlier
-- rows (whichever account they belonged to) are replaced. A token already registered to another account moves to the caller.
create or replace function public.register_apns_token(p_token text, p_environment text, p_device text default null)
returns void language plpgsql security definer set search_path = public, pg_temp as $$
declare uid uuid := auth.uid();
begin
  if uid is null then raise exception 'not authenticated'; end if;
  if p_token is null or p_token !~ '^[0-9a-f]{32,200}$' then raise exception 'invalid token'; end if;
  if p_environment not in ('sandbox', 'production') then raise exception 'invalid environment'; end if;
  if p_device is not null and p_device !~ '^[0-9a-f-]{16,64}$' then raise exception 'invalid device'; end if;
  if p_device is not null then
    delete from public.apns_tokens where device_id = p_device and token <> p_token;
  end if;
  insert into public.apns_tokens(token, user_id, environment, device_id, updated_at)
  values (p_token, uid, p_environment, p_device, now())
  on conflict (token) do update set user_id = excluded.user_id, environment = excluded.environment,
    device_id = coalesce(excluded.device_id, public.apns_tokens.device_id), updated_at = now();
end $$;

create or replace function public.unregister_apns_token(p_token text)
returns void language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if auth.uid() is null then raise exception 'not authenticated'; end if;
  delete from public.apns_tokens where token = p_token and user_id = auth.uid();
end $$;

revoke all on function public.register_apns_token(text, text, text), public.unregister_apns_token(text) from public, anon;
grant execute on function public.register_apns_token(text, text, text), public.unregister_apns_token(text) to authenticated;
