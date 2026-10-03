-- READ-ONLY OPERATOR CHECK. Not executed against any project by the agent.
-- Run alongside scripts/release-candidate/preflight.sql on the intended database.
-- No migrations, scheduling, HTTP requests, notification sends or secret output.
-- Missing objects are reported, not created. Do NOT paste private function/job
-- definitions, Vault values, endpoints, p256dh/auth keys or pg_net bodies in chat.
begin transaction read only;

select current_database() as database_name, current_user as checking_role;
select extname, extversion from pg_extension
where extname in ('pgcrypto','pg_net','pg_cron','supabase_vault') order by extname;

-- A missing row is NOT equivalent to an applied migration with identical DDL.
do $$ declare item record; begin
  if to_regclass('supabase_migrations.schema_migrations') is null then
    raise notice 'MIGRATION LEDGER unavailable: review application history privately';
  else
    for item in execute $q$select version::text as version from supabase_migrations.schema_migrations
      where version::text in ('20260929120000','20261002090000','20261002100000') order by version$q$
    loop raise notice 'PUSH MIGRATION present: %', item.version; end loop;
  end if;
end $$;

-- Values never leave the DB. This cannot check equality with the Edge Function
-- secret: that cross-store check must be performed privately by the operator.
do $$ declare n integer; nonempty boolean; shape boolean; begin
  if to_regclass('vault.decrypted_secrets') is null then
    raise notice 'VAULT unavailable: required names are gayze_functions_url and gayze_push_dispatch_secret';
  else
    execute $q$select count(*),coalesce(bool_and(length(btrim(decrypted_secret))>0),false),
      coalesce(bool_and(rtrim(decrypted_secret,'/') ~ '^https://[a-zA-Z0-9.-]+(:443)?(/functions/v1)?$'),false)
      from vault.decrypted_secrets where name='gayze_functions_url'$q$ into n,nonempty,shape;
    raise notice 'FUNCTIONS BASE: count=%, nonempty=%, HTTPS-base-shape=% (operator must confirm intended project)', n,nonempty,shape;
    execute $q$select count(*),coalesce(bool_and(length(decrypted_secret) between 32 and 512),false)
      from vault.decrypted_secrets where name='gayze_push_dispatch_secret'$q$ into n,nonempty;
    raise notice 'DISPATCH SECRET: count=%, recommended-length-valid=% (equality with Edge secret NOT checked)', n,nonempty;
  end if;
end $$;

select table_name,column_name,data_type from information_schema.columns
where table_schema='public' and table_name='safety_checkins'
  and column_name in ('id','user_id','status','expires_at') order by column_name;

-- Effective table privileges, in addition to the RLS/policy checks in preflight.sql.
select c.relname,
  has_table_privilege('authenticated',c.oid,'SELECT') as authenticated_select,
  has_table_privilege('authenticated',c.oid,'INSERT') as authenticated_insert,
  has_table_privilege('authenticated',c.oid,'UPDATE') as authenticated_update,
  has_table_privilege('authenticated',c.oid,'DELETE') as authenticated_delete,
  has_table_privilege('service_role',c.oid,'SELECT') as service_select,
  has_table_privilege('service_role',c.oid,'INSERT') as service_insert,
  has_table_privilege('service_role',c.oid,'UPDATE') as service_update,
  has_table_privilege('service_role',c.oid,'DELETE') as service_delete
from pg_class c join pg_namespace n on n.oid=c.relnamespace
where n.nspname='public' and c.relname in
  ('push_subscriptions','notification_preferences','notification_dispatch_log','gayze_notifications','gayze_notification_deliveries');

-- No command text is emitted: unknown existing jobs may contain credentials.
do $$ declare item record; begin
  if to_regclass('cron.job') is null then
    raise notice 'CRON unavailable: no production schedules verified';
  else
    for item in execute $q$select w.jobname,j.schedule,coalesce(j.active,false) as active,j.username,(j.jobid is not null) as present,
      case w.jobname
        when 'gayze-notification-drain' then regexp_replace(lower(command),'\s','','g')='selectpublic.gayze_drain_notifications();'
          or regexp_replace(lower(command),'\s','','g')='selectpublic.gayze_drain_notifications()'
        when 'gayze-intent-expiry' then regexp_replace(lower(command),'\s','','g')='selectpublic.sweep_expiring_intents();'
          or regexp_replace(lower(command),'\s','','g')='selectpublic.sweep_expiring_intents()'
        when 'gayze-safety-expiry' then regexp_replace(lower(command),'\s','','g')='selectpublic.sweep_expired_safety_checkins();'
          or regexp_replace(lower(command),'\s','','g')='selectpublic.sweep_expired_safety_checkins()'
      end as expected_command
      from (values ('gayze-notification-drain'),('gayze-intent-expiry'),('gayze-safety-expiry')) w(jobname)
      left join cron.job j on j.jobname=w.jobname$q$
    loop raise notice 'PUSH JOB: name=%, present=%, schedule=%, active=%, execution-role=%, expected-command=%',
      item.jobname,item.present,item.schedule,item.active,item.username,item.expected_command; end loop;
    -- Counts only: inspect unmatched jobs PRIVATELY to rule out a legacy sender
    -- or an equivalent differently named schedule. Do not create duplicate jobs.
    for item in execute $q$select count(*) as other_jobs from cron.job
      where jobname not in ('gayze-notification-drain','gayze-intent-expiry','gayze-safety-expiry') or jobname is null$q$
    loop raise notice 'Other cron jobs requiring private review: %', item.other_jobs; end loop;
  end if;
  if to_regclass('cron.job_run_details') is not null then
    for item in execute $q$select j.jobname,r.status,count(*) as runs,max(r.start_time) as last_start
      from cron.job_run_details r join cron.job j on j.jobid=r.jobid
      where j.jobname in ('gayze-notification-drain','gayze-intent-expiry','gayze-safety-expiry')
        and r.start_time>now()-interval '24 hours'
      group by j.jobname,r.status$q$
    loop raise notice 'PUSH JOB RUNS: name=%, status=%, runs=%, last-start=%',item.jobname,item.status,item.runs,item.last_start; end loop;
  end if;
end $$;

-- Counts only, no notification IDs, message content or subscription credentials.
do $$ declare item record; begin
  if to_regclass('public.gayze_notifications') is not null then
    for item in execute $q$select category,
      count(*) filter(where push_processed_at is null and read_at is null and created_at>now()-interval '24 hours') as pending_eligible_age,
      count(*) filter(where push_processed_at is null and read_at is null and created_at<=now()-interval '24 hours') as outside_drain_window
      from public.gayze_notifications group by category$q$
    loop raise notice 'INBOX: category=%, pending-within-drain-age=%, outside-drain-age=%',
      item.category,item.pending_eligible_age,item.outside_drain_window; end loop;
  end if;
  if to_regclass('public.gayze_notification_deliveries') is not null then
    for item in execute $q$select state,status_code,count(*) as attempts from public.gayze_notification_deliveries
      where created_at>now()-interval '24 hours' group by state,status_code$q$
    loop raise notice 'DELIVERY: state=%, provider-status=%, count=%',item.state,item.status_code,item.attempts; end loop;
  end if;
end $$;

-- Distinct hostnames are safer than endpoints, but still not necessary in this
-- output. An operator must privately confirm the actual iPhone endpoint host
-- against the handler allowlist and test ownership using authenticated accounts.
-- Separately review pg_net responses by status/time only (not headers/body or
-- error strings), function logs with redaction, RLS as both users, duplicate
-- triggers/webhooks and the sender deployment version. None are proven here.
rollback;
