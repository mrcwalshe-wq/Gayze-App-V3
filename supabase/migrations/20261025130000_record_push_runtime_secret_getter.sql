-- Records a function that already exists in production but had no migration, so a fresh
-- database (and the push tests) match what send-push calls. Definition copied from production;
-- it holds no secret itself, only reads the vault entry. Service role only.
create or replace function public.gayze_get_push_dispatch_runtime_secret()
returns text
language sql
security definer
set search_path to 'vault', 'public', 'pg_temp'
as $$
  select decrypted_secret from vault.decrypted_secrets where name = 'gayze_push_dispatch_runtime_secret' limit 1;
$$;

revoke all on function public.gayze_get_push_dispatch_runtime_secret() from public, anon, authenticated;
grant execute on function public.gayze_get_push_dispatch_runtime_secret() to service_role;
