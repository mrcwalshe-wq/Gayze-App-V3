-- Event photos: one optional picture per gathering, stored privately and shown to members through signed links.

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('event-photos', 'event-photos', false, 5242880, array['image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do nothing;

-- Every signed-in member can see an event, so every signed-in member can read its picture.
create policy event_photos_objects_select on storage.objects for select to authenticated
  using (bucket_id = 'event-photos');
-- Only the host writes, and only into their own folder: <host id>/<file>.
create policy event_photos_objects_insert on storage.objects for insert to authenticated
  with check (bucket_id = 'event-photos' and (storage.foldername(name))[1] = (select auth.uid())::text);
create policy event_photos_objects_update on storage.objects for update to authenticated
  using (bucket_id = 'event-photos' and (storage.foldername(name))[1] = (select auth.uid())::text)
  with check (bucket_id = 'event-photos' and (storage.foldername(name))[1] = (select auth.uid())::text);
create policy event_photos_objects_delete on storage.objects for delete to authenticated
  using (bucket_id = 'event-photos' and (storage.foldername(name))[1] = (select auth.uid())::text);

alter table public.gatherings add column if not exists photo_path text;
-- A gathering can only point at a file in its own host's folder.
alter table public.gatherings add constraint gatherings_photo_in_host_folder
  check (photo_path is null or photo_path like host_id::text || '/%') not valid;
alter table public.gatherings validate constraint gatherings_photo_in_host_folder;

-- The table's read access is column by column since the place lock-down.
grant select (photo_path) on public.gatherings to authenticated;
