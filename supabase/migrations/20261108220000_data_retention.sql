-- Data retention: delete what the privacy policy says we do not keep. Nothing here runs by itself.
--   select * from public.gayze_run_retention(false);   -- count only: what WOULD be deleted
--   select * from public.gayze_run_retention(true);    -- delete
-- Scheduling is a separate, deliberate step (see docs/legal/RETENTION.md).

-- Files cannot be deleted from SQL: paths are queued here and a server function removes them from storage.
create table if not exists public.storage_purge_queue (
  id bigserial primary key,
  bucket text not null,
  path text not null,
  queued_at timestamptz not null default now()
);
alter table public.storage_purge_queue enable row level security;
revoke all on public.storage_purge_queue from anon, authenticated;

-- Reports can be kept longer when a legal claim or serious harm needs them.
alter table public.reports add column if not exists legal_hold boolean not null default false;

create or replace function public.gayze_run_retention(p_apply boolean default false)
returns table (step text, affected bigint)
language plpgsql set search_path = public, pg_temp as $$
declare n bigint;
begin
  -- Intents: the position goes 24 h after expiry, the record 30 days after.
  select count(*) into n from public.intents where location is not null and expires_at < now() - interval '24 hours';
  if p_apply then update public.intents set location = null where location is not null and expires_at < now() - interval '24 hours'; end if;
  step := 'intent positions removed (24 h after expiry)'; affected := n; return next;

  select count(*) into n from public.intents where expires_at < now() - interval '30 days';
  if p_apply then delete from public.intents where expires_at < now() - interval '30 days'; end if;
  step := 'intents deleted (30 days after expiry)'; affected := n; return next;

  select count(*) into n from public.stories where expires_at < now() - interval '7 days';
  if p_apply then delete from public.stories where expires_at < now() - interval '7 days'; end if;
  step := 'stories deleted (7 days after expiry)'; affected := n; return next;

  select count(*) into n from public.gayze_notifications where read_at < now() - interval '30 days' or created_at < now() - interval '90 days';
  if p_apply then delete from public.gayze_notifications where read_at < now() - interval '30 days' or created_at < now() - interval '90 days'; end if;
  step := 'notifications deleted (30 days after read, 90 days at most)'; affected := n; return next;

  select count(*) into n from public.messages where expires_at < now() - interval '7 days' or burned_at < now() - interval '7 days';
  if p_apply then delete from public.messages where expires_at < now() - interval '7 days' or burned_at < now() - interval '7 days'; end if;
  step := 'expired or burned messages deleted (7 days after)'; affected := n; return next;

  select count(*) into n from public.scheduled_messages where coalesce(sent_at, cancelled_at) < now() - interval '7 days';
  if p_apply then delete from public.scheduled_messages where coalesce(sent_at, cancelled_at) < now() - interval '7 days'; end if;
  step := 'sent or cancelled scheduled messages deleted (7 days after)'; affected := n; return next;

  select count(*) into n from public.call_sessions where created_at < now() - interval '30 days';
  if p_apply then delete from public.call_sessions where created_at < now() - interval '30 days'; end if;
  step := 'call records deleted (30 days)'; affected := n; return next;

  select count(*) into n from public.safety_checkins where coalesce(ended_at, expires_at) < now() - interval '7 days';
  if p_apply then delete from public.safety_checkins where coalesce(ended_at, expires_at) < now() - interval '7 days'; end if;
  step := 'safety timer entries deleted (7 days after they end)'; affected := n; return next;

  select count(*) into n from public.push_subscriptions where coalesce(last_used_at, updated_at, created_at) < now() - interval '90 days';
  if p_apply then delete from public.push_subscriptions where coalesce(last_used_at, updated_at, created_at) < now() - interval '90 days'; end if;
  step := 'push subscriptions deleted (90 days unused)'; affected := n; return next;

  select count(*) into n from public.gazes where created_at < now() - interval '90 days';
  if p_apply then delete from public.gazes where created_at < now() - interval '90 days'; end if;
  step := 'gaze records deleted (90 days)'; affected := n; return next;

  select count(*) into n from public.interests where status = 'pending' and created_at < now() - interval '90 days';
  if p_apply then delete from public.interests where status = 'pending' and created_at < now() - interval '90 days'; end if;
  step := 'unanswered requests deleted (90 days)'; affected := n; return next;

  -- Event pictures go 30 days after the event; the file is queued for removal from storage.
  select count(*) into n from public.gatherings where photo_path is not null and scheduled_at < now() - interval '30 days';
  if p_apply then
    insert into public.storage_purge_queue (bucket, path) select 'event-photos', photo_path from public.gatherings where photo_path is not null and scheduled_at < now() - interval '30 days';
    update public.gatherings set photo_path = null where photo_path is not null and scheduled_at < now() - interval '30 days';
  end if;
  step := 'event pictures queued for deletion (30 days after the event)'; affected := n; return next;

  -- Quick plans 30 days after they start, events 6 months after. Their group chats (and messages) go with them.
  select count(*) into n from public.conversations c where c.id in (select g.conversation_id from public.gatherings g where g.conversation_id is not null
    and ((g.tags ? 'quick' and g.scheduled_at < now() - interval '30 days') or g.scheduled_at < now() - interval '6 months'));
  if p_apply then
    delete from public.conversations c where c.id in (select g.conversation_id from public.gatherings g where g.conversation_id is not null
      and ((g.tags ? 'quick' and g.scheduled_at < now() - interval '30 days') or g.scheduled_at < now() - interval '6 months'));
  end if;
  step := 'event and quick-plan group chats deleted'; affected := n; return next;

  select count(*) into n from public.gatherings where (tags ? 'quick' and scheduled_at < now() - interval '30 days') or scheduled_at < now() - interval '6 months';
  if p_apply then
    insert into public.storage_purge_queue (bucket, path) select 'event-photos', photo_path from public.gatherings where photo_path is not null
      and ((tags ? 'quick' and scheduled_at < now() - interval '30 days') or scheduled_at < now() - interval '6 months');
    delete from public.gatherings where (tags ? 'quick' and scheduled_at < now() - interval '30 days') or scheduled_at < now() - interval '6 months';
  end if;
  step := 'quick plans (30 days) and events (6 months) deleted, with requests'; affected := n; return next;

  -- Conversations nobody is in any more, 30 days after the last activity.
  select count(*) into n from public.conversations c where not exists (select 1 from public.conversation_members m where m.conversation_id = c.id) and c.updated_at < now() - interval '30 days';
  if p_apply then delete from public.conversations c where not exists (select 1 from public.conversation_members m where m.conversation_id = c.id) and c.updated_at < now() - interval '30 days'; end if;
  step := 'empty conversations deleted (30 days after both left)'; affected := n; return next;

  select count(*) into n from public.reports where created_at < now() - interval '2 years' and not legal_hold;
  if p_apply then delete from public.reports where created_at < now() - interval '2 years' and not legal_hold; end if;
  step := 'reports deleted (2 years, unless on legal hold)'; affected := n; return next;

  select count(*) into n from public.admin_audit_log where created_at < now() - interval '2 years';
  if p_apply then delete from public.admin_audit_log where created_at < now() - interval '2 years'; end if;
  step := 'admin action log deleted (2 years)'; affected := n; return next;
end $$;
revoke all on function public.gayze_run_retention(boolean) from public, anon, authenticated;
