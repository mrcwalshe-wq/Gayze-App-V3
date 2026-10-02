-- Additive, pending operator review/application. NOT applied by the coding agent.
-- Demonstrated gap: existing push ledger is service-only and is not an inbox.
-- Required base schema is derived from current client writes; fail closed instead
-- of silently installing a partial message/Gayze pipeline. Run transactionally.
do $$ begin
  if not public.gayze_push_has_columns('messages', array['id','conversation_id','sender_id'])
     or not public.gayze_push_has_columns('conversation_members', array['conversation_id','user_id'])
     or not public.gayze_push_has_columns('gazes', array['from_user_id','to_user_id','intent_id'])
     or not public.gayze_push_has_columns('intents', array['id','user_id']) then
    raise exception 'Notification prerequisites missing: inspect live messages/membership/gazes schema before applying';
  end if;
  if exists(select 1 from pg_trigger where tgrelid='public.messages'::regclass and tgname='messages_notify_push'
      and tgfoid<>'public.on_message_notify_push()'::regprocedure) then
    raise exception 'Refusing to replace an unowned message notification trigger';
  end if;
  if coalesce(obj_description('public.request_push_dispatch(jsonb)'::regprocedure,'pg_proc'),'') not like 'gayze-push:%' then
    raise exception 'Refusing to replace an unowned push bridge';
  end if;
end $$;

-- CREATE (not IF NOT EXISTS) deliberately rejects collisions with unknown tables.
create table public.gayze_notifications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  actor_id uuid references auth.users(id) on delete set null,
  category text not null check (category in ('message','gaze','connection','intent_expiring','safety','test')),
  event_key text not null,
  url text not null check (url like '/%' and url not like '//%'),
  created_at timestamptz not null default now(),
  read_at timestamptz,
  push_processed_at timestamptz,
  unique(user_id,category,event_key)
);
comment on table public.gayze_notifications is 'gayze-push: durable recipient inbox independent of push delivery';
create index gayze_notifications_inbox on public.gayze_notifications(user_id,created_at desc,id);
-- Both authoritative unread counts filter user_id/read_at; message count also category.
create index gayze_notifications_unread on public.gayze_notifications(user_id,category) where read_at is null;
create index gayze_notifications_pending on public.gayze_notifications(created_at) where push_processed_at is null;
alter table public.gayze_notifications enable row level security;
alter table public.gayze_notifications force row level security;
create policy gayze_notifications_own on public.gayze_notifications for select to authenticated using(user_id=(select auth.uid()));
revoke all on public.gayze_notifications from anon, authenticated;
grant select on public.gayze_notifications to authenticated;
grant all on public.gayze_notifications to service_role;

-- A claim is irreversible. Never automatically resend an ambiguous provider
-- request: an ACK may have been lost after acceptance. Inbox remains available.
create table public.gayze_notification_deliveries (
  notification_id uuid not null references public.gayze_notifications(id) on delete cascade,
  endpoint text not null,
  state text not null default 'attempted' check(state in ('attempted','accepted','failed','expired','invalid','unknown')),
  status_code integer,
  created_at timestamptz not null default now(),
  primary key(notification_id,endpoint)
);
alter table public.gayze_notification_deliveries enable row level security;
alter table public.gayze_notification_deliveries force row level security;
revoke all on public.gayze_notification_deliveries from anon,authenticated;
grant all on public.gayze_notification_deliveries to service_role;
comment on table public.gayze_notification_deliveries is 'gayze-push: service-only per-endpoint delivery claims; no ambiguous retries';

create function public.gayze_enqueue_notification(p_user uuid,p_actor uuid,p_category text,p_key text,p_url text)
returns uuid language plpgsql security definer set search_path=public,pg_temp as $$
declare v_id uuid;
begin
  insert into public.gayze_notifications(user_id,actor_id,category,event_key,url)
    values(p_user,p_actor,p_category,p_key,p_url) on conflict(user_id,category,event_key) do nothing returning id into v_id;
  if v_id is null then select id into v_id from public.gayze_notifications
    where user_id=p_user and category=p_category and event_key=p_key; end if;
  return v_id;
end $$;
revoke all on function public.gayze_enqueue_notification(uuid,uuid,text,text,text) from public,anon,authenticated;
grant execute on function public.gayze_enqueue_notification(uuid,uuid,text,text,text) to service_role;

create function public.gayze_mark_notification_read(p_id uuid default null,p_conversation uuid default null)
returns void language plpgsql security definer set search_path=public,pg_temp as $$ begin
  if auth.uid() is null then raise exception 'Sign in required'; end if;
  update public.gayze_notifications set read_at=now()
   where user_id=auth.uid() and read_at is null
     and (id=p_id or (category='message' and url='/messages/'||p_conversation::text));
