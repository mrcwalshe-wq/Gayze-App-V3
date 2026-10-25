-- Security advisor hardening. Non-destructive: only narrows who may EXECUTE
-- SECURITY DEFINER functions and pins a search_path. No data is touched.
--
-- Every function below either reads auth.uid() (and so does nothing useful for
-- a signed-out caller) or is a trigger function (EXECUTE is not checked when a
-- trigger fires). All RLS policies that call the helper functions are
-- `TO authenticated`, so removing anon EXECUTE cannot change policy results.

do $$
declare
  fn text;
  trigger_fns constant text[] := array[
    'public.gayze_reject_blocked_interaction()',
    'public.gayze_suppress_blocked_notification()',
    'public.profile_photos_sync_avatar_path()'
  ];
  caller_fns constant text[] := array[
    'public.discover_right_now(integer, text, text)',
    'public.gayze_can_view_profile_media(text)',
    'public.gayze_is_blocked_between(uuid)',
    'public.register_identity_device(text, text, text, text, uuid)',
    'public.verify_peer_identity(text, text, uuid)'
  ];
begin
  foreach fn in array trigger_fns loop
    execute format('revoke execute on function %s from public, anon, authenticated', fn);
  end loop;
  foreach fn in array caller_fns loop
    execute format('revoke execute on function %s from public, anon', fn);
    execute format('grant execute on function %s to authenticated, service_role', fn);
  end loop;
end $$;

-- Mutable search_path flagged by the advisor.
alter function public.gayze_push_set_updated_at() set search_path = public, pg_temp;
