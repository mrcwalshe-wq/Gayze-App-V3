-- "Unsend for everyone" used to only stamp unsent_at: the encrypted photo stayed in the database and was still delivered to
-- the other person's phone, and it could only be done in the first 15 minutes. It now removes the content itself, and the
-- window is 48 hours.
create or replace function public.unsend_message(p_message_id uuid)
returns boolean
language plpgsql
security definer
set search_path=public,pg_temp
as $$
declare
  v_user uuid := auth.uid();
  v_rows integer;
begin
  if v_user is null then raise exception 'Sign in required' using errcode='28000'; end if;
  update public.messages
     set unsent_at=coalesce(unsent_at, now()), unsent_by=v_user, ciphertext='', nonce=null
   where id=p_message_id
     and sender_id=v_user
     and unsent_at is null
     and created_at >= now() - interval '48 hours';
  get diagnostics v_rows = row_count;
  if v_rows=0 then raise exception 'Message can no longer be unsent' using errcode='42501'; end if;
  return true;
end $$;

-- Content of messages that were already unsent.
update public.messages set ciphertext='', nonce=null where unsent_at is not null and ciphertext <> '';
