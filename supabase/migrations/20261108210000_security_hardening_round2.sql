-- 1. public.spatial_ref_sys (PostGIS reference table, owned by supabase_admin) has RLS off and full write grants for the
--    anonymous and signed-in API roles, so anyone with the public key could change or empty it. This role cannot change its
--    owner's grants or enable RLS on it, so writes through the API roles are refused with a trigger instead. Reads still work,
--    and PostGIS and the database owner can still write.
create or replace function public.gayze_block_api_writes() returns trigger language plpgsql set search_path = public, pg_temp as $$
begin
  if current_user in ('anon', 'authenticated') then
    raise exception 'This table is read-only through the API.' using errcode = '42501';
  end if;
  return coalesce(new, old);
end $$;
revoke all on function public.gayze_block_api_writes() from public, anon, authenticated;

drop trigger if exists gayze_block_api_writes_row on public.spatial_ref_sys;
create trigger gayze_block_api_writes_row before insert or update or delete on public.spatial_ref_sys
  for each row execute function public.gayze_block_api_writes();
drop trigger if exists gayze_block_api_writes_truncate on public.spatial_ref_sys;
create trigger gayze_block_api_writes_truncate before truncate on public.spatial_ref_sys
  for each statement execute function public.gayze_block_api_writes();

-- 2. The quick-plan rule is a trigger function; it must not be callable as an API endpoint. Triggers do not need the
--    caller to hold EXECUTE, so the rule keeps working.
revoke all on function public.gayze_guard_intent_vs_quick_plan() from public, anon, authenticated;
