-- The owner could not send themselves a test notice: administrators were excluded from every audience,
-- including an explicit single-member one. Bulk audiences still never include suspended members or
-- administrators; an explicit 'user' audience may name an administrator (in practice, the owner testing).
create or replace function public.admin_resolve_audience(p_audience jsonb)
returns table (user_id uuid)
language plpgsql stable security definer set search_path = public, auth, pg_temp as $$
declare
  scope text := coalesce(p_audience ->> 'scope', 'all');
  days integer := least(greatest(coalesce((p_audience ->> 'days')::integer, 30), 1), 365);
begin
  if scope not in ('all', 'active', 'inactive', 'intent', 'push', 'user') then raise exception 'invalid_audience'; end if;
  return query
  select u.id from auth.users u
  where u.deleted_at is null
    and not exists (select 1 from public.account_restrictions r where r.user_id = u.id and r.status = 'suspended')
    and (scope = 'user' or not exists (select 1 from public.app_admins a where a.user_id = u.id))
    and case scope
      when 'all' then true
      when 'active' then exists (select 1 from public.profiles p where p.id = u.id and p.last_seen_at > now() - make_interval(days => days))
      when 'inactive' then not exists (select 1 from public.profiles p where p.id = u.id and p.last_seen_at > now() - make_interval(days => days))
      when 'intent' then exists (select 1 from public.intents i where i.user_id = u.id and i.expires_at > now() and not coalesce(i.is_paused, false)
                                   and (p_audience ->> 'intent' is null or i.intent ilike (replace(replace(replace(p_audience ->> 'intent', '\', '\\'), '%', '\%'), '_', '\_') || '%')))
      when 'push' then exists (select 1 from public.push_subscriptions s where s.user_id = u.id)
      when 'user' then u.id = (p_audience ->> 'user')::uuid
      else false end;
end $$;
