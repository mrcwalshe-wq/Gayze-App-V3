-- Privacy hardening, found in an audit of the Privacy & visibility settings.
--
-- 1. Profile photos were readable by ANY signed-in user whenever the owner had a live intent. That ignored blocks, "Appear in
--    Discover" being off, and ghost mode. gayze_can_view_profile_media guards both the profile_photos table and the
--    profile-photos storage bucket, so fixing it fixes both.
-- 2. "Only connections can message me" was enforced only inside submit_interest. interests and gazes accept direct inserts from
--    signed-in users (policy: sender = self), so a modified app could skip the check. A trigger now enforces it for every path.

-- 1 ---------------------------------------------------------------------------------------------------------------------
create or replace function public.gayze_can_view_profile_media(p_owner text)
returns boolean
language plpgsql
stable
security definer
set search_path to 'public', 'pg_temp'
as $$
declare
  v_owner uuid;
  v_uid uuid := auth.uid();
begin
  if p_owner is null or p_owner !~ '^[0-9a-fA-F-]{36}$' then return false; end if;
  v_owner := p_owner::uuid;
  if v_owner = v_uid then return true; end if;
  if v_uid is null then return false; end if;

  -- Never across a block, in either direction.
  if exists (
    select 1 from public.blocks b
    where (b.blocker_id = v_uid and b.blocked_id = v_owner)
       or (b.blocker_id = v_owner and b.blocked_id = v_uid)
  ) then return false; end if;

  -- People who already share a conversation.
  if exists (
    select 1 from public.conversation_members mine
    join public.conversation_members theirs on theirs.conversation_id = mine.conversation_id
    where mine.user_id = v_uid and theirs.user_id = v_owner
  ) then return true; end if;

  -- Someone who sent you a Gayze that is still waiting for your answer.
  if exists (
    select 1 from public.interests i
    where i.from_user_id = v_owner and i.to_user_id = v_uid and i.status = 'pending'
  ) then return true; end if;

  -- Everyone else: only while the owner is live AND discoverable (not ghost, "Appear in Discover" on).
  return exists (
    select 1
    from public.intents i
    join public.profiles p on p.id = i.user_id
    left join public.user_privacy_settings ps on ps.user_id = i.user_id
    where i.user_id = v_owner
      and i.expires_at > now()
      and coalesce(i.is_paused, false) = false
      and coalesce(p.privacy_setting, '') <> 'ghost'
      and coalesce(ps.discoverable, true)
  );
end;
$$;
revoke all on function public.gayze_can_view_profile_media(text) from public, anon;
grant execute on function public.gayze_can_view_profile_media(text) to authenticated, service_role;

-- 2 ---------------------------------------------------------------------------------------------------------------------
create or replace function public.gayze_enforce_contact_restriction()
returns trigger
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $$
begin
  if tg_table_name = 'interests' then
    -- Only a new request counts. Answering one (mutual, declined, withdrawn) is not contacting someone.
    if new.status <> 'pending' then return new; end if;
    if tg_op = 'UPDATE' and old.status is not distinct from new.status then return new; end if;
  end if;

  if coalesce((select who_can_message from public.user_privacy_settings where user_id = new.to_user_id), 'everyone') = 'connections'
     and not exists (
       select 1 from public.conversation_members a
       join public.conversation_members b on b.conversation_id = a.conversation_id
       where a.user_id = new.from_user_id and b.user_id = new.to_user_id
     ) then
    raise exception 'CONTACT_RESTRICTED';
  end if;
  return new;
end;
$$;
revoke all on function public.gayze_enforce_contact_restriction() from public, anon, authenticated;

-- Named so they fire before the send-cooldown triggers: a refused request must not use up the sender's daily allowance.
drop trigger if exists interests_contact_restriction on public.interests;
create trigger interests_contact_restriction before insert or update of status on public.interests
  for each row execute function public.gayze_enforce_contact_restriction();

drop trigger if exists gazes_contact_restriction on public.gazes;
create trigger gazes_contact_restriction before insert on public.gazes
  for each row execute function public.gayze_enforce_contact_restriction();
