-- A second, dependable route for call setup.
--
-- Call setup (the "offer" and the "answer") travels over a live realtime channel. When a phone has been asleep that channel can look
-- joined while delivering nothing, and the call sits on "connecting" until someone hangs up (the logs show the caller re-sending its
-- offer 3-4 times and the answering phone never receiving any). This mailbox is the fallback: the offer and answer are also written
-- here, and a phone that has not received them over the live channel after a few seconds reads them from here instead.
--
-- Only the two people on a call can write to or read from it, only the newest message of a kind is ever read, and rows are removed
-- after a day. A message holds only what the live channel already carries (the connection description); never any audio or content.

create table if not exists public.call_signals (
  id bigint generated always as identity primary key,
  call_id uuid not null,
  sender_id uuid not null references auth.users(id) on delete cascade,
  recipient_id uuid not null references auth.users(id) on delete cascade,
  kind text not null check (kind in ('offer', 'answer')),
  payload jsonb not null,
  created_at timestamptz not null default now()
);
create index if not exists call_signals_lookup_idx on public.call_signals(call_id, recipient_id, kind, id desc);
alter table public.call_signals enable row level security;
revoke all on public.call_signals from anon, authenticated;

create or replace function public.post_call_signal(p_call_id uuid, p_to uuid, p_kind text, p_payload jsonb)
returns bigint language plpgsql security definer set search_path = public, pg_temp as $$
declare uid uuid := auth.uid(); new_id bigint;
begin
  if uid is null then raise exception 'not authenticated'; end if;
  if p_kind not in ('offer', 'answer') then raise exception 'invalid_kind'; end if;
  if p_payload is null or length(p_payload::text) > 24000 then raise exception 'invalid_payload'; end if;
  -- Only the two people on this call, in the right direction.
  if not exists (
    select 1 from public.call_sessions c
    where c.id = p_call_id and c.created_at > now() - interval '1 day'
      and ((c.caller_id = uid and c.callee_id = p_to) or (c.callee_id = uid and c.caller_id = p_to))
  ) then raise exception 'not_on_call'; end if;
  if (select count(*) from public.call_signals where call_id = p_call_id and sender_id = uid) >= 40 then raise exception 'RATE_LIMIT'; end if;
  delete from public.call_signals where created_at < now() - interval '1 day';
  insert into public.call_signals(call_id, sender_id, recipient_id, kind, payload) values (p_call_id, uid, p_to, p_kind, p_payload) returning id into new_id;
  return new_id;
end $$;

-- The newest message of one kind addressed to me for this call, if it is newer than the one I already have.
create or replace function public.get_call_signal(p_call_id uuid, p_kind text, p_after bigint default 0)
returns table (id bigint, sender_id uuid, payload jsonb)
language sql stable security definer set search_path = public, pg_temp as $$
  select s.id, s.sender_id, s.payload from public.call_signals s
  where s.call_id = p_call_id and s.recipient_id = auth.uid() and s.kind = p_kind and s.id > coalesce(p_after, 0)
  order by s.id desc limit 1;
$$;

revoke all on function public.post_call_signal(uuid, uuid, text, jsonb), public.get_call_signal(uuid, text, bigint) from public, anon;
grant execute on function public.post_call_signal(uuid, uuid, text, jsonb), public.get_call_signal(uuid, text, bigint) to authenticated;
