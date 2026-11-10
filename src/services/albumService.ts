import { supabase } from './supabaseClient';
import { getOrCreateDeviceIdentity, unwrapConversationKey, wrapConversationKey } from './cryptoService';
import { compressImageDataUrl } from './imageCompress';
import { dataUrlToBytes, decryptPhotoBytes, encryptPhotoBytes, fromB64u, generateAlbumKeyRaw, importAlbumKey, looksLikeImage, toB64u } from './albumCrypto';
import type { AlbumShare } from '../types';

const BUCKET = 'album-photos';
export const MAX_ALBUMS = 10;
export const MAX_ALBUM_PHOTOS = 30;
const ALBUM_PHOTO_BYTES = 650_000;

export interface AlbumSummary { id: string; name: string; count: number; createdAt: string }
export interface AlbumPhotoRow { id: string; path: string }
export interface AlbumShareRow { id: string; recipientName: string; createdAt: string; expiresAt: string | null; active: boolean }
export type SharedAlbumResult =
  | { status: 'unavailable' }
  | { status: 'ok'; name: string; expiresAt: number | null; photos: { id: string; url: string }[] };

/** Friendly text for the errors the database raises. */
export function albumErrorMessage(error: unknown): string {
  const m = (error as { message?: string })?.message || '';
  if (m.includes('ALBUM_LIMIT_ALBUMS')) return `You can keep up to ${MAX_ALBUMS} albums. Delete one to make another.`;
  if (m.includes('ALBUM_LIMIT_PHOTOS')) return `An album holds up to ${MAX_ALBUM_PHOTOS} photos.`;
  if (m.includes('ALBUM_EMPTY')) return 'Add at least one photo before sharing.';
  if (m.includes('ALBUM_DIRECT_ONLY')) return 'Albums can only be shared in a chat with one other person.';
  if (m.includes('GAYZE_BLOCKED_USER')) return "You can't share with this person.";
  return 'Something went wrong. Please try again.';
}

const isMissing = (error: { code?: string; message?: string } | null) =>
  !!error && (error.code === '42P01' || error.code === 'PGRST205' || error.code === '42883' || error.code === 'PGRST202' || /does not exist|schema cache/i.test(error.message || ''));

/** False until the albums migration has been applied, so the app can say "being set up" instead of failing. */
export async function albumsAvailable(): Promise<boolean> {
  if (!supabase) return false;
  const { error } = await supabase.from('albums').select('id').limit(1);
  return !isMissing(error);
}

async function myIdentity(userId: string) { return getOrCreateDeviceIdentity(userId); }

async function albumKey(userId: string, albumId: string): Promise<CryptoKey> {
  if (!supabase) throw new Error('offline');
  const { data, error } = await supabase.from('albums').select('wrapped_key,wrap_nonce').eq('id', albumId).maybeSingle();
  if (error || !data) throw new Error('This album could not be opened.');
  const id = await myIdentity(userId);
  try { return await unwrapConversationKey(`album:${albumId}`, data.wrapped_key, data.wrap_nonce, id.publicKeyJwk); }
  catch { throw new Error('This album was made on another device, so it is locked on this one.'); }
}

export async function listAlbums(): Promise<AlbumSummary[]> {
  if (!supabase) return [];
  const { data, error } = await supabase.from('albums').select('id,name,created_at,album_photos(count)').order('created_at', { ascending: false });
  if (error || !data) throw error ?? new Error('Could not load albums');
  return data.map((a: any) => ({ id: a.id, name: a.name, createdAt: a.created_at, count: a.album_photos?.[0]?.count ?? 0 }));
}

export async function createAlbum(userId: string, name: string): Promise<string> {
  if (!supabase) throw new Error('offline');
  const raw = generateAlbumKeyRaw();
  const id = crypto.randomUUID();
  const ident = await myIdentity(userId);
  const key = await importAlbumKey(raw, true);
  const wrapped = await wrapConversationKey(`album:${id}`, key, ident.publicKeyJwk);
  const { error } = await supabase.from('albums').insert({ id, owner_id: userId, name: name.trim().slice(0, 60), wrapped_key: wrapped.wrappedKeyHex, wrap_nonce: wrapped.nonceHex });
  if (error) throw error;
  return id;
}

export async function renameAlbum(albumId: string, name: string): Promise<void> {
  if (!supabase) return;
  const { error } = await supabase.from('albums').update({ name: name.trim().slice(0, 60), updated_at: new Date().toISOString() }).eq('id', albumId);
  if (error) throw error;
}

export async function deleteAlbum(albumId: string): Promise<void> {
  if (!supabase) return;
  const { data: rows } = await supabase.from('album_photos').select('storage_path').eq('album_id', albumId);
  const paths = (rows ?? []).map((r: { storage_path: string }) => r.storage_path);
  if (paths.length) await supabase.storage.from(BUCKET).remove(paths);
  const { error } = await supabase.from('albums').delete().eq('id', albumId);
  if (error) throw error;
}

export async function listAlbumPhotos(albumId: string): Promise<AlbumPhotoRow[]> {
  if (!supabase) return [];
  const { data, error } = await supabase.from('album_photos').select('id,storage_path,position,created_at').eq('album_id', albumId).order('position').order('created_at');
  if (error || !data) throw error ?? new Error('Could not load photos');
  return data.map((r: { id: string; storage_path: string }) => ({ id: r.id, path: r.storage_path }));
}

