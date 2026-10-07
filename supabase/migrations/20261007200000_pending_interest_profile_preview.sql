create or replace function public.get_incoming_interest_profiles()
returns table (
  interest_id uuid,
  user_id uuid,
  display_name text,
  handle text,
  age integer,
  bio text,
  neighborhood text,
  avatar_path text,
  interests text[],
  reliability_score integer,
  verified_peers_count integer,
  safety_verified boolean
)
language sql
security definer
stable
set search_path=public,pg_temp
as $$
  select
    i.id,
    p.id,
    p.display_name,
    p.handle,
    p.age,
    p.bio,
    p.neighborhood,
    p.avatar_path,
    p.interests,
    coalesce(p.reliability_score,0),
    coalesce(p.verified_peers_count,0),
    coalesce(p.safety_verified,false)
  from public.interests i
  join public.profiles p on p.id=i.from_user_id
  where i.to_user_id=auth.uid()
    and i.status='pending';
$$;
revoke all on function public.get_incoming_interest_profiles() from public,anon;
grant execute on function public.get_incoming_interest_profiles() to authenticated;

create or replace function public.gayze_can_view_profile_media(p_owner text)
returns boolean
language plpgsql
stable
security definer
set search_path=public,pg_temp
as $$
declare v_owner uuid;
begin
  if p_owner is null or p_owner !~ '^[0-9a-fA-F-]{36}$' then return false; end if;
  v_owner := p_owner::uuid;
  if v_owner = auth.uid() then return true; end if;
  if exists (
    select 1 from public.intents i
    where i.user_id=v_owner and i.expires_at>now() and coalesce(i.is_paused,false)=false
  ) then return true; end if;
  if exists (
    select 1 from public.conversation_members mine
    join public.conversation_members theirs on theirs.conversation_id=mine.conversation_id
    where mine.user_id=auth.uid() and theirs.user_id=v_owner
  ) then return true; end if;
  return exists (
    select 1 from public.interests i
    where i.from_user_id=v_owner
      and i.to_user_id=auth.uid()
      and i.status='pending'
  );
end;
$$;