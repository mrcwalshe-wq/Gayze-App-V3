-- Keep photos explicitly shared through an intent interest viewable after acceptance.
-- Decline remains silent and does not expose the sender's shared media.
create or replace function public.gayze_can_view_shared_interest_photo(p_storage_path text)
returns boolean language sql security definer stable set search_path=public,pg_temp
as $$
  select exists (
    select 1
    from public.profile_photos pp
    join public.interests i on pp.id = any(i.shared_photo_ids)
    where pp.storage_path = p_storage_path
      and i.to_user_id = auth.uid()
      and i.status in ('pending','mutual')
  );
$$;

revoke all on function public.gayze_can_view_shared_interest_photo(text) from public,anon;
grant execute on function public.gayze_can_view_shared_interest_photo(text) to authenticated;

drop policy if exists profile_photos_select_visible on public.profile_photos;
create policy profile_photos_select_visible on public.profile_photos
for select to authenticated
using (
  gayze_can_view_profile_media(user_id::text)
  or gayze_can_view_shared_interest_photo(storage_path)
);

drop policy if exists profile_photos_objects_select on storage.objects;
create policy profile_photos_objects_select on storage.objects
for select to authenticated
using (
  bucket_id='profile-photos'
  and (
    gayze_can_view_profile_media((storage.foldername(name))[1])
    or gayze_can_view_shared_interest_photo(name)
  )
);
