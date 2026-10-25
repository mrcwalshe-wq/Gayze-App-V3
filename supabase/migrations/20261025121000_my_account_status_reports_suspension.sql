-- The app asks once per session whether the signed-in member is suspended.
-- Until the PostgREST pre-request hook can be enabled, the function must answer
-- for itself instead of relying on the hook to refuse the call.
create or replace function public.my_account_status()
returns text language sql stable security definer set search_path = public, pg_temp as $$
  select case when exists (
    select 1 from public.account_restrictions
    where user_id = nullif(current_setting('request.jwt.claims', true)::jsonb ->> 'sub', '')::uuid and status = 'suspended'
  ) then 'suspended' else 'active' end
$$;
revoke execute on function public.my_account_status() from public, anon;
grant execute on function public.my_account_status() to authenticated;
