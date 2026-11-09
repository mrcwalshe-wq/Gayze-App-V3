-- Call pushes go to their own Edge Function (voip-call-push), so the main send-push function is not touched.
-- Same URL/secret handling as gayze_notification_http_dispatch, different endpoint.
create or replace function public.gayze_voip_http_dispatch(p_payload jsonb)
returns void
language plpgsql
security definer
set search_path = public, extensions, pg_temp
as $$
declare
  v_url text; v_secret text; v_base text; v_endpoint text;
begin
  begin
    select decrypted_secret into v_url from vault.decrypted_secrets where name = 'gayze_functions_url';
    select decrypted_secret into v_secret from vault.decrypted_secrets where name = 'gayze_push_dispatch_runtime_secret';
  exception when others then
    raise warning '[GAYZE] call push secrets unavailable';
    return;
  end;
  if v_url is null or v_secret is null then
    raise warning '[GAYZE] call push not configured; skipping';
    return;
  end if;
  v_base := rtrim(v_url, '/');
  if v_base !~ '^https://[a-zA-Z0-9.-]+(:443)?(/functions/v1)?$' then
    raise warning '[GAYZE] call push requires a valid HTTPS functions base';
    return;
  end if;
  if v_base like '%/functions/v1' then v_endpoint := v_base || '/voip-call-push';
  else v_endpoint := v_base || '/functions/v1/voip-call-push';
  end if;
  perform net.http_post(
    url := v_endpoint,
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-gayze-dispatch-secret', v_secret),
    body := p_payload,
    timeout_milliseconds := 5000
  );
exception when others then
  raise warning '[GAYZE] call push dispatch failed';
end $$;
revoke all on function public.gayze_voip_http_dispatch(jsonb) from public, anon, authenticated;

create or replace function public.call_session_voip_dispatch()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
begin
  perform public.gayze_voip_http_dispatch(jsonb_build_object('callSessionId', new.id));
  return new;
exception when others then
  raise warning '[GAYZE] call push dispatch failed';
  return new;
end $$;
revoke all on function public.call_session_voip_dispatch() from public, anon, authenticated;
