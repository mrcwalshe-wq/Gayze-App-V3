-- One call token per phone, owned by whoever is signed in on it.
-- Before: every reinstall or account switch left an old token behind, so a call to an account also rang an old
-- registration (for example the caller's own phone). Now a phone registers with its device id and replaces its
-- earlier rows, whichever account they belonged to.
alter table public.voip_tokens add column if not exists device_id text;
create index if not exists voip_tokens_device_idx on public.voip_tokens(device_id);

create or replace function public.register_voip_token(p_token text, p_environment text, p_device text default null)
returns void language plpgsql security definer set search_path = public, pg_temp as $$
declare uid uuid := auth.uid();
begin
  if uid is null then raise exception 'not authenticated'; end if;
  if p_token is null or p_token !~ '^[0-9a-f]{32,200}$' then raise exception 'invalid token'; end if;
  if p_environment not in ('sandbox','production') then raise exception 'invalid environment'; end if;
  if p_device is not null and p_device !~ '^[0-9a-f-]{16,64}$' then raise exception 'invalid device'; end if;
  if p_device is not null then
    delete from public.voip_tokens where device_id = p_device and token <> p_token;
  end if;
  insert into public.voip_tokens(token, user_id, environment, device_id, updated_at) values (p_token, uid, p_environment, p_device, now())
  on conflict (token) do update set user_id = excluded.user_id, environment = excluded.environment,
    device_id = coalesce(excluded.device_id, public.voip_tokens.device_id), updated_at = now();
end $$;
revoke all on function public.register_voip_token(text, text, text) from public, anon;
grant execute on function public.register_voip_token(text, text, text) to authenticated;

-- Registrations made before device ids existed cannot be matched to a phone (some are stale or belong to the caller's phone).
-- Each phone registers again the next time the app opens.
delete from public.voip_tokens where device_id is null;
