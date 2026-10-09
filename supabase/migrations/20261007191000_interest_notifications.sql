-- Intent-aware interest notifications.
-- Pending interest -> recipient notification.
-- Mutual interest -> connection notification for both parties.
-- The source RPC remains authoritative for matching/conversation creation.

alter table public.interests
  add column if not exists intent_id uuid references public.intents(id) on delete set null;

create index if not exists interests_to_user_status_created_idx
  on public.interests(to_user_id,status,created_at desc);

alter table public.gayze_notifications
  drop constraint if exists gayze_notifications_category_check;

alter table public.gayze_notifications
  add constraint gayze_notifications_category_check
  check (category in ('message','gaze','interest','connection','intent_expiring','safety','test','call','missed_call'));

create or replace function public.submit_interest(p_to_user uuid, p_intent_id uuid default null)
returns jsonb
language plpgsql
security definer
set search_path=public,private
as $$
declare
  uid uuid := (select auth.uid());
  mutual boolean := false;
  conversation_id uuid;
begin
  if uid is null then raise exception 'not authenticated'; end if;
  if uid = p_to_user then raise exception 'cannot interest yourself'; end if;
  if not exists (select 1 from public.profiles where id=p_to_user) then raise exception 'target user not found'; end if;

  if p_intent_id is not null and not exists (
    select 1 from public.intents
    where id=p_intent_id
      and user_id=p_to_user
      and is_paused is not true
      and expires_at>now()
  ) then
    raise exception 'intent is no longer active';
  end if;

  insert into public.interests(from_user_id,to_user_id,intent_id,status)
  values(uid,p_to_user,p_intent_id,'pending')
  on conflict (from_user_id,to_user_id)
  do update set intent_id=excluded.intent_id,status='pending',created_at=now();

  select exists(
    select 1 from public.interests
    where from_user_id=p_to_user
      and to_user_id=uid
      and status in ('pending','mutual')
  ) into mutual;

  if mutual then
    update public.interests set status='mutual'
    where (from_user_id=uid and to_user_id=p_to_user)
       or (from_user_id=p_to_user and to_user_id=uid);

    select cm.conversation_id into conversation_id
    from public.conversation_members cm
    join public.conversation_members cm2
      on cm2.conversation_id=cm.conversation_id
     and cm2.user_id=p_to_user
    where cm.user_id=uid
    limit 1;

    if conversation_id is null then
      insert into public.conversations default values returning id into conversation_id;
      insert into public.conversation_members(conversation_id,user_id)
      values(conversation_id,uid),(conversation_id,p_to_user);
    end if;
  end if;

  return jsonb_build_object('mutual',mutual,'conversation_id',conversation_id);
end;
$$;

revoke all on function public.submit_interest(uuid,uuid) from public,anon;
grant execute on function public.submit_interest(uuid,uuid) to authenticated;

create or replace function public.gayze_interest_notification()
returns trigger
language plpgsql
security definer
set search_path=public,pg_temp
as $$
begin
  if new.status='pending'
     and (tg_op='INSERT' or (tg_op='UPDATE' and old.status is distinct from new.status)) then
    perform public.gayze_enqueue_notification(
      new.to_user_id,
      new.from_user_id,
      'interest',
      new.id::text||':'||extract(epoch from new.created_at)::text,
      '/right-now?interest='||new.id::text
    );
  end if;

  if new.status='mutual'
     and (tg_op='INSERT' or (tg_op='UPDATE' and old.status is distinct from new.status)) then
    perform public.gayze_enqueue_notification(
      new.to_user_id,
      new.from_user_id,
      'connection',
      'interest:'||new.id::text,
      '/messages'
    );
    perform public.gayze_enqueue_notification(
      new.from_user_id,
      new.to_user_id,
      'connection',
      'interest:'||new.id::text,
      '/messages'
    );
  end if;

  return new;
end;
$$;

drop trigger if exists interests_notify_gayze on public.interests;
create trigger interests_notify_gayze
after insert or update of status on public.interests
for each row execute function public.gayze_interest_notification();

revoke all on function public.gayze_interest_notification() from public,anon,authenticated;
