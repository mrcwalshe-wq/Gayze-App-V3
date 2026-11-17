-- PostGIS advisor findings (extension_in_public, rls_disabled_in_public on public.spatial_ref_sys). Separate from the hygiene
-- migration so it can be applied or rejected on its own. See docs/SECURITY_DEFINER_AUDIT.md, "PostGIS in public".
--
-- What this does NOT do: move the extension. PostGIS 3.3 is not relocatable (pg_extension.extrelocatable = false), it and
-- spatial_ref_sys are owned by supabase_admin, and the migration role (postgres) is neither a superuser nor a member of that
-- role. ALTER EXTENSION postgis SET SCHEMA would fail, and forcing it would need a superuser to rewrite 744 functions' schema
-- while three geography columns, three GiST indexes and four functions that call st_* unqualified depend on them.
--
-- What it does: removes the write privileges the two API roles hold on the reference table, leaving SELECT (PostGIS reads
-- this table as the calling role when it validates or transforms an SRID, so SELECT must stay). Writes are already refused by
-- the gayze_block_api_writes triggers from 20261108210000; this removes the privilege itself where the executing role may.
--
-- On the hosted project the grants were made by supabase_admin and postgres holds no grant option, so these statements revoke
-- nothing there (PostgreSQL reports "no privileges could be revoked" as a warning, not an error). It takes effect when run by
-- the table's owner: a local stack, or Supabase support. The notice at the end says which happened.
do $$
declare still_writable boolean;
begin
  if to_regclass('public.spatial_ref_sys') is null then
    raise notice 'spatial_ref_sys: not present, nothing to do';
    return;
  end if;
  begin
    revoke insert, update, delete, truncate on public.spatial_ref_sys from anon, authenticated;
  exception when insufficient_privilege then
    null; -- reported below
  end;
  select has_table_privilege('anon', 'public.spatial_ref_sys', 'insert, update, delete, truncate')
      or has_table_privilege('authenticated', 'public.spatial_ref_sys', 'insert, update, delete, truncate')
    into still_writable;
  if still_writable then
    raise notice 'spatial_ref_sys: write privileges for the API roles are unchanged (this role does not own the grants). The write-blocking triggers remain the control.';
  else
    raise notice 'spatial_ref_sys: write privileges removed from anon and authenticated; SELECT kept.';
  end if;
end $$;
