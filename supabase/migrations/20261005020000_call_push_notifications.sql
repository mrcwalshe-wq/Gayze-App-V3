-- Durable Web Push notifications for incoming and missed calls.
-- This is additive to the existing durable notification pipeline.

alter table public.gayze_notifications
  drop constraint if exists gayze_notifications_category_check;

alter table public.gayze_notifications
  add constraint gayze_notifications_category_check
  check (category in ('message','gaze','connection','intent_expiring','safety','test','call','missed_call'));

create or replace function public.gayze_call_notification(
  p_conversation uuid,
  p_recipient uuid,
  p_call_id uuid,
  p_call_type text,
  p_category text default 'call'
)
returns uuid
language plpgsql
security definer
set search_path=public,pg_temp
as $$
declare
  v_actor uuid := auth.uid();
  v_id uuid;
begin
  if v_actor is null then raise exception 'Sign in required'; end if;
  if p_category not in ('call','missed_call') then raise exception 'Invalid call notification category'; end if;
  if p_call_type not in ('audio','video') then raise exception 'Invalid call type'; end if;
  if p_recipient is null or p_recipient = v_actor then raise exception 'Invalid call recipient'; end if;
  if not exists (
    select 1 from public.conversation_members
    where conversation_id=p_conversation and user_id=v_actor
  ) then raise exception 'Caller is not a conversation member'; end if;
  if not exists (
    select 1 from public.conversation_members
    where conversation_id=p_conversation and user_id=p_recipient
  ) then raise exception 'Recipient is not a conversation member'; end if;

  v_id := public.gayze_enqueue_notification(
    p_recipient,
    v_actor,
    p_category,
    p_call_id::text,
    '/messages/' || p_conversation::text
  );
  return v_id;
end;
$$;

revoke all on function public.gayze_call_notification(uuid,uuid,uuid,text,text) from public,anon;
grant execute on function public.gayze_call_notification(uuid,uuid,uuid,text,text) to authenticated;
