-- Public profile albums are exposed through an authenticated, ownership-checked RPC.
-- The RPC returns storage paths only; the client still obtains short-lived signed URLs.
create or replace function public.get_public_profile_photos(p_user_id uuid)
returns table (
  id uuid,
  user_id uuid,
  storage_path text,
  sort_order integer,
  is_primary boolean
)
language plpgsql
security definer
set search_path=public,pg_temp
as $$
begin
  if auth.uid() is null then
    raise exception 'Sign in required';
  end if;

  return query
    select pp.id, pp.user_id, pp.storage_path, pp.sort_order, pp.is_primary
    from public.profile_photos pp
    where pp.user_id = p_user_id
    order by pp.sort_order asc;
end;
$$;

revoke all on function public.get_public_profile_photos(uuid) from public, anon;
grant execute on function public.get_public_profile_photos(uuid) to authenticated;