end $$;
revoke all on function public.gayze_mark_notification_read(uuid,uuid) from public,anon;
grant execute on function public.gayze_mark_notification_read(uuid,uuid) to authenticated;

-- Recheck authorization/lifetime just before delivery, not only at INSERT.
create function public.gayze_notification_push_allowed(p_id uuid)
returns boolean language sql security definer set search_path=public,pg_temp as $$
  select exists(select 1 from public.gayze_notifications n where n.id=p_id and n.read_at is null and
    (n.category<>'message' or exists(
      select 1 from public.messages m join public.conversation_members c on c.conversation_id=m.conversation_id
      where m.id::text=n.event_key and c.user_id=n.user_id
        and to_jsonb(m)->>'burned_at' is null
        and ((to_jsonb(m)->>'expires_at') is null or (to_jsonb(m)->>'expires_at')::timestamptz>now())
    )))
$$;
revoke all on function public.gayze_notification_push_allowed(uuid) from public,anon,authenticated;
grant execute on function public.gayze_notification_push_allowed(uuid) to service_role;

create function public.gayze_claim_notification_delivery(p_id uuid,p_subscription uuid)
returns boolean language plpgsql security definer set search_path=public,pg_temp as $$
declare v_rows integer;
begin
  insert into public.gayze_notification_deliveries(notification_id,endpoint)
  select n.id,s.endpoint from public.gayze_notifications n join public.push_subscriptions s on s.user_id=n.user_id
    where n.id=p_id and s.id=p_subscription and public.gayze_notification_push_allowed(n.id)
  on conflict do nothing;
  get diagnostics v_rows = row_count;
  return v_rows=1;
end $$;
revoke all on function public.gayze_claim_notification_delivery(uuid,uuid) from public,anon,authenticated;
grant execute on function public.gayze_claim_notification_delivery(uuid,uuid) to service_role;

create function public.gayze_notification_http_dispatch(p_payload jsonb)
returns void
language plpgsql
security definer
set search_path = public, extensions, pg_temp
as $$
declare
  v_url      text;
  v_secret   text;
  v_base     text;
  v_endpoint text;
begin
  begin
    select decrypted_secret into v_url
      from vault.decrypted_secrets where name = 'gayze_functions_url';
    select decrypted_secret into v_secret
      from vault.decrypted_secrets where name = 'gayze_push_dispatch_secret';
  exception when others then
    raise warning '[GAYZE] push dispatch secrets unavailable';
    return;
  end;

  if v_url is null or v_secret is null then
    raise warning '[GAYZE] push dispatch not configured; skipping';
    return;
  end if;

  -- Normalise: the endpoint must always resolve to <base>/functions/v1/send-push
  -- (or <base>/send-push when the base already includes /functions/v1). Never
  -- <base>/send-push on a bare project/functions host.
  v_base := rtrim(v_url, '/');
  if v_base !~ '^https://[a-zA-Z0-9.-]+(:443)?(/functions/v1)?$' then
    raise warning '[GAYZE] push dispatch requires a valid HTTPS functions base';
    return;
  end if;
  if v_base like '%/functions/v1' then
    v_endpoint := v_base || '/send-push';
  else
    v_endpoint := v_base || '/functions/v1/send-push';
  end if;

  perform net.http_post(
    url     := v_endpoint,
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-gayze-dispatch-secret', v_secret
    ),
    body    := p_payload,
    timeout_milliseconds := 5000
  );
exception when others then
  -- Push must never break the originating write.
  raise warning '[GAYZE] push dispatch failed; notification retained';
end;
$$;

comment on function public.gayze_notification_http_dispatch(jsonb) is
  'gayze-push: pg_net bridge to the send-push Edge Function (URL-normalised, never raises).';

revoke all on function public.gayze_notification_http_dispatch(jsonb) from public, anon, authenticated;

