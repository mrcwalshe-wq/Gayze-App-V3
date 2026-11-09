import { loadPeerPhotos } from './profilePhotoService';

/**
 * The photo to show for someone on a call screen. Their `profiles` row is private to them, so the photo comes from the
 * same place the profile card uses (profile_photos, which the database already limits to people who may see them).
 * Short-lived cache: signed links expire, so a hit is only trusted for a few minutes.
 */
const TTL_MS = 10 * 60_000;
const cache = new Map<string, { url: string | null; at: number }>();

export async function peerPhotoUrl(userId: string | undefined | null): Promise<string | null> {
  if (!userId) return null;
  const hit = cache.get(userId);
  if (hit && Date.now() - hit.at < TTL_MS) return hit.url;
  let url: string | null = null;
  try {
    const photos = await loadPeerPhotos(userId);
    url = (photos.find((p) => p.isPrimary) ?? photos[0])?.url ?? null;
  } catch { url = null; }
  if (url) cache.set(userId, { url, at: Date.now() });   // never cache "none": a photo may become visible a moment later
  return url;
}
