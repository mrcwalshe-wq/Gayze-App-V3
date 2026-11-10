-- "Sign out other devices": also stop the other phones ringing for this account.
create or replace function public.drop_other_voip_tokens(p_keep_device text default null)
returns void language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if auth.uid() is null then raise exception 'not authenticated'; end if;
  delete from public.voip_tokens where user_id = auth.uid() and (p_keep_device is null or device_id is distinct from p_keep_device);
end $$;
revoke all on function public.drop_other_voip_tokens(text) from public, anon;
grant execute on function public.drop_other_voip_tokens(text) to authenticated;