-- Preserve the legacy sweep event contract, but persist BEFORE requesting HTTP.
-- Payload recipient/content is not trusted: derive it from existing DB rows.
create or replace function public.request_push_dispatch(p_payload jsonb)
returns void language plpgsql security definer set search_path=public,pg_temp as $$
declare r record;
begin
  if p_payload->>'event'='message' then
    for r in select distinct m.id,m.sender_id,m.conversation_id,c.user_id
      from public.messages m join public.conversation_members c on c.conversation_id=m.conversation_id
      where m.id=(p_payload->>'messageId')::uuid and c.user_id<>m.sender_id
      and exists(select 1 from public.conversation_members s where s.conversation_id=m.conversation_id and s.user_id=m.sender_id)
    loop
      perform public.gayze_enqueue_notification(r.user_id,r.sender_id,'message',r.id::text,'/messages/'||r.conversation_id::text);
    end loop;
  elsif p_payload->>'event'='intent_expiring' then
    for r in select id,user_id from public.intents where id=(p_payload->>'intentId')::uuid
      and is_paused is not true and expires_at>now() and expires_at<=now()+interval '15 minutes'
    loop perform public.gayze_enqueue_notification(r.user_id,null,'intent_expiring',r.id::text,'/profile'); end loop;
  elsif p_payload->>'event'='safety' then
    for r in select id,user_id from public.safety_checkins where user_id=(p_payload->>'toUserId')::uuid
      and status='active' and expires_at<=now() and expires_at>now()-interval '1 hour'
    loop perform public.gayze_enqueue_notification(r.user_id,null,'safety',r.id::text,'/profile'); end loop;
  end if;
end $$;
comment on function public.request_push_dispatch(jsonb) is 'gayze-push: durable legacy event bridge; HTTP isolated after notification INSERT';
revoke all on function public.request_push_dispatch(jsonb) from public,anon,authenticated;

create function public.gayze_notification_dispatch_insert()
returns trigger language plpgsql security definer set search_path=public,pg_temp as $$ begin
  -- The owned HTTP bridge catches pg_net/config failures. Notification persists.
  perform public.gayze_notification_http_dispatch(jsonb_build_object('notificationId',new.id));
  return new;
end $$;
create trigger gayze_notification_dispatch after insert on public.gayze_notifications
for each row execute function public.gayze_notification_dispatch_insert();

create function public.gayze_capture_notification()
returns trigger language plpgsql security definer set search_path=public,pg_temp as $$ begin
  -- Defence in depth if a legacy base-table policy accidentally permits anon.
  -- PostgREST's role setting remains the invoker's role in SECURITY DEFINER.
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
    if new.intent_id is not null then
      if not exists(select 1 from public.intents where id=new.intent_id and user_id=new.to_user_id) then
        raise exception 'Gaze intent recipient mismatch';
      end if;
    end if;
    if new.from_user_id<>new.to_user_id then
      perform public.gayze_enqueue_notification(new.to_user_id,new.from_user_id,'gaze',
        new.from_user_id::text||':'||new.to_user_id::text||':'||coalesce(new.intent_id::text,''),'/notifications');
    end if;
  end if;
  return new;
end $$;
drop trigger if exists messages_notify_push on public.messages;
create trigger messages_notify_push after insert on public.messages for each row execute function public.gayze_capture_notification();
create trigger gayze_gaze_notification after insert on public.gazes for each row execute function public.gayze_capture_notification();

create function public.gayze_connection_notification(p_conversation uuid)
returns uuid language plpgsql security definer set search_path=public,pg_temp as $$
declare v_peer uuid;
begin
  if auth.uid() is null or not exists(select 1 from public.conversation_members where conversation_id=p_conversation and user_id=auth.uid()) then
    raise exception 'Not a conversation member';
  end if;
  if (select count(distinct user_id) from public.conversation_members where conversation_id=p_conversation)<>2 then
    raise exception 'Connection must have two members';
  end if;
  select user_id into v_peer from public.conversation_members where conversation_id=p_conversation and user_id<>auth.uid() limit 1;
  return public.gayze_enqueue_notification(v_peer,auth.uid(),'connection',p_conversation::text,'/messages/'||p_conversation::text);
end $$;
revoke all on function public.gayze_connection_notification(uuid) from public,anon;
grant execute on function public.gayze_connection_notification(uuid) to authenticated;

-- Cron recovery for failed/missing pg_net dispatch. Sender claims each endpoint
-- once; repeated calls do not resend already attempted pushes. No credentials here.
create function public.gayze_drain_notifications()
returns void language plpgsql security definer set search_path=public,pg_temp as $$
declare r record;
begin
  for r in select id from public.gayze_notifications where push_processed_at is null and read_at is null
    and created_at>now()-interval '24 hours' order by created_at limit 100
  loop perform public.gayze_notification_http_dispatch(jsonb_build_object('notificationId',r.id)); end loop;
end $$;
revoke all on function public.gayze_drain_notifications() from public,anon,authenticated;
grant execute on function public.gayze_drain_notifications() to service_role;
revoke all on function public.gayze_capture_notification(), public.gayze_notification_dispatch_insert() from public,anon,authenticated;

-- Polling remains the fallback when the publication is managed externally.
do $$ begin
  if exists(select 1 from pg_publication where pubname='supabase_realtime') then
    alter publication supabase_realtime add table public.gayze_notifications;
  end if;
end $$;
