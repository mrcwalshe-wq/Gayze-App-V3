-- Records the production definition of gayze_notification_http_dispatch. Production authenticates the
-- database-to-send-push call with the vault secret 'gayze_push_dispatch_runtime_secret' (the value the
-- deployed send-push compares against via gayze_get_push_dispatch_runtime_secret()). The earlier
-- migration (20261002100000) still sent 'gayze_push_dispatch_secret', so a database rebuilt from the
-- repository would have had every database-triggered push rejected with 403.
-- Identical to what is already deployed, so applying it to production changes nothing.
create or replace function public.gayze_notification_http_dispatch(p_payload jsonb)
returns void
language plpgsql
security definer
set search_path to 'public', 'extensions', 'pg_temp'
as $$
declare
  v_url text;
  v_secret text;
  v_base text;
  v_endpoint text;
begin
  select decrypted_secret into v_url from vault.decrypted_secrets where name='gayze_functions_url';
  select decrypted_secret into v_secret from vault.decrypted_secrets where name='gayze_push_dispatch_runtime_secret';
  if v_url is null or v_secret is null then raise warning '[GAYZE] push dispatch not configured; notification retained'; return; end if;
  v_base:=rtrim(v_url,'/');
  if v_base !~ '^https://[a-zA-Z0-9.-]+(:443)?(/functions/v1)?$' then raise warning '[GAYZE] push dispatch requires a valid HTTPS functions base'; return; end if;
  v_endpoint:=case when v_base like '%/functions/v1' then v_base||'/send-push' else v_base||'/functions/v1/send-push' end;
  perform net.http_post(url:=v_endpoint,headers:=jsonb_build_object('Content-Type','application/json','x-gayze-dispatch-secret',v_secret),body:=p_payload,timeout_milliseconds:=5000);
exception when others then
  raise warning '[GAYZE] push dispatch failed; notification retained';
end;
$$;
revoke all on function public.gayze_notification_http_dispatch(jsonb) from public, anon, authenticated;
