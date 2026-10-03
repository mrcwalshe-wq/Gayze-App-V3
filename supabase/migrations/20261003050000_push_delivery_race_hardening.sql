-- GAYZE push delivery race hardening.
-- Additive and safe to apply after 20261002100000_durable_notifications.sql.
-- No private keys, message bodies or encryption material are touched.

create or replace function public.gayze_claim_notification_delivery(
  p_id uuid,
  p_subscription uuid,
  p_endpoint text
)
returns boolean
language plpgsql
security definer
set search_path=public,pg_temp
as $$
declare
  v_rows integer;
begin
  insert into public.gayze_notification_deliveries(notification_id,endpoint)
  select n.id,s.endpoint
    from public.gayze_notifications n
    join public.push_subscriptions s on s.user_id=n.user_id
   where n.id=p_id
     and s.id=p_subscription
     and s.endpoint=p_endpoint
     and public.gayze_notification_push_allowed(n.id)
  on conflict do nothing;
  get diagnostics v_rows = row_count;
  return v_rows=1;
end $$;

revoke all on function public.gayze_claim_notification_delivery(uuid,uuid,text) from public,anon,authenticated;
grant execute on function public.gayze_claim_notification_delivery(uuid,uuid,text) to service_role;

-- Only prune the exact subscription snapshot that failed. If the same endpoint
-- has since rotated its encryption keys, the delete becomes a no-op.
create or replace function public.gayze_prune_push_subscription(
  p_id uuid,
  p_user_id uuid,
  p_endpoint text,
  p_p256dh text,
  p_auth text
)
returns boolean
language plpgsql
security definer
set search_path=public,pg_temp
as $$
declare v_rows integer;
begin
  delete from public.push_subscriptions
   where id=p_id
     and user_id=p_user_id
     and endpoint=p_endpoint
     and p256dh=p_p256dh
     and auth=p_auth;
  get diagnostics v_rows = row_count;
  return v_rows=1;
end $$;

revoke all on function public.gayze_prune_push_subscription(uuid,uuid,text,text,text) from public,anon,authenticated;
grant execute on function public.gayze_prune_push_subscription(uuid,uuid,text,text,text) to service_role;
