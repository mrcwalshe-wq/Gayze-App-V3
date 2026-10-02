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

// In-memory cache for signed URLs to avoid redundant requests on re-renders
const signedUrlCache = new Map<string, { url: string; expiresAt: number }>();

const pendingSignedUrls = new Map<string, Promise<string>>();

export async function signedUrl(path: string): Promise<string> {
  const cached = signedUrlCache.get(path);
  if (cached && cached.expiresAt > Date.now()) {
    return cached.url;
  }
  const pending = pendingSignedUrls.get(path);
  if (pending) return pending;
  const work = requestSignedUrl(path);
  pendingSignedUrls.set(path, work);
  try { return await work; } finally { if (pendingSignedUrls.get(path) === work) pendingSignedUrls.delete(path); }
}

async function requestSignedUrl(path: string): Promise<string> {
  if (!supabase) throw new Error('Supabase is not configured.');
  const { data, error } = await supabase.storage.from(BUCKET).createSignedUrl(path, 60 * 60);
  if (error || !data?.signedUrl) throw new Error(error?.message || 'Could not load profile photo.');
  // Cache for 50 minutes (signed for 60)
  signedUrlCache.set(path, { url: data.signedUrl, expiresAt: Date.now() + 50 * 60 * 1000 });
  return data.signedUrl;
}

export async function getProfilePhotoUrl(storagePathOrUrl: string | null | undefined): Promise<string | null> {
  if (!storagePathOrUrl || storagePathOrUrl === 'user') return null;
  if (storagePathOrUrl.startsWith('http://') || storagePathOrUrl.startsWith('https://')) {
    return storagePathOrUrl;
  }
  try {
    return await signedUrl(storagePathOrUrl);
  } catch {
    return null;
  }
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
    extension: type === 'image/jpeg' ? 'jpg' : type.split('/')[1] || 'jpg',
  };
}

export async function loadProfilePhotos(): Promise<ProfilePhoto[]> {
  if (!supabase) return [];
  const { data, error } = await supabase
    .from('profile_photos')
    .select('id,user_id,storage_path,sort_order,is_primary')
    .order('sort_order', { ascending: true });

  if (error) {
    console.warn('[GAYZE] loadProfilePhotos error:', error.message);
    return [];
  }

  const photos: ProfilePhoto[] = [];
  for (const row of data ?? []) {
    try {
      const url = await signedUrl(row.storage_path);
      photos.push({
        id: row.id,
        userId: row.user_id,
        storagePath: row.storage_path,
        sortOrder: row.sort_order,
        isPrimary: Boolean(row.is_primary),
        url,
      });
    } catch {
      // If one image fails to sign, continue loading remaining photos
    }
  }
  return photos;
}

export async function uploadProfilePhoto(file: File): Promise<ProfilePhoto[]> {
  if (!supabase) throw new Error('Supabase is not configured.');
  const prepared = await prepareUpload(file);

  const { data: auth, error: authError } = await supabase.auth.getUser();
  if (authError || !auth?.user?.id) throw new Error('Please sign in again.');
  const userId = auth.user.id;

  const existing = await loadProfilePhotos();
  if (existing.length >= MAX_PHOTOS) throw new Error('You can add up to 6 profile photos.');

  const photoId = crypto.randomUUID();
  const path = `${userId}/${photoId}.${prepared.extension}`;

  const { error: uploadError } = await supabase.storage.from(BUCKET).upload(path, prepared.file, {
    contentType: prepared.contentType,
    upsert: false,
    cacheControl: '3600',
  });
  if (uploadError) throw new Error(uploadError.message);

  const isFirst = existing.length === 0;
  const { error: insertError } = await supabase.from('profile_photos').insert({
    user_id: userId,
    storage_path: path,
    sort_order: existing.length,
    is_primary: isFirst,
  });

  if (insertError) {
    await supabase.storage.from(BUCKET).remove([path]);
    throw new Error(insertError.message);
  }

  if (isFirst) {
    await supabase.from('profiles').update({ avatar_path: path }).eq('id', userId);
  }

  return loadProfilePhotos();
}

export async function deleteProfilePhoto(photo: ProfilePhoto): Promise<ProfilePhoto[]> {
  if (!supabase) throw new Error('Supabase is not configured.');
  signedUrlCache.delete(photo.storagePath);

  const { error } = await supabase.from('profile_photos').delete().eq('id', photo.id);
  if (error) throw new Error(error.message);

  await supabase.storage.from(BUCKET).remove([photo.storagePath]).catch(() => {});

  const remaining = await loadProfilePhotos();
  if (remaining.length > 0) {
    // If deleted photo was primary, or no photo is marked primary, promote the first remaining
    if (photo.isPrimary || !remaining.some((p) => p.isPrimary)) {
      return setPrimaryProfilePhoto(remaining[0].id);
    }
  } else {
    // No remaining photos: clear profiles.avatar_path
    const { data: auth } = await supabase.auth.getUser();
    if (auth?.user?.id) {
      await supabase.from('profiles').update({ avatar_path: null }).eq('id', auth.user.id);
    }
  }

  return remaining;
}

export async function setPrimaryProfilePhoto(photoId: string): Promise<ProfilePhoto[]> {
  if (!supabase) throw new Error('Supabase is not configured.');
  
  // Try RPC first
  const { error } = await supabase.rpc('mark_primary_profile_photo', { p_photo_id: photoId });
  if (error) {
    console.warn('[GAYZE] mark_primary_profile_photo RPC note:', error.message);
    const { data: auth } = await supabase.auth.getUser();
    if (auth?.user?.id) {
      await supabase.from('profile_photos').update({ is_primary: false }).eq('user_id', auth.user.id);
      await supabase.from('profile_photos').update({ is_primary: true }).eq('id', photoId);
    }
  }

  // Update profiles.avatar_path immediately so Discovery and Profile sync immediately
  const { data: photoRow } = await supabase
    .from('profile_photos')
    .select('storage_path, user_id')
    .eq('id', photoId)
    .maybeSingle();

  if (photoRow?.storage_path && photoRow?.user_id) {
    await supabase.from('profiles').update({ avatar_path: photoRow.storage_path }).eq('id', photoRow.user_id);
  }

  return loadProfilePhotos();
}

export async function reorderProfilePhotos(photoIds: string[]): Promise<ProfilePhoto[]> {
  if (!supabase) throw new Error('Supabase is not configured.');
  
  const { error } = await supabase.rpc('reorder_profile_photos', { p_photo_ids: photoIds });
  if (error) {
    for (let i = 0; i < photoIds.length; i++) {
      await supabase.from('profile_photos').update({ sort_order: i }).eq('id', photoIds[i]);
    }
  }

  // First photo in reordered list is treated as primary unless another is explicitly primary
  if (photoIds.length > 0) {
    return setPrimaryProfilePhoto(photoIds[0]);
  }

  return loadProfilePhotos();
}