async function downloadAndDecrypt(path: string, key: CryptoKey): Promise<string> {
  if (!supabase) throw new Error('offline');
  const { data, error } = await supabase.storage.from(BUCKET).download(path);
  if (error || !data) throw new Error('A photo could not be loaded.');
  const bytes = await decryptPhotoBytes(key, new Uint8Array(await data.arrayBuffer()));
  const mime = looksLikeImage(bytes);
  if (!mime) throw new Error('A photo could not be read.');
  return URL.createObjectURL(new Blob([bytes as unknown as BlobPart], { type: mime }));
}

/** The owner's view of their own album. Returned URLs are local blob URLs; call revoke when done. */
export async function loadOwnPhotoUrls(userId: string, albumId: string, photos: AlbumPhotoRow[]): Promise<Record<string, string>> {
  const key = await albumKey(userId, albumId);
  const out: Record<string, string> = {};
  await Promise.all(photos.map(async (p) => { try { out[p.id] = await downloadAndDecrypt(p.path, key); } catch { /* shown as a placeholder */ } }));
  return out;
}

export async function addAlbumPhoto(userId: string, albumId: string, file: File, position: number): Promise<void> {
  if (!supabase) throw new Error('offline');
  const dataUrl = await new Promise<string>((resolve, reject) => { const r = new FileReader(); r.onload = () => resolve(String(r.result)); r.onerror = () => reject(new Error('The photo could not be read.')); r.readAsDataURL(file); });
  const small = await compressImageDataUrl(dataUrl, 1600, ALBUM_PHOTO_BYTES);
  const { bytes } = dataUrlToBytes(small);
  const key = await albumKey(userId, albumId);
  const stored = await encryptPhotoBytes(key, bytes);
  const photoId = crypto.randomUUID();
  const path = `${userId}/${albumId}/${photoId}.bin`;
  const up = await supabase.storage.from(BUCKET).upload(path, new Blob([stored as unknown as BlobPart], { type: 'application/octet-stream' }), { contentType: 'application/octet-stream', upsert: false });
  if (up.error) throw up.error;
  const { error } = await supabase.from('album_photos').insert({ id: photoId, album_id: albumId, owner_id: userId, storage_path: path, position });
  if (error) { await supabase.storage.from(BUCKET).remove([path]); throw error; }
}

export async function removeAlbumPhoto(photo: AlbumPhotoRow): Promise<void> {
  if (!supabase) return;
  await supabase.storage.from(BUCKET).remove([photo.path]);
  const { error } = await supabase.from('album_photos').delete().eq('id', photo.id);
  if (error) throw error;
}

/** Sharing: ask the server for a share, then hand back what goes in the chat message. */
export async function createShare(userId: string, album: AlbumSummary, conversationId: string, expiresAt: Date | null): Promise<{ shareId: string; payload: AlbumShare }> {
  if (!supabase) throw new Error('offline');
  const key = await albumKey(userId, album.id);
  const raw = new Uint8Array(await crypto.subtle.exportKey('raw', key));
  const { data, error } = await supabase.rpc('share_album', { p_album_id: album.id, p_conversation_id: conversationId, p_expires_at: expiresAt ? expiresAt.toISOString() : null });
  if (error || !data) throw error ?? new Error('Could not share');
  return { shareId: data as string, payload: { shareId: data as string, name: album.name, count: album.count, key: toB64u(raw), ...(expiresAt ? { expiresAt: expiresAt.getTime() } : {}) } };
}

export async function linkShareMessage(shareId: string, messageId: string): Promise<void> {
  if (!supabase) return;
  await supabase.rpc('link_album_share_message', { p_share_id: shareId, p_message_id: messageId });
}

export async function revokeShare(shareId: string): Promise<void> {
  if (!supabase) return;
  const { error } = await supabase.rpc('revoke_album_share', { p_share_id: shareId });
  if (error) throw error;
}

export async function listShares(albumId: string): Promise<AlbumShareRow[]> {
  if (!supabase) return [];
  const { data, error } = await supabase.rpc('list_album_shares', { p_album_id: albumId });
  if (error || !Array.isArray(data)) return [];
  return data.map((s: any) => ({ id: s.id, recipientName: s.recipientName, createdAt: s.createdAt, expiresAt: s.expiresAt, active: !!s.active }));
}

/** The recipient's view. Decrypts on this phone; the server decides whether the files can be fetched at all. */
export async function openSharedAlbum(share: AlbumShare): Promise<SharedAlbumResult> {
  if (!supabase) return { status: 'unavailable' };
  const { data, error } = await supabase.rpc('get_shared_album', { p_share_id: share.shareId });
  if (error || !data || (data as { status: string }).status !== 'ok') return { status: 'unavailable' };
  const r = data as { name: string; expiresAt: string | null; photos: { id: string; path: string }[] };
  const key = await importAlbumKey(fromB64u(share.key));
  const photos: { id: string; url: string }[] = [];
  await Promise.all(r.photos.map(async (p) => { try { photos.push({ id: p.id, url: await downloadAndDecrypt(p.path, key) }); } catch { /* skipped */ } }));
  const order = new Map(r.photos.map((p, i) => [p.id, i]));
  photos.sort((a, b) => (order.get(a.id) ?? 0) - (order.get(b.id) ?? 0));
  if (!photos.length) return { status: 'unavailable' };
  return { status: 'ok', name: r.name, expiresAt: r.expiresAt ? Date.parse(r.expiresAt) : null, photos };
}
