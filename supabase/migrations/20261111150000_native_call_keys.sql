-- Native audio calls on the iPhone: answering from the lock screen.
--
-- A locked iPhone cannot run the web view, so a call answered on the lock screen has to be set up by native code. Native code
-- has no signed-in session of its own, so each phone is given a long random "call key" while the app is open. With that key
-- (and only for calls where its owner really is a participant) the phone can: say the call was answered, read the caller's offer
-- from the call mailbox, leave its answer, read the call's status and hang up. Only a hash of the key is stored.
--
-- Also: a call that was answered and then hung up is now recorded (hung_up_at), so each side can tell the other has left even
-- when the live signal is missed. `status` keeps its meaning (ringing / answered / ended-unanswered) for the reports.

create table if not exists public.native_call_keys (
  user_id uuid not null references auth.users(id) on delete cascade,
  device_id text not null check (length(device_id) between 1 and 80),
  key_hash bytea not null unique,
  created_at timestamptz not null default now(),
  primary key (user_id, device_id)
);
alter table public.native_call_keys enable row level security;
revoke all on public.native_call_keys from anon, authenticated;

alter table public.call_sessions add column if not exists hung_up_at timestamptz;

-- Issued to the signed-in app; replaces any earlier key for the same phone.
create or replace function public.issue_native_call_key(p_device text)
returns text language plpgsql security definer set search_path = public, pg_temp as $$
declare uid uuid := auth.uid(); v_key text;
begin
  if uid is null then raise exception 'not authenticated'; end if;
  if p_device is null or length(p_device) < 1 or length(p_device) > 80 then raise exception 'invalid_device'; end if;
  v_key := 'gck1.' || replace(gen_random_uuid()::text, '-', '') || replace(gen_random_uuid()::text, '-', '');
  insert into public.native_call_keys(user_id, device_id, key_hash) values (uid, p_device, sha256(convert_to(v_key, 'utf8')))
  on conflict (user_id, device_id) do update set key_hash = excluded.key_hash, created_at = now();
  return v_key;
end $$;

create or replace function public.revoke_native_call_key(p_device text)
returns void language sql security definer set search_path = public, pg_temp as $$
  delete from public.native_call_keys where user_id = auth.uid() and device_id = p_device;
$$;

create schema if not exists private;
-- Who a call key belongs to, or null.
create or replace function private.native_call_user(p_key text)
returns uuid language sql stable security definer set search_path = public, pg_temp as $$
  select k.user_id from public.native_call_keys k
  where p_key ~ '^gck1\.[0-9a-f]{64}$' and k.key_hash = sha256(convert_to(p_key, 'utf8'));
$$;
revoke all on function private.native_call_user(text) from public, anon, authenticated;

-- 'ringing' | 'answered' | 'ended' as the two phones need it: an answered call that was hung up reads as 'ended'.
create or replace function private.call_live_status(p_status text, p_hung_up timestamptz)
returns text language sql immutable as $$ select case when p_hung_up is not null then 'ended' else p_status end $$;

-- The phone answered on the system call screen. Returns the call's live status, or null if this key has no business with it.
create or replace function public.native_call_answer(p_call_id uuid, p_key text)
returns text language plpgsql security definer set search_path = public, pg_temp as $$
declare uid uuid := private.native_call_user(p_key); s public.call_sessions;
begin
  if uid is null then return null; end if;
  select * into s from public.call_sessions where id = p_call_id and callee_id = uid and created_at > now() - interval '5 minutes' for update;
  if not found then return null; end if;
  if s.status = 'ringing' then
    update public.call_sessions set status = 'answered', ended_at = now() where id = p_call_id returning * into s;
  end if;
  return private.call_live_status(s.status, s.hung_up_at);
end $$;

create or replace function public.native_call_status(p_call_id uuid, p_key text)
returns text language sql stable security definer set search_path = public, pg_temp as $$
  select private.call_live_status(s.status, s.hung_up_at) from public.call_sessions s
  where s.id = p_call_id and private.native_call_user(p_key) in (s.caller_id, s.callee_id);
$$;

create or replace function public.native_call_end(p_call_id uuid, p_key text)
returns void language plpgsql security definer set search_path = public, pg_temp as $$
declare uid uuid := private.native_call_user(p_key);
begin
  if uid is null then return; end if;
  update public.call_sessions set
    status = case when status = 'ringing' then 'ended' else status end,
    ended_at = case when status = 'ringing' then now() else ended_at end,
    hung_up_at = case when status = 'answered' then coalesce(hung_up_at, now()) else hung_up_at end
  where id = p_call_id and uid in (caller_id, callee_id);
end $$;

