-- Past Meets (QR-confirmed, server-verified) and the reliability score computed from them.
-- See docs/past-meet-reliability-intent-system.md. A QR scan proves two signed-in people met; it never reveals current Intent.

create table if not exists public.past_meets (
  id uuid primary key default gen_random_uuid(),
  user_a uuid not null references auth.users(id) on delete cascade,
  user_b uuid not null references auth.users(id) on delete cascade,
  confirmed_at timestamptz not null default now(),
  last_meet_at timestamptz not null default now(),
  meet_count integer not null default 1,
  source text not null default 'qr',
  status text not null default 'confirmed' check (status in ('confirmed','revoked')),
  revoked_at timestamptz,
  revoked_by uuid references auth.users(id) on delete set null,
  check (user_a < user_b),
  unique (user_a, user_b)
);

create table if not exists public.qr_meet_tokens (
  id uuid primary key default gen_random_uuid(),
  issuer_user_id uuid not null references auth.users(id) on delete cascade,
  token_hash bytea not null unique,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  consumed_at timestamptz,
  consumed_by uuid references auth.users(id) on delete set null
);
create index if not exists qr_meet_tokens_issuer_idx on public.qr_meet_tokens(issuer_user_id, created_at desc);

-- One row per scoring event: the audit trail behind every score.
create table if not exists public.reliability_events (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  counterparty_user_id uuid not null references auth.users(id) on delete cascade,
  event_type text not null check (event_type in ('qr_past_meet')),
  weight numeric not null,
  occurred_at timestamptz not null default now(),
  source_event_id uuid references public.past_meets(id) on delete set null,
  window_bucket bigint not null,
  -- Repeat scans of the same pair inside a 7 day window count once.
  unique (user_id, counterparty_user_id, event_type, window_bucket)
);
create index if not exists reliability_events_user_idx on public.reliability_events(user_id, occurred_at desc);

alter table public.past_meets enable row level security;
alter table public.qr_meet_tokens enable row level security;
alter table public.reliability_events enable row level security;
revoke all on public.past_meets, public.qr_meet_tokens, public.reliability_events from anon, authenticated;

-- Evidence needed before a number is shown: three different people.
create or replace function private.reliability_compute(p_user uuid)
returns jsonb language sql stable security definer set search_path = public, pg_temp as $$
  with ev as (
    select counterparty_user_id, weight * power(0.5, greatest(0, extract(epoch from (now() - occurred_at)) / 86400.0) / 180.0) as w
    from public.reliability_events where user_id = p_user
  ), agg as (
    select coalesce(sum(w), 0) as evidence, count(distinct counterparty_user_id) as people from ev
  )
  select jsonb_build_object(
    'verified_meets', (select count(*) from public.past_meets pm where pm.status = 'confirmed' and p_user in (pm.user_a, pm.user_b)),
    'people', agg.people,
    'score', case when agg.people >= 3 then least(99, round(100 * (1 - exp(-agg.evidence / 2.2))))::int end,
    'level', case when agg.people < 3 then 'new'
                  when 100 * (1 - exp(-agg.evidence / 2.2)) >= 90 then 'highly_reliable'
                  when 100 * (1 - exp(-agg.evidence / 2.2)) >= 70 then 'reliable'
                  else 'building' end
  ) from agg;
$$;
revoke all on function private.reliability_compute(uuid) from public, anon, authenticated;

create or replace function private.reliability_refresh(p_user uuid)
returns void language plpgsql security definer set search_path = public, pg_temp as $$
declare s jsonb := private.reliability_compute(p_user);
begin
  update public.profiles set reliability_score = coalesce((s->>'score')::numeric, 0), verified_peers_count = (s->>'verified_meets')::int
  where id = p_user;
end $$;
revoke all on function private.reliability_refresh(uuid) from public, anon, authenticated;

-- My QR: a short-lived, single-use token. Only its hash is stored; it carries no profile data.
create or replace function public.issue_meet_qr()
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare uid uuid := auth.uid(); v_token text; v_exp timestamptz := now() + interval '90 seconds';
begin
  if uid is null then raise exception 'not authenticated'; end if;
  if (select count(*) from public.qr_meet_tokens where issuer_user_id = uid and created_at > now() - interval '1 hour') >= 40 then
    raise exception 'QR_RATE_LIMIT';
  end if;
  delete from public.qr_meet_tokens where issuer_user_id = uid and consumed_at is null;
  v_token := 'gm1.' || replace(gen_random_uuid()::text, '-', '') || replace(gen_random_uuid()::text, '-', '');
  insert into public.qr_meet_tokens(issuer_user_id, token_hash, expires_at) values (uid, sha256(convert_to(v_token, 'utf8')), v_exp);
  return jsonb_build_object('token', v_token, 'expires_at', v_exp);
end $$;

-- Scan: the scanner is signed in; the server validates, consumes the token and confirms the Past Meet for both people.
create or replace function public.redeem_meet_qr(p_token text)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare
  uid uuid := auth.uid(); t public.qr_meet_tokens; a uuid; b uuid; pm public.past_meets;
  v_repeat boolean := false; v_bucket bigint := floor(extract(epoch from now()) / 604800);
  v_w_me numeric; v_w_peer numeric; peer record;
