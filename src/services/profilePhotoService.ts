import { supabase } from './supabaseClient';

export interface ProfilePhoto {
  id: string;
  userId: string;
  storagePath: string;
  sortOrder: number;
  isPrimary: boolean;
  url: string;
}

const BUCKET = 'profile-photos';
const MAX_PHOTOS = 6;
const MAX_BYTES = 5 * 1024 * 1024;
const ALLOWED = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif']);

async function signedUrl(path: string): Promise<string> {
  if (!supabase) throw new Error('Supabase is not configured.');
  const { data, error } = await supabase.storage.from(BUCKET).createSignedUrl(path, 60 * 60);
  if (error || !data?.signedUrl) throw new Error(error?.message || 'Could not load profile photo.');
  return data.signedUrl;
}

async function prepareUpload(file: File): Promise<{ file: File; contentType: string; extension: string }> {
  const type = file.type.toLowerCase();
  if (!ALLOWED.has(type)) throw new Error('Choose a JPG, PNG, WebP or iPhone photo.');
  if (file.size > MAX_BYTES) throw new Error('Profile photos must be 5 MB or smaller.');

  if (type === 'image/heic' || type === 'image/heif') {
    const bitmap = await createImageBitmap(file).catch(() => null);
    if (!bitmap) throw new Error('This iPhone photo is HEIC/HEIF and could not be converted by this browser. Please choose a JPG photo.');
    try {
      const canvas = document.createElement('canvas');
      canvas.width = bitmap.width;
      canvas.height = bitmap.height;
      const context = canvas.getContext('2d');
      if (!context) throw new Error('Could not prepare the photo.');
      context.drawImage(bitmap, 0, 0);
      const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/jpeg', 0.9));
      if (!blob) throw new Error('Could not convert the photo to JPG.');
      const converted = new File([blob], file.name.replace(/\.[^.]+$/, '') + '.jpg', {
        type: 'image/jpeg',
        lastModified: Date.now(),
      });
      if (converted.size > MAX_BYTES) throw new Error('The converted photo is larger than 5 MB. Please choose a smaller photo.');
      return { file: converted, contentType: 'image/jpeg', extension: 'jpg' };
    } finally {
      bitmap.close();
    }
  }

  return {
    file,
    contentType: type,
    extension: type === 'image/jpeg' ? 'jpg' : type.split('/')[1],
  };
}

export async function loadProfilePhotos(): Promise<ProfilePhoto[]> {
  if (!supabase) return [];
  const { data, error } = await supabase
    .from('profile_photos')
    .select('id,user_id,storage_path,sort_order,is_primary')
    .order('sort_order', { ascending: true });

  if (error) throw new Error(error.message);

  return Promise.all((data ?? []).map(async (row) => ({
    id: row.id,
    userId: row.user_id,
    storagePath: row.storage_path,
    sortOrder: row.sort_order,
    isPrimary: row.is_primary,
    url: await signedUrl(row.storage_path),
  })));
}

export async function uploadProfilePhoto(file: File): Promise<ProfilePhoto[]> {
  if (!supabase) throw new Error('Supabase is not configured.');
  const prepared = await prepareUpload(file);

  const { data: auth } = await supabase.auth.getUser();
  const userId = auth.user?.id;
  if (!userId) throw new Error('Please sign in again.');

  const existing = await loadProfilePhotos();
  if (existing.length >= MAX_PHOTOS) throw new Error('You can add up to 6 profile photos.');

  const photoId = crypto.randomUUID();
  const path = userId + '/' + photoId + '.' + prepared.extension;

  const { error: uploadError } = await supabase.storage.from(BUCKET).upload(path, prepared.file, {
    contentType: prepared.contentType,
    upsert: false,
    cacheControl: '3600',
  });
  if (uploadError) throw new Error(uploadError.message);

  const { error: insertError } = await supabase.from('profile_photos').insert({
    user_id: userId,
    storage_path: path,
    sort_order: existing.length,
    is_primary: existing.length === 0,
  });

  if (insertError) {
    await supabase.storage.from(BUCKET).remove([path]);
    throw new Error(insertError.message);
  }

  return loadProfilePhotos();
}

export async function deleteProfilePhoto(photo: ProfilePhoto): Promise<ProfilePhoto[]> {
  if (!supabase) throw new Error('Supabase is not configured.');
  const { error } = await supabase.from('profile_photos').delete().eq('id', photo.id);
  if (error) throw new Error(error.message);
  await supabase.storage.from(BUCKET).remove([photo.storagePath]);
  return loadProfilePhotos();
}

export async function setPrimaryProfilePhoto(photoId: string): Promise<ProfilePhoto[]> {
  if (!supabase) throw new Error('Supabase is not configured.');
  const { error } = await supabase.rpc('mark_primary_profile_photo', { p_photo_id: photoId });
  if (error) throw new Error(error.message);
  return loadProfilePhotos();
}

export async function reorderProfilePhotos(photoIds: string[]): Promise<ProfilePhoto[]> {
  if (!supabase) throw new Error('Supabase is not configured.');
  const { error } = await supabase.rpc('reorder_profile_photos', { p_photo_ids: photoIds });
  if (error) throw new Error(error.message);
  return loadProfilePhotos();
}