-- The call mailbox (see 20261111120000), reached with a call key instead of a session.
create or replace function public.native_call_get_signal(p_call_id uuid, p_key text, p_kind text, p_after bigint default 0)
returns table (id bigint, sender_id uuid, payload jsonb)
language sql stable security definer set search_path = public, pg_temp as $$
  select s.id, s.sender_id, s.payload from public.call_signals s
  where s.call_id = p_call_id and s.recipient_id = private.native_call_user(p_key) and s.kind = p_kind and s.id > coalesce(p_after, 0)
  order by s.id desc limit 1;
$$;

create or replace function public.native_call_post_signal(p_call_id uuid, p_key text, p_kind text, p_payload jsonb)
returns bigint language plpgsql security definer set search_path = public, pg_temp as $$
declare uid uuid := private.native_call_user(p_key); v_to uuid; new_id bigint;
begin
  if uid is null then raise exception 'not_on_call'; end if;
  if p_kind not in ('offer', 'answer') then raise exception 'invalid_kind'; end if;
  if p_payload is null or length(p_payload::text) > 24000 then raise exception 'invalid_payload'; end if;
  select case when c.caller_id = uid then c.callee_id else c.caller_id end into v_to
  from public.call_sessions c where c.id = p_call_id and uid in (c.caller_id, c.callee_id) and c.created_at > now() - interval '1 day';
  if v_to is null then raise exception 'not_on_call'; end if;
  if (select count(*) from public.call_signals where call_id = p_call_id and sender_id = uid) >= 40 then raise exception 'RATE_LIMIT'; end if;
  insert into public.call_signals(call_id, sender_id, recipient_id, kind, payload) values (p_call_id, uid, v_to, p_kind, p_payload) returning call_signals.id into new_id;
  return new_id;
end $$;

-- The native side writes to the same call log the app does (short step names only), so a call that fails on a locked phone can be read.
create or replace function public.native_call_log(p_call_id uuid, p_key text, p_event text)
returns void language plpgsql security definer set search_path = public, pg_temp as $$
declare uid uuid := private.native_call_user(p_key);
begin
  if uid is null or p_event is null then return; end if;
  if not exists (select 1 from public.call_sessions s where s.id = p_call_id and uid in (s.caller_id, s.callee_id)) then return; end if;
  if (select count(*) from public.call_events where call_id = p_call_id and user_id = uid) >= 200 then return; end if;
  insert into public.call_events(call_id, user_id, event) values (p_call_id, uid, left(p_event, 160));
end $$;

-- Signed-in side: hanging up an answered call is recorded, and the status both sides read reflects it.
create or replace function public.end_call_session(p_call_id uuid, p_status text default 'ended')
returns void language plpgsql security definer set search_path = public, pg_temp as $$
declare uid uuid := auth.uid();
begin
  if uid is null then raise exception 'not authenticated'; end if;
  update public.call_sessions set status = case when p_status = 'answered' then 'answered' else 'ended' end, ended_at = now()
  where id = p_call_id and status = 'ringing' and uid in (caller_id, callee_id);
  if not found and p_status <> 'answered' then
    update public.call_sessions set hung_up_at = coalesce(hung_up_at, now())
    where id = p_call_id and status = 'answered' and uid in (caller_id, callee_id);
  end if;
end $$;

create or replace function public.get_call_status(p_call_id uuid)
returns text language sql stable security definer set search_path = public, pg_temp as $$
  select private.call_live_status(s.status, s.hung_up_at) from public.call_sessions s where s.id = p_call_id and auth.uid() in (s.caller_id, s.callee_id);
$$;

revoke all on function public.issue_native_call_key(text), public.revoke_native_call_key(text) from public, anon;
grant execute on function public.issue_native_call_key(text), public.revoke_native_call_key(text) to authenticated;
-- These six are called by the phone with no session: the call key is the credential.
revoke all on function public.native_call_answer(uuid, text), public.native_call_status(uuid, text), public.native_call_end(uuid, text),
  public.native_call_get_signal(uuid, text, text, bigint), public.native_call_post_signal(uuid, text, text, jsonb),
  public.native_call_log(uuid, text, text) from public;
grant execute on function public.native_call_answer(uuid, text), public.native_call_status(uuid, text), public.native_call_end(uuid, text),
  public.native_call_get_signal(uuid, text, text, bigint), public.native_call_post_signal(uuid, text, text, jsonb),
  public.native_call_log(uuid, text, text) to anon, authenticated;
revoke all on function public.end_call_session(uuid, text), public.get_call_status(uuid) from public, anon;
grant execute on function public.end_call_session(uuid, text), public.get_call_status(uuid) to authenticated;
