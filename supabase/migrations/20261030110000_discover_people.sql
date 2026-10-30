-- Stage 2: interest-based discovery of real people.
-- Returns only what a card needs. Never coordinates: distance is rounded up to whole kilometres, and is omitted for people
-- whose location privacy is "neighborhood". People who are ghosted, not discoverable, blocked or suspended never appear.

create or replace function public.discover_people(
  p_interests text[] default null,
  p_query text default null,
  p_radius_km integer default null,
  p_limit integer default 30,
  p_offset integer default 0
)
returns table (
  user_id uuid, display_name text, age smallint, bio text, avatar_path text, neighborhood text,
  interests text[], shared_interests text[], distance_km integer, presence text, has_conversation boolean, can_contact boolean
)
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare
  uid uuid := auth.uid();
  my_interests text[];
  my_loc geography;
  wanted text[];
  q text := nullif(btrim(coalesce(p_query, '')), '');
begin
  if uid is null then raise exception 'not authenticated'; end if;
  select coalesce(hobbies, '{}'), location into my_interests, my_loc from public.profiles where id = uid;
  wanted := coalesce(nullif((select array_agg(lower(btrim(i))) from unnest(coalesce(p_interests, '{}')) i where btrim(i) <> ''), '{}'), null);

  return query
  select p.id, p.display_name, p.age, left(p.bio, 160), p.avatar_path, p.neighborhood,
    coalesce(p.hobbies, '{}'),
    coalesce((select array_agg(h) from unnest(coalesce(p.hobbies, '{}')) h
              where lower(h) = any (coalesce(wanted, (select array_agg(lower(m)) from unnest(my_interests) m)))), '{}'),
    case when my_loc is not null and p.location is not null and p.privacy_setting <> 'neighborhood'
         then greatest(1, ceil(st_distance(my_loc, p.location) / 1000.0))::int end,
    case when pr.last_active_at is null or coalesce(ps.show_online_status, true) = false then 'offline'
         when pr.last_active_at > now() - interval '90 seconds' then pr.status
         when pr.last_active_at > now() - interval '10 minutes' then 'away'
         else 'offline' end,
    exists (select 1 from public.conversation_members a join public.conversation_members b on b.conversation_id = a.conversation_id
            where a.user_id = uid and b.user_id = p.id),
    (coalesce(ps.who_can_message, 'everyone') = 'everyone' or exists (
       select 1 from public.conversation_members a join public.conversation_members b on b.conversation_id = a.conversation_id
       where a.user_id = uid and b.user_id = p.id))
  from public.profiles p
  left join public.user_privacy_settings ps on ps.user_id = p.id
  left join public.user_presence pr on pr.user_id = p.id
  where p.id <> uid
    and p.privacy_setting <> 'ghost'
    and coalesce(ps.discoverable, true)
    and (p.age is null or p.age >= 18)
    and not public.gayze_is_blocked_between(p.id)
    and not exists (select 1 from public.account_restrictions r where r.user_id = p.id and r.status = 'suspended')
    and (wanted is null or exists (select 1 from unnest(coalesce(p.hobbies, '{}')) h where lower(h) = any (wanted)))
    and (q is null or p.display_name ilike '%' || q || '%' or p.handle ilike '%' || q || '%'
         or exists (select 1 from unnest(coalesce(p.hobbies, '{}')) h where h ilike '%' || q || '%'))
    and (p_radius_km is null or (my_loc is not null and p.location is not null and p.privacy_setting <> 'neighborhood'
         and st_dwithin(my_loc, p.location, p_radius_km * 1000.0)))
  order by cardinality(coalesce((select array_agg(h) from unnest(coalesce(p.hobbies, '{}')) h
              where lower(h) = any (coalesce(wanted, (select array_agg(lower(m)) from unnest(my_interests) m)))), '{}')) desc,
           pr.last_active_at desc nulls last, p.created_at desc
  limit greatest(1, least(coalesce(p_limit, 30), 60)) offset greatest(0, coalesce(p_offset, 0));
end $$;

revoke all on function public.discover_people(text[], text, integer, integer, integer) from public, anon;
grant execute on function public.discover_people(text[], text, integer, integer, integer) to authenticated;

-- Enforce "only connections can message me" on the first contact path.
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

  -- Someone who only accepts messages from connections can't be contacted first by a stranger.
  if coalesce((select who_can_message from public.user_privacy_settings where user_id=p_to_user),'everyone')='connections'
     and not exists (select 1 from public.conversation_members a join public.conversation_members b on b.conversation_id=a.conversation_id where a.user_id=uid and b.user_id=p_to_user) then
    raise exception 'CONTACT_RESTRICTED';
  end if;

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

  -- Reactivate a declined/withdrawn interest with an explicit UPDATE; an INSERT .. ON CONFLICT DO UPDATE fires the
  -- send-cooldown trigger twice (BEFORE INSERT, then BEFORE UPDATE) and the second pass always trips GAYZE_COOLDOWN.
  if v_status in ('declined','withdrawn') then
    update public.interests
    set intent_id=p_intent_id,message=nullif(trim(p_message),''),
        shared_photo_ids=coalesce(p_shared_photo_ids,'{}'::uuid[]),status='pending',created_at=now()
    where id=v_interest_id and status in ('declined','withdrawn')
    returning id into v_interest_id;
  else
    insert into public.interests(from_user_id,to_user_id,intent_id,message,shared_photo_ids,status)
    values(uid,p_to_user,p_intent_id,nullif(trim(p_message),''),coalesce(p_shared_photo_ids,'{}'::uuid[]),'pending')
    on conflict(from_user_id,to_user_id) do nothing
    returning id into v_interest_id;
  end if;

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