begin
  if uid is null then raise exception 'not authenticated'; end if;
  if p_token is null or p_token !~ '^gm1\.[0-9a-f]{64}$' then raise exception 'QR_INVALID'; end if;
  if (select count(*) from public.qr_meet_tokens where consumed_by = uid and consumed_at > now() - interval '24 hours') >= 8 then
    raise exception 'QR_RATE_LIMIT';
  end if;
  select * into t from public.qr_meet_tokens where token_hash = sha256(convert_to(p_token, 'utf8')) for update;
  if not found or t.consumed_at is not null then raise exception 'QR_INVALID'; end if;
  if t.expires_at <= now() then raise exception 'QR_EXPIRED'; end if;
  if t.issuer_user_id = uid then raise exception 'QR_OWN'; end if;
  if public.gayze_is_blocked_between(t.issuer_user_id) then raise exception 'QR_INVALID'; end if;
  if exists (select 1 from public.account_restrictions r where r.user_id in (uid, t.issuer_user_id) and r.status = 'suspended') then
    raise exception 'QR_INVALID';
  end if;

  update public.qr_meet_tokens set consumed_at = now(), consumed_by = uid where id = t.id;
  a := least(uid, t.issuer_user_id); b := greatest(uid, t.issuer_user_id);

  select * into pm from public.past_meets where user_a = a and user_b = b for update;
  if not found then
    insert into public.past_meets(user_a, user_b) values (a, b) returning * into pm;
  else
    v_repeat := pm.status = 'confirmed' and pm.last_meet_at > now() - interval '7 days';
    update public.past_meets set status = 'confirmed', revoked_at = null, revoked_by = null,
      meet_count = meet_count + case when v_repeat then 0 else 1 end, last_meet_at = now() where id = pm.id returning * into pm;
  end if;

  if not v_repeat then
    -- A first meeting with someone counts fully, later ones a quarter; accounts under a week old count for little.
    for peer in select * from (values (uid, t.issuer_user_id), (t.issuer_user_id, uid)) as x(me, other) loop
      v_w_me := (case when exists (select 1 from public.reliability_events e where e.user_id = peer.me and e.counterparty_user_id = peer.other) then 0.25 else 1.0 end)
        * (case when (select created_at from auth.users where id = peer.other) > now() - interval '7 days' then 0.3 else 1.0 end);
      insert into public.reliability_events(user_id, counterparty_user_id, event_type, weight, source_event_id, window_bucket)
      values (peer.me, peer.other, 'qr_past_meet', v_w_me, pm.id, v_bucket) on conflict do nothing;
    end loop;
    perform private.reliability_refresh(uid);
    perform private.reliability_refresh(t.issuer_user_id);
    perform public.gayze_enqueue_notification(t.issuer_user_id, uid, 'connection', 'pastmeet:' || pm.id || ':' || v_bucket || ':a', '/profile');
    perform public.gayze_enqueue_notification(uid, t.issuer_user_id, 'connection', 'pastmeet:' || pm.id || ':' || v_bucket || ':b', '/profile');
  end if;

  select p.id, p.display_name, p.avatar_path into peer from public.profiles p where p.id = t.issuer_user_id;
  return jsonb_build_object('confirmed', true, 'repeat', v_repeat, 'peer_id', peer.id, 'peer_name', peer.display_name,
    'peer_avatar_path', peer.avatar_path, 'mine', private.reliability_compute(uid));
end $$;

-- Reliability for one person: yourself, or anyone you are not blocked with. Aggregates only, never the events behind them.
create or replace function public.reliability_summary(p_user uuid default null)
returns jsonb language plpgsql stable security definer set search_path = public, pg_temp as $$
declare uid uuid := auth.uid(); target uuid := coalesce(p_user, auth.uid());
begin
  if uid is null then raise exception 'not authenticated'; end if;
  if target <> uid and public.gayze_is_blocked_between(target) then return null; end if;
  return private.reliability_compute(target);
end $$;

create or replace function public.get_my_past_meets()
returns table (peer_id uuid, display_name text, avatar_path text, last_meet_at timestamptz, meet_count integer, reliability jsonb)
language sql stable security definer set search_path = public, pg_temp as $$
  select p.id, p.display_name, p.avatar_path, pm.last_meet_at, pm.meet_count, private.reliability_compute(p.id)
  from public.past_meets pm
  join public.profiles p on p.id = case when pm.user_a = auth.uid() then pm.user_b else pm.user_a end
  where auth.uid() in (pm.user_a, pm.user_b) and pm.status = 'confirmed' and not public.gayze_is_blocked_between(p.id)
  order by pm.last_meet_at desc;
$$;

create or replace function public.revoke_past_meet(p_peer uuid)
returns boolean language plpgsql security definer set search_path = public, pg_temp as $$
declare uid uuid := auth.uid();
begin
  if uid is null then raise exception 'not authenticated'; end if;
  update public.past_meets set status = 'revoked', revoked_at = now(), revoked_by = uid
  where user_a = least(uid, p_peer) and user_b = greatest(uid, p_peer) and status = 'confirmed';
  if found then
    perform private.reliability_refresh(uid); perform private.reliability_refresh(p_peer);
  end if;
  return found;
end $$;

revoke all on function public.issue_meet_qr(), public.redeem_meet_qr(text), public.reliability_summary(uuid), public.get_my_past_meets(), public.revoke_past_meet(uuid) from public, anon;
grant execute on function public.issue_meet_qr(), public.redeem_meet_qr(text), public.reliability_summary(uuid), public.get_my_past_meets(), public.revoke_past_meet(uuid) to authenticated;
