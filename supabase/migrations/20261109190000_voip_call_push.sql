-- Incoming calls reach a closed iPhone app as a real phone call (iOS VoIP push -> CallKit).
-- The phone registers its VoIP token here; when a call starts ringing, send-push sends it to Apple.

create table if not exists public.voip_tokens (
  token text primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  environment text not null check (environment in ('sandbox','production')),
  updated_at timestamptz not null default now()
);
create index if not exists voip_tokens_user_idx on public.voip_tokens(user_id);
alter table public.voip_tokens enable row level security;
revoke all on public.voip_tokens from anon, authenticated;

create or replace function public.register_voip_token(p_token text, p_environment text)
returns void language plpgsql security definer set search_path = public, pg_temp as $$
declare uid uuid := auth.uid();
begin
  if uid is null then raise exception 'not authenticated'; end if;
  if p_token is null or p_token !~ '^[0-9a-f]{32,200}$' then raise exception 'invalid token'; end if;
  if p_environment not in ('sandbox','production') then raise exception 'invalid environment'; end if;
  -- A token belongs to one account: signing in as someone else on the same phone moves it.
  insert into public.voip_tokens(token, user_id, environment, updated_at) values (p_token, uid, p_environment, now())
  on conflict (token) do update set user_id = excluded.user_id, environment = excluded.environment, updated_at = now();
end $$;

create or replace function public.unregister_voip_token(p_token text)
returns void language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if auth.uid() is null then raise exception 'not authenticated'; end if;
  delete from public.voip_tokens where token = p_token and user_id = auth.uid();
end $$;

revoke all on function public.register_voip_token(text, text), public.unregister_voip_token(text) from public, anon;
grant execute on function public.register_voip_token(text, text), public.unregister_voip_token(text) to authenticated;

-- When a call starts ringing, ask send-push to ring the callee's phone.
create or replace function public.call_session_voip_dispatch()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
begin
  perform public.gayze_notification_http_dispatch(jsonb_build_object('callSessionId', new.id));
  return new;
exception when others then
  raise warning '[GAYZE] call push dispatch failed';
  return new;
end $$;
revoke all on function public.call_session_voip_dispatch() from public, anon, authenticated;

drop trigger if exists call_sessions_voip_dispatch on public.call_sessions;
create trigger call_sessions_voip_dispatch after insert on public.call_sessions
for each row execute function public.call_session_voip_dispatch();
