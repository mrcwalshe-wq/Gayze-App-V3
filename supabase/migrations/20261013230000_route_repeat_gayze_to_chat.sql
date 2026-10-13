-- Route repeat Gayze push and inbox events directly to an existing shared chat.
begin;

create or replace function public.gayze_capture_notification()
returns trigger
language plpgsql
security definer
set search_path=public,pg_temp
as $$
declare
  v_conversation uuid;
  v_destination text := '/notifications';
begin
  if auth.uid() is null and coalesce(current_setting('role',true),'none')
    not in ('none','postgres','supabase_admin','service_role') then
    raise exception 'Sign in required for notification-producing events';
  end if;

  if tg_table_name='messages' then
    if auth.uid() is not null and auth.uid()<>new.sender_id then raise exception 'Message sender mismatch'; end if;
    if not exists(select 1 from public.conversation_members where conversation_id=new.conversation_id and user_id=new.sender_id) then
      raise exception 'Message sender is not a member';
    end if;
    perform public.request_push_dispatch(jsonb_build_object('event','message','messageId',new.id));
  else
    if auth.uid() is not null and auth.uid()<>new.from_user_id then raise exception 'Gaze sender mismatch'; end if;
    if new.intent_id is not null and not exists (
      select 1 from public.intents where id=new.intent_id and user_id=new.to_user_id
    ) then
      raise exception 'Gaze intent recipient mismatch';
    end if;
    if new.from_user_id<>new.to_user_id then
      select mine.conversation_id into v_conversation
      from public.conversation_members mine
      join public.conversation_members theirs on theirs.conversation_id=mine.conversation_id
      where mine.user_id=new.from_user_id and theirs.user_id=new.to_user_id
      order by mine.conversation_id limit 1;
      if v_conversation is not null then
        v_destination := '/messages/' || v_conversation::text;
      end if;
      perform public.gayze_enqueue_notification(
        new.to_user_id,new.from_user_id,'gaze',new.id::text,v_destination
      );
    end if;
  end if;
  return new;
end $$;

commit;
