-- Private albums.
--
-- A person keeps albums of photos. Photos are encrypted on the phone before upload, so this schema only ever holds ciphertext;
-- the album key travels inside the already end-to-end encrypted chat message. Access is gated here, on the server:
--   * the owner always has access;
--   * a recipient has access only through an album_share that is not revoked, not expired, whose chat message has not been
--     unsent / burned / expired, while both people are still in the conversation and neither has blocked the other.
-- So "unsend", a timer, a block, or leaving the chat all cut off access immediately. (Nothing can take back what was already
-- seen or screenshotted; the app says so.)

create table if not exists public.albums (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  name text not null check (char_length(btrim(name)) between 1 and 60),
  wrapped_key text not null,   -- the album key, wrapped to the owner's own device identity
  wrap_nonce text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists albums_owner_idx on public.albums(owner_id);

create table if not exists public.album_photos (
  id uuid primary key default gen_random_uuid(),
  album_id uuid not null references public.albums(id) on delete cascade,
  owner_id uuid not null references auth.users(id) on delete cascade,
  storage_path text not null unique,   -- <owner>/<album>/<photo>.bin in the private album-photos bucket (ciphertext)
  position integer not null default 0,
  created_at timestamptz not null default now()
);
create index if not exists album_photos_album_idx on public.album_photos(album_id, position);

create table if not exists public.album_shares (
  id uuid primary key default gen_random_uuid(),
  album_id uuid not null references public.albums(id) on delete cascade,
  owner_id uuid not null references auth.users(id) on delete cascade,
  recipient_id uuid not null references auth.users(id) on delete cascade,
  conversation_id uuid not null,
  message_id uuid,
  created_at timestamptz not null default now(),
  expires_at timestamptz,
  revoked_at timestamptz
);
create index if not exists album_shares_album_idx on public.album_shares(album_id);
create index if not exists album_shares_recipient_idx on public.album_shares(recipient_id) where revoked_at is null;
create index if not exists album_shares_message_idx on public.album_shares(message_id) where message_id is not null;

alter table public.albums enable row level security;
alter table public.album_photos enable row level security;
alter table public.album_shares enable row level security;

drop policy if exists albums_owner_all on public.albums;
create policy albums_owner_all on public.albums for all to authenticated
  using (owner_id = (select auth.uid())) with check (owner_id = (select auth.uid()));
drop policy if exists album_photos_owner_all on public.album_photos;
create policy album_photos_owner_all on public.album_photos for all to authenticated
  using (owner_id = (select auth.uid()))
  with check (owner_id = (select auth.uid()) and exists (select 1 from public.albums a where a.id = album_id and a.owner_id = (select auth.uid())));
drop policy if exists album_shares_owner_select on public.album_shares;
create policy album_shares_owner_select on public.album_shares for select to authenticated
  using (owner_id = (select auth.uid()));

revoke all on public.albums, public.album_photos, public.album_shares from anon, public;
grant select, insert, update, delete on public.albums, public.album_photos to authenticated;
grant select on public.album_shares to authenticated;   -- writes only through the functions below

-- Limits: 10 albums per person, 30 photos per album.
create or replace function public.gayze_album_limits() returns trigger
language plpgsql security definer set search_path to 'public', 'pg_temp' as $$
begin
  if tg_table_name = 'albums' then
    if (select count(*) from public.albums where owner_id = new.owner_id) >= 10 then raise exception 'ALBUM_LIMIT_ALBUMS'; end if;
  else
    if (select count(*) from public.album_photos where album_id = new.album_id) >= 30 then raise exception 'ALBUM_LIMIT_PHOTOS'; end if;
  end if;
  return new;
end $$;
revoke all on function public.gayze_album_limits() from public, anon, authenticated;
drop trigger if exists albums_limit on public.albums;
create trigger albums_limit before insert on public.albums for each row execute function public.gayze_album_limits();
drop trigger if exists album_photos_limit on public.album_photos;
create trigger album_photos_limit before insert on public.album_photos for each row execute function public.gayze_album_limits();

-- Is this share usable by this viewer right now?
create or replace function public.gayze_album_share_ok(p_share_id uuid, p_viewer uuid)
returns boolean language sql stable security definer set search_path to 'public', 'pg_temp' as $$
  select exists (
    select 1 from public.album_shares s
    where s.id = p_share_id
      and s.recipient_id = p_viewer
      and s.revoked_at is null
      and (s.expires_at is null or s.expires_at > now())
      and exists (select 1 from public.conversation_members m where m.conversation_id = s.conversation_id and m.user_id = s.owner_id)
      and exists (select 1 from public.conversation_members m where m.conversation_id = s.conversation_id and m.user_id = s.recipient_id)
      and not exists (select 1 from public.blocks b where (b.blocker_id = s.owner_id and b.blocked_id = s.recipient_id) or (b.blocker_id = s.recipient_id and b.blocked_id = s.owner_id))
      and (s.message_id is null or exists (
        select 1 from public.messages msg
        where msg.id = s.message_id and msg.unsent_at is null and msg.burned_at is null
          and (msg.expires_at is null or msg.expires_at > now())))
  );
$$;
revoke all on function public.gayze_album_share_ok(uuid, uuid) from public, anon;
grant execute on function public.gayze_album_share_ok(uuid, uuid) to authenticated, service_role;

-- Who may read a stored object: the owner, or a recipient with a usable share of the album that holds it.
create or replace function public.gayze_can_view_album_object(p_name text)
returns boolean language sql stable security definer set search_path to 'public', 'pg_temp' as $$
  select (select auth.uid()) is not null and (
    (storage.foldername(p_name))[1] = (select auth.uid())::text
    or exists (
      select 1 from public.album_photos p
      join public.album_shares s on s.album_id = p.album_id
      where p.storage_path = p_name and public.gayze_album_share_ok(s.id, (select auth.uid()))
    )
  );
$$;
revoke all on function public.gayze_can_view_album_object(text) from public, anon;
grant execute on function public.gayze_can_view_album_object(text) to authenticated, service_role;

-- Storage: a private bucket of ciphertext.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('album-photos', 'album-photos', false, 8388608, array['application/octet-stream'])
on conflict (id) do update set public = false, file_size_limit = 8388608, allowed_mime_types = array['application/octet-stream'];

drop policy if exists album_photos_objects_select on storage.objects;
create policy album_photos_objects_select on storage.objects for select to authenticated
  using (bucket_id = 'album-photos' and public.gayze_can_view_album_object(name));
drop policy if exists album_photos_objects_insert on storage.objects;
create policy album_photos_objects_insert on storage.objects for insert to authenticated
  with check (bucket_id = 'album-photos' and (storage.foldername(name))[1] = (select auth.uid())::text);
drop policy if exists album_photos_objects_update on storage.objects;
create policy album_photos_objects_update on storage.objects for update to authenticated
  using (bucket_id = 'album-photos' and (storage.foldername(name))[1] = (select auth.uid())::text);
drop policy if exists album_photos_objects_delete on storage.objects;
create policy album_photos_objects_delete on storage.objects for delete to authenticated
  using (bucket_id = 'album-photos' and (storage.foldername(name))[1] = (select auth.uid())::text);

-- Share an album into a direct chat. Returns the share id; the app then sends the chat message and links it.
create or replace function public.share_album(p_album_id uuid, p_conversation_id uuid, p_expires_at timestamptz)
returns uuid language plpgsql security definer set search_path to 'public', 'pg_temp' as $$
declare
  uid uuid := (select auth.uid());
  v_recipient uuid;
  v_id uuid;
begin
  if uid is null then raise exception 'not authenticated'; end if;
  if not exists (select 1 from public.albums where id = p_album_id and owner_id = uid) then raise exception 'not your album'; end if;
  if not exists (select 1 from public.album_photos where album_id = p_album_id) then raise exception 'ALBUM_EMPTY'; end if;
  if p_expires_at is not null and (p_expires_at <= now() or p_expires_at > now() + interval '30 days') then raise exception 'invalid expiry'; end if;
  if not exists (select 1 from public.conversation_members where conversation_id = p_conversation_id and user_id = uid) then raise exception 'not a conversation member'; end if;
  if (select count(*) from public.conversation_members where conversation_id = p_conversation_id) <> 2 then raise exception 'ALBUM_DIRECT_ONLY'; end if;
  select user_id into v_recipient from public.conversation_members where conversation_id = p_conversation_id and user_id <> uid;
  if exists (select 1 from public.blocks b where (b.blocker_id = uid and b.blocked_id = v_recipient) or (b.blocker_id = v_recipient and b.blocked_id = uid)) then
    raise exception using errcode = '42501', message = 'GAYZE_BLOCKED_USER';
  end if;
  insert into public.album_shares(album_id, owner_id, recipient_id, conversation_id, expires_at)
  values (p_album_id, uid, v_recipient, p_conversation_id, p_expires_at) returning id into v_id;
  return v_id;
end $$;

create or replace function public.link_album_share_message(p_share_id uuid, p_message_id uuid)
returns boolean language plpgsql security definer set search_path to 'public', 'pg_temp' as $$
declare uid uuid := (select auth.uid());
begin
  if uid is null then raise exception 'not authenticated'; end if;
  update public.album_shares s set message_id = p_message_id
   where s.id = p_share_id and s.owner_id = uid and s.message_id is null
     and exists (select 1 from public.messages m where m.id = p_message_id and m.sender_id = uid and m.conversation_id = s.conversation_id);
  return found;
end $$;

create or replace function public.revoke_album_share(p_share_id uuid)
returns boolean language plpgsql security definer set search_path to 'public', 'pg_temp' as $$
declare uid uuid := (select auth.uid());
begin
  if uid is null then raise exception 'not authenticated'; end if;
  update public.album_shares set revoked_at = now() where id = p_share_id and owner_id = uid and revoked_at is null;
  return found;
end $$;

-- What a recipient needs to open a shared album: its name and the (encrypted) photo paths. Nothing if access has ended.
create or replace function public.get_shared_album(p_share_id uuid)
returns jsonb language plpgsql stable security definer set search_path to 'public', 'pg_temp' as $$
declare
  uid uuid := (select auth.uid());
  v_album uuid; v_name text; v_exp timestamptz;
begin
  if uid is null then raise exception 'not authenticated'; end if;
  if not public.gayze_album_share_ok(p_share_id, uid) then return jsonb_build_object('status', 'unavailable'); end if;
  select a.id, a.name, s.expires_at into v_album, v_name, v_exp
    from public.album_shares s join public.albums a on a.id = s.album_id where s.id = p_share_id;
  return jsonb_build_object(
    'status', 'ok', 'name', v_name, 'expiresAt', v_exp,
    'photos', coalesce((select jsonb_agg(jsonb_build_object('id', p.id, 'path', p.storage_path) order by p.position, p.created_at)
                         from public.album_photos p where p.album_id = v_album), '[]'::jsonb));
end $$;

-- The owner's "who can see this" list.
create or replace function public.list_album_shares(p_album_id uuid)
returns jsonb language plpgsql stable security definer set search_path to 'public', 'pg_temp' as $$
declare uid uuid := (select auth.uid());
begin
  if uid is null then raise exception 'not authenticated'; end if;
  return coalesce((
    select jsonb_agg(jsonb_build_object(
      'id', s.id, 'recipientId', s.recipient_id, 'recipientName', coalesce(p.display_name, 'Someone'),
      'createdAt', s.created_at, 'expiresAt', s.expires_at, 'revokedAt', s.revoked_at,
      'active', (s.revoked_at is null and (s.expires_at is null or s.expires_at > now())
                 and (s.message_id is null or exists (select 1 from public.messages m where m.id = s.message_id and m.unsent_at is null and m.burned_at is null and (m.expires_at is null or m.expires_at > now()))))
    ) order by s.created_at desc)
    from public.album_shares s left join public.profiles p on p.id = s.recipient_id
    where s.album_id = p_album_id and s.owner_id = uid), '[]'::jsonb);
end $$;

do $$ declare f text; begin
  foreach f in array array['share_album(uuid,uuid,timestamptz)','link_album_share_message(uuid,uuid)','revoke_album_share(uuid)','get_shared_album(uuid)','list_album_shares(uuid)'] loop
    execute format('revoke all on function public.%s from public, anon', f);
    execute format('grant execute on function public.%s to authenticated, service_role', f);
  end loop;
end $$;

-- Unsending the chat message ends access to the album it carried.
create or replace function public.gayze_revoke_album_shares_on_unsend() returns trigger
language plpgsql security definer set search_path to 'public', 'pg_temp' as $$
begin
  update public.album_shares set revoked_at = now() where message_id = new.id and revoked_at is null;
  return new;
end $$;
revoke all on function public.gayze_revoke_album_shares_on_unsend() from public, anon, authenticated;
drop trigger if exists messages_revoke_album_shares on public.messages;
create trigger messages_revoke_album_shares after update of unsent_at, burned_at on public.messages
  for each row when ((new.unsent_at is not null and old.unsent_at is null) or (new.burned_at is not null and old.burned_at is null))
  execute function public.gayze_revoke_album_shares_on_unsend();
