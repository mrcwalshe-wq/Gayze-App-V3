-- Sending a Gayze failed forever for two people whose chat had been deleted.
--
-- leave_conversation() removes a member from a conversation but leaves the two interests rows marked 'mutual'.
-- submit_interest() then found 'mutual' with no shared conversation and raised "accepted Gayze is missing its
-- conversation" on every attempt, which the app showed as "could not be sent, try again".
--
-- A 'mutual' connection with no shared conversation is stale: the chat was left or deleted. It is reset to
-- 'withdrawn' in both directions, and the new Gayze goes through as an ordinary pending request that the other
-- person can accept (accept_interest creates a fresh conversation). Pairs that still share a conversation behave
-- exactly as before.
create or replace function public.submit_interest(p_to_user uuid, p_intent_id uuid default null, p_message text default null, p_shared_photo_ids uuid[] default '{}'::uuid[])
returns jsonb
language plpgsql
security definer
set search_path to 'public', 'private'
as $function$
declare
  uid uuid := auth.uid();
  v_interest_id uuid;
  v_status text;
  v_intent_owner uuid;
  v_conversation uuid;
begin
  if uid is null then raise exception 'not authenticated'; end if;
  if p_to_user is null or uid=p_to_user then raise exception 'invalid recipient'; end if;
  if p_message is not null and length(trim(p_message))>500 then raise exception 'interest message too long'; end if;
  if coalesce(array_length(p_shared_photo_ids,1),0)>6 then raise exception 'too many shared photos'; end if;

  if p_intent_id is not null then
    select user_id into v_intent_owner
    from public.intents
    where id=p_intent_id and not is_paused and expires_at>now();
    if v_intent_owner is distinct from p_to_user then raise exception 'intent is unavailable'; end if;
  end if;

  if exists (
    select 1 from unnest(coalesce(p_shared_photo_ids,'{}'::uuid[])) photo_id
    where not exists(select 1 from public.profile_photos pp where pp.id=photo_id and pp.user_id=uid)
  ) then raise exception 'shared photo does not belong to sender'; end if;

  select id,status into v_interest_id,v_status
  from public.interests where from_user_id=uid and to_user_id=p_to_user for update;

  if v_status='mutual' then
    select mine.conversation_id into v_conversation
    from public.conversation_members mine
    join public.conversation_members theirs on theirs.conversation_id=mine.conversation_id
    where mine.user_id=uid and theirs.user_id=p_to_user
    order by mine.conversation_id limit 1;

    if v_conversation is null then
      -- The chat was left or deleted: the old connection is over. Reset both directions and start again.
      update public.interests set status='withdrawn'
      where status='mutual'
        and ((from_user_id=uid and to_user_id=p_to_user) or (from_user_id=p_to_user and to_user_id=uid));
      v_status := 'withdrawn';
    else
      insert into public.gazes(from_user_id,to_user_id,intent_id) values(uid,p_to_user,p_intent_id);
      return jsonb_build_object('sent',true,'interest_id',v_interest_id,'mutual',true,'conversation_id',v_conversation,'repeat',true);
    end if;
  end if;

  if v_status='pending' then
    return jsonb_build_object('sent',true,'interest_id',v_interest_id,'mutual',false,'conversation_id',null);
  end if;

  insert into public.interests(from_user_id,to_user_id,intent_id,message,shared_photo_ids,status)
  values(uid,p_to_user,p_intent_id,nullif(trim(p_message),''),coalesce(p_shared_photo_ids,'{}'::uuid[]),'pending')
  on conflict(from_user_id,to_user_id) do update
    set intent_id=excluded.intent_id,message=excluded.message,
        shared_photo_ids=excluded.shared_photo_ids,status='pending',created_at=now()
    where interests.status in ('declined','withdrawn')
  returning id into v_interest_id;

  if v_interest_id is null then
    select id,status into v_interest_id,v_status
    from public.interests where from_user_id=uid and to_user_id=p_to_user;
    if v_status='mutual' then
      select mine.conversation_id into v_conversation
      from public.conversation_members mine
      join public.conversation_members theirs on theirs.conversation_id=mine.conversation_id
      where mine.user_id=uid and theirs.user_id=p_to_user
      order by mine.conversation_id limit 1;
      if v_conversation is null then raise exception 'accepted Gayze is missing its conversation'; end if;
      insert into public.gazes(from_user_id,to_user_id,intent_id) values(uid,p_to_user,p_intent_id);
      return jsonb_build_object('sent',true,'interest_id',v_interest_id,'mutual',true,'conversation_id',v_conversation,'repeat',true);
    end if;
    if v_status='pending' then return jsonb_build_object('sent',true,'interest_id',v_interest_id,'mutual',false,'conversation_id',null); end if;
    raise exception 'Gayze request could not be created';
  end if;
  return jsonb_build_object('sent',true,'interest_id',v_interest_id,'mutual',false,'conversation_id',null);
end $function$;
