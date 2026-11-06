-- "Mark all read", and opening a chat now also clears that chat's missed-call and connection notifications
-- (previously only message and call ones, so those stayed unread forever unless tapped).
create or replace function public.gayze_mark_all_notifications_read()
returns integer
language plpgsql security definer set search_path = public, pg_temp as $$
declare n integer;
begin
  if auth.uid() is null then raise exception 'Sign in required'; end if;
  update public.gayze_notifications set read_at = now() where user_id = auth.uid() and read_at is null;
  get diagnostics n = row_count;
  return n;
end $$;
revoke all on function public.gayze_mark_all_notifications_read() from public, anon;
grant execute on function public.gayze_mark_all_notifications_read() to authenticated;

create or replace function public.gayze_mark_notification_read(p_id uuid default null, p_conversation uuid default null)
returns void
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if auth.uid() is null then raise exception 'Sign in required'; end if;
  update public.gayze_notifications set read_at = now()
  where user_id = auth.uid() and read_at is null
    and (id = p_id or (p_conversation is not null and category in ('message','call','missed_call','connection') and url = '/messages/' || p_conversation::text));
end $$;
