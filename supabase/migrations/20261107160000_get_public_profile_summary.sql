-- A profile summary for the profile peek. Members can only read their own row in public.profiles, so the peek could never
-- show anyone else's bio, interests or trust figures. This returns display-level fields for a person the caller is
-- allowed to see: they share a conversation, or the person is discoverable (not ghost, not hidden). Never across a block,
-- never for a suspended or under-18 profile. Boundaries, setup, availability and intimacy details are NOT included.
create or replace function public.get_public_profile_summary(p_user_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path to 'public', 'pg_temp'
as $$
declare
  uid uuid := (select auth.uid());
  result jsonb;
begin
  if uid is null then raise exception 'not authenticated'; end if;
  select jsonb_build_object(
    'displayName', p.display_name,
    'age', p.age,
    'bio', left(coalesce(p.bio, ''), 600),
    'interests', coalesce(to_jsonb(p.interests), '[]'::jsonb),
    'hobbies', coalesce(to_jsonb(p.hobbies), '[]'::jsonb),
    'pronouns', p.pronouns,
    'heightCm', p.height_cm,
    'bodyType', p.body_type,
    'reliabilityScore', p.reliability_score,
    'verifiedPeersCount', p.verified_peers_count,
    'safetyVerified', p.safety_verified
  ) into result
  from public.profiles p
  left join public.user_privacy_settings ps on ps.user_id = p.id
  where p.id = p_user_id
    and (
      p.id = uid
      or (
        (p.age is null or p.age >= 18)
        and not public.gayze_is_blocked_between(p.id)
        and not exists (select 1 from public.account_restrictions r where r.user_id = p.id and r.status = 'suspended')
        and (
          exists (
            select 1 from public.conversation_members a join public.conversation_members b on b.conversation_id = a.conversation_id
            where a.user_id = uid and b.user_id = p.id)
          or (p.privacy_setting <> 'ghost' and coalesce(ps.discoverable, true))
        )
      )
    );
  return result;
end $$;
revoke all on function public.get_public_profile_summary(uuid) from public, anon;
grant execute on function public.get_public_profile_summary(uuid) to authenticated, service_role;
