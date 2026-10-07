-- GAYZE intent-interest request/response workflow
alter table public.interests
  add column if not exists intent_id uuid references public.intents(id) on delete set null,
  add column if not exists message text,
  add column if not exists shared_photo_ids uuid[] not null default '{}'::uuid[];

create index if not exists interests_intent_id_idx on public.interests(intent_id);
create index if not exists interests_to_status_idx on public.interests(to_user_id,status,created_at desc);

create or replace function public.submit_interest(
  p_to_user uuid,
  p_intent_id uuid default null,
  p_message text default null,
  p_shared_photo_ids uuid[] default '{}'::uuid[]
)
returns jsonb language plpgsql security definer set search_path=public,private
as $function$
declare uid uuid := auth.uid(); interest_id uuid; intent_owner uuid;
begin
  if uid is null then raise exception 'not authenticated'; end if;
  if uid = p_to_user then raise exception 'cannot interest yourself'; end if;
  if p_message is not null and length(trim(p_message)) > 500 then raise exception 'interest message too long'; end if;
  if coalesce(array_length(p_shared_photo_ids,1),0) > 6 then raise exception 'too many shared photos'; end if;
  if p_intent_id is not null then
    select user_id into intent_owner from public.intents where id=p_intent_id and not is_paused and expires_at > now();
    if intent_owner is distinct from p_to_user then raise exception 'intent is unavailable'; end if;
  end if;
  if exists (select 1 from unnest(coalesce(p_shared_photo_ids,'{}'::uuid[])) photo_id where not exists (select 1 from public.profile_photos pp where pp.id=photo_id and pp.user_id=uid)) then
    raise exception 'shared photo does not belong to sender';
  end if;
  insert into public.interests(from_user_id,to_user_id,intent_id,message,shared_photo_ids,status)
  values(uid,p_to_user,p_intent_id,nullif(trim(p_message),''),coalesce(p_shared_photo_ids,'{}'::uuid[]),'pending')
  on conflict (from_user_id,to_user_id) do update set intent_id=excluded.intent_id,message=excluded.message,shared_photo_ids=excluded.shared_photo_ids,status='pending',created_at=now()
  returning id into interest_id;
  return jsonb_build_object('sent',true,'interest_id',interest_id,'mutual',false,'conversation_id',null);
end;
$function$;

create or replace function public.accept_interest(p_interest_id uuid)
returns jsonb language plpgsql security definer set search_path=public,private
as $function$
declare uid uuid:=auth.uid(); v_from uuid; v_to uuid; v_conversation uuid;
begin
  if uid is null then raise exception 'not authenticated'; end if;
  select from_user_id,to_user_id into v_from,v_to from public.interests where id=p_interest_id and status='pending' for update;
  if v_from is null or v_to is null then raise exception 'interest is unavailable'; end if;
  if v_to<>uid then raise exception 'not authorized'; end if;
  update public.interests set status='mutual' where id=p_interest_id;
  select cm.conversation_id into v_conversation from public.conversation_members cm join public.conversation_members cm2 on cm2.conversation_id=cm.conversation_id where cm.user_id=uid and cm2.user_id=v_from limit 1;
  if v_conversation is null then
    insert into public.conversations default values returning id into v_conversation;
    insert into public.conversation_members(conversation_id,user_id) values(v_conversation,uid),(v_conversation,v_from);
  end if;
  perform public.gayze_connection_notification(v_conversation);
  return jsonb_build_object('accepted',true,'interest_id',p_interest_id,'conversation_id',v_conversation,'recipient_id',v_from);
end;
$function$;

create or replace function public.decline_interest(p_interest_id uuid)
returns jsonb language plpgsql security definer set search_path=public,private
as $function$
declare uid uuid:=auth.uid(); v_to uuid;
begin
  if uid is null then raise exception 'not authenticated'; end if;
  select to_user_id into v_to from public.interests where id=p_interest_id and status='pending' for update;
  if v_to is null then raise exception 'interest is unavailable'; end if;
  if v_to<>uid then raise exception 'not authorized'; end if;
  update public.interests set status='declined' where id=p_interest_id;
  return jsonb_build_object('declined',true,'interest_id',p_interest_id);
end;
$function$;

revoke all on function public.submit_interest(uuid,uuid,text,uuid[]) from public,anon;
grant execute on function public.submit_interest(uuid,uuid,text,uuid[]) to authenticated;
revoke all on function public.accept_interest(uuid) from public,anon;
grant execute on function public.accept_interest(uuid) to authenticated;
revoke all on function public.decline_interest(uuid) from public,anon;
grant execute on function public.decline_interest(uuid) to authenticated;

create or replace function public.gayze_can_view_shared_interest_photo(p_storage_path text)
returns boolean language sql security definer stable set search_path=public,pg_temp
as $$
  select exists (
    select 1 from public.profile_photos pp join public.interests i on pp.id=any(i.shared_photo_ids)
    where pp.storage_path=p_storage_path and i.to_user_id=auth.uid() and i.status='pending'
  );
$$;
revoke all on function public.gayze_can_view_shared_interest_photo(text) from public,anon;
grant execute on function public.gayze_can_view_shared_interest_photo(text) to authenticated;

drop policy if exists profile_photos_select_visible on public.profile_photos;
create policy profile_photos_select_visible on public.profile_photos for select to authenticated
using (gayze_can_view_profile_media(user_id::text) or gayze_can_view_shared_interest_photo(storage_path));

drop policy if exists profile_photos_objects_select on storage.objects;
create policy profile_photos_objects_select on storage.objects for select to authenticated
using (bucket_id='profile-photos' and (gayze_can_view_profile_media((storage.foldername(name))[1]) or gayze_can_view_shared_interest_photo(name)));

create or replace function public.gayze_interest_notification()
returns trigger language plpgsql security definer set search_path=public,pg_temp
as $function$
begin
  if new.status='pending' then
    perform public.gayze_enqueue_notification(new.to_user_id,new.from_user_id,'gaze',
      'interest:'||new.id::text||':'||coalesce(new.intent_id::text,'none'),
      '/notifications');
  end if;
  return new;
end;
$function$;

drop trigger if exists trg_gayze_interest_notification on public.interests;
create trigger trg_gayze_interest_notification after insert or update of status on public.interests
for each row execute function public.gayze_interest_notification();
