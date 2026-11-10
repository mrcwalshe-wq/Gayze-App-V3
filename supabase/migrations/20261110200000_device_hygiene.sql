-- Device hygiene for encrypted chats.
--
-- Every browser or app install that loses its storage registers a brand-new "device", and old ones were never retired. One
-- two-person chat had grown to 322 key envelopes (7 key versions), and every fresh key had to be wrapped and saved for 40+ dead
-- devices at once. That is slow, and a failure on any of them can leave a chat stuck on "Secure chat is still setting up".
--
-- 1. get_conversation_member_devices now returns only each member's 6 most recently used active devices. Chats wrap a key for
--    at most 12 devices. A device that comes back is registered again, so it becomes recent and is included on the next key.
-- 2. gayze_retire_stale_devices() retires devices that have not been seen for 14 days (never a member's 3 newest), so the list
--    stays small. It only changes status to 'revoked'; no key or message is deleted. Run on a schedule or by hand.

create or replace function public.get_conversation_member_devices(p_conversation_id uuid)
returns table(user_id uuid, device_id uuid, public_key text, device_label text, last_seen_at timestamptz, status text)
language sql stable security definer set search_path to 'public', 'pg_temp' as $$
  select r.user_id, r.device_id, r.public_key, r.device_label, r.last_seen_at, r.status
  from public.conversation_members cm
  cross join lateral (
    select d.user_id, d.device_id, d.public_key, d.device_label, d.last_seen_at, d.status, d.created_at
    from public.identity_devices d
    where d.user_id = cm.user_id and d.status = 'active'
    order by coalesce(d.last_seen_at, d.created_at) desc
    limit 6
  ) r
  where cm.conversation_id = p_conversation_id
    and exists (
      select 1 from public.conversation_members me
      where me.conversation_id = p_conversation_id and me.user_id = (select auth.uid())
    )
  order by r.user_id, r.created_at;
$$;

create or replace function public.gayze_retire_stale_devices(p_older_than interval default interval '14 days')
returns integer language plpgsql security definer set search_path to 'public', 'pg_temp' as $$
declare n integer;
begin
  with ranked as (
    select id, row_number() over (partition by user_id order by coalesce(last_seen_at, created_at) desc) rn,
           coalesce(last_seen_at, created_at) seen
    from public.identity_devices where status = 'active'
  ), stale as (
    select id from ranked where rn > 3 and seen < now() - p_older_than
  )
  update public.identity_devices d set status = 'revoked', revoked_at = now()
  from stale where d.id = stale.id;
  get diagnostics n = row_count;
  return n;
end $$;
revoke all on function public.gayze_retire_stale_devices(interval) from public, anon, authenticated;
grant execute on function public.gayze_retire_stale_devices(interval) to service_role;
