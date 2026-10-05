-- Mark call notifications read when the user answers/declines the call.
create or replace function public.gayze_mark_notification_read(p_id uuid default null,p_conversation uuid default null)
returns void
language plpgsql
security definer
set search_path=public,pg_temp
as $$
begin
  if auth.uid() is null then raise exception 'Sign in required'; end if;
  update public.gayze_notifications
     set read_at=now()
   where user_id=auth.uid()
     and read_at is null
     and (
       id=p_id
       or ((category in ('message','call')) and url='/messages/'||p_conversation::text)
     );
end;
$$;
