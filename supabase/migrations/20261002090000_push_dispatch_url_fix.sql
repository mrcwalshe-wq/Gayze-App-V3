-- ============================================================================
-- Push dispatch URL normalisation — fixes the message-notification path
-- ============================================================================
-- WHY THIS EXISTS
--
-- `public.request_push_dispatch()` (created by 20260929120000_push_notifications.sql)
-- built its pg_net target as:
--
--     v_url || '/send-push'
--
-- where `v_url` is the Vault secret `gayze_functions_url`. That is only correct
-- when the secret holds the DEDICATED functions host
-- (https://<ref>.functions.supabase.co). When the secret holds the project URL
-- (https://<ref>.supabase.co) — the natural value, and the value the task
-- requires to resolve to the canonical endpoint — the generated URL was
--     https://<ref>.supabase.co/send-push
-- which the Supabase gateway answers with 404 "requested path is invalid".
-- That is exactly the observed failure: connection pushes (sent via
-- supabase-js `functions.invoke`, which ALWAYS uses /functions/v1/) worked,
-- while message pushes (sent via this pg_net bridge) never arrived.
--
-- LIVE-VERIFIED URL RESOLUTION (unauthenticated GET probes, 2026-09-30;
-- each returns the function's own `{"error":"Method not allowed"}` iff the
-- route reaches the deployed send-push function):
--
--   https://<ref>.supabase.co/functions/v1/send-push            -> REACHES fn
--   https://<ref>.supabase.co/send-push                         -> gateway 404
--   https://<ref>.functions.supabase.co/send-push               -> REACHES fn
--   https://<ref>.functions.supabase.co/functions/v1/send-push  -> REACHES fn
--
-- So appending `/functions/v1/send-push` is correct for BOTH hosts; it is the
-- one form that works regardless of which of the two hosts the secret holds.
--
-- THE FIX
--
-- Normalise the secret value instead of trusting its shape:
--   * strip trailing slashes;
--   * if it already ends with `/functions/v1`, append `/send-push`;
--   * otherwise append `/functions/v1/send-push`.
--
-- All four plausible secret forms therefore resolve to a live-verified route:
--   https://<ref>.supabase.co             -> .../functions/v1/send-push
--   https://<ref>.functions.supabase.co   -> .../functions/v1/send-push
--   https://<ref>.supabase.co/functions/v1 -> .../functions/v1/send-push
--   https://<ref>.functions.supabase.co/functions/v1 -> .../functions/v1/send-push
--
-- Everything else about the function is preserved byte-for-byte in behaviour:
-- the same Vault secrets, the same payload, the same header, the same
-- "never raises / never blocks the originating write" contract. The function is
-- ours (comment-tagged 'gayze-push:'), so `create or replace` is safe; the base
-- migration's preflight continues to recognise it.
--
-- Idempotent: re-running replaces the same definition.
-- ============================================================================

create or replace function public.request_push_dispatch(p_payload jsonb)
returns void
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_url      text;
  v_secret   text;
  v_base     text;
  v_endpoint text;
begin
  begin
    select decrypted_secret into v_url
      from vault.decrypted_secrets where name = 'gayze_functions_url';
    select decrypted_secret into v_secret
      from vault.decrypted_secrets where name = 'gayze_push_dispatch_secret';
  exception when others then
    raise warning '[GAYZE] push dispatch secrets unavailable: %', sqlerrm;
    return;
  end;

  if v_url is null or v_secret is null then
    raise warning '[GAYZE] push dispatch not configured; skipping';
    return;
  end if;

  -- Normalise: the endpoint must always resolve to <base>/functions/v1/send-push
  -- (or <base>/send-push when the base already includes /functions/v1). Never
  -- <base>/send-push on a bare project/functions host.
  v_base := rtrim(v_url, '/');
  if v_base like '%/functions/v1' then
    v_endpoint := v_base || '/send-push';
  else
    v_endpoint := v_base || '/functions/v1/send-push';
  end if;

  perform net.http_post(
    url     := v_endpoint,
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-gayze-dispatch-secret', v_secret
    ),
    body    := p_payload,
    timeout_milliseconds := 5000
  );
exception when others then
  -- Push must never break the originating write.
  raise warning '[GAYZE] push dispatch failed: %', sqlerrm;
end;
$$;

comment on function public.request_push_dispatch(jsonb) is
  'gayze-push: pg_net bridge to the send-push Edge Function (URL-normalised, never raises).';

revoke all on function public.request_push_dispatch(jsonb) from public, anon, authenticated;
