-- READ ONLY. An authorized operator must run against the intended project.
-- Does NOT inspect message bodies, push endpoints/keys or Vault secret values.
-- Does NOT apply any migration. Save output privately with the release evidence.

select table_name, column_name, data_type, is_nullable
from information_schema.columns
where table_schema = 'public' and table_name in (
  'messages', 'conversation_members', 'gazes', 'intents', 'push_subscriptions',
  'notification_preferences', 'notification_dispatch_log',
  'gayze_notifications', 'gayze_notification_deliveries'
)
order by table_name, ordinal_position;

select tablename, indexname, indexdef from pg_indexes
where schemaname = 'public' and tablename in (
  'messages', 'conversation_members', 'push_subscriptions',
  'gayze_notifications', 'gayze_notification_deliveries'
) order by tablename, indexname;

select c.relname, c.relrowsecurity, c.relforcerowsecurity
from pg_class c join pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'public' and c.relname in (
  'messages', 'conversation_members', 'gazes', 'intents', 'push_subscriptions',
  'notification_preferences', 'gayze_notifications', 'gayze_notification_deliveries'
);

select tablename, policyname, roles, cmd, qual, with_check
from pg_policies where schemaname = 'public' and tablename in (
  'messages', 'conversation_members', 'gazes', 'intents', 'push_subscriptions',
  'notification_preferences', 'gayze_notifications', 'gayze_notification_deliveries'
) order by tablename, policyname;

select c.relname, t.tgname, p.proname, t.tgenabled
from pg_trigger t join pg_class c on c.oid = t.tgrelid
join pg_proc p on p.oid = t.tgfoid join pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'public' and not t.tgisinternal
  and c.relname in ('messages','gazes','gayze_notifications');

select p.oid::regprocedure as signature, p.prosecdef, p.proconfig,
  obj_description(p.oid, 'pg_proc') as ownership_marker,
  has_function_privilege('anon', p.oid, 'execute') as anon_execute,
  has_function_privilege('authenticated', p.oid, 'execute') as authenticated_execute,
  has_function_privilege('service_role', p.oid, 'execute') as service_execute
from pg_proc p join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public' and (
  p.proname like 'gayze_%notification%' or p.proname in (
    'request_push_dispatch','on_message_notify_push','get_my_conversations',
    'sweep_expiring_intents','sweep_expired_safety_checkins'
  )
) order by p.proname;

select pubname, schemaname, tablename from pg_publication_tables
where pubname = 'supabase_realtime' and schemaname = 'public'
  and tablename in ('messages','gayze_notifications');

-- Separately obtain the migration ledger using the operator's Supabase CLI.
-- EXPLAIN (ANALYZE, BUFFERS) the actual first-page/keyset/read-count queries
-- under representative authenticated RLS, not merely a service-role bypass.
-- Review cron/job DEFINITIONS privately: they may embed credentials. Do not
-- paste cron commands, function bodies or Vault output into a public report.
