/**
 * Private album encryption. Photos are encrypted on the phone with a random per-album AES-256-GCM key before they are uploaded,
 * so the server only ever stores ciphertext. Pure functions on top of WebCrypto: they run in the browser and in Node.
 */
const subtle = () => globalThis.crypto.subtle;

export const toB64u = (bytes: Uint8Array): string => {
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
};

export const fromB64u = (text: string): Uint8Array => {
  const b64 = text.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((text.length + 3) % 4);
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i += 1) out[i] = bin.charCodeAt(i);
  return out;
};

/** A new random album key, as raw bytes (32 bytes). */
export const generateAlbumKeyRaw = (): Uint8Array => globalThis.crypto.getRandomValues(new Uint8Array(32));

export const importAlbumKey = (raw: Uint8Array, extractable = false): Promise<CryptoKey> =>
  subtle().importKey('raw', raw as unknown as BufferSource, { name: 'AES-GCM' }, extractable, ['encrypt', 'decrypt']);

/** Output layout: 12-byte random nonce, then the ciphertext (which ends in the 16-byte authentication tag). */
export async function encryptPhotoBytes(key: CryptoKey, bytes: Uint8Array): Promise<Uint8Array> {
  const nonce = globalThis.crypto.getRandomValues(new Uint8Array(12));
  const ct = new Uint8Array(await subtle().encrypt({ name: 'AES-GCM', iv: nonce as unknown as BufferSource, tagLength: 128 }, key, bytes as unknown as BufferSource));
  const out = new Uint8Array(12 + ct.length);
  out.set(nonce, 0); out.set(ct, 12);
  return out;
}

/** Throws if the key is wrong or the bytes were altered. */
export async function decryptPhotoBytes(key: CryptoKey, blob: Uint8Array): Promise<Uint8Array> {
  if (blob.length < 12 + 16) throw new Error('This photo is damaged.');
  const nonce = blob.subarray(0, 12);
  const pt = await subtle().decrypt({ name: 'AES-GCM', iv: nonce as unknown as BufferSource, tagLength: 128 }, key, blob.subarray(12) as unknown as BufferSource);
  return new Uint8Array(pt);
}

export const dataUrlToBytes = (dataUrl: string): { bytes: Uint8Array; mime: string } => {
  const m = /^data:([a-z0-9.+/-]+);base64,(.*)$/i.exec(dataUrl);
  if (!m) throw new Error('That is not a photo.');
  const bin = atob(m[2]);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i += 1) bytes[i] = bin.charCodeAt(i);
  return { bytes, mime: m[1] };
};

/** What the viewer is willing to draw: a real raster image, never script or SVG. */
export const looksLikeImage = (bytes: Uint8Array): 'image/jpeg' | 'image/png' | 'image/webp' | null => {
  if (bytes.length > 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return 'image/jpeg';
  if (bytes.length > 8 && bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) return 'image/png';
  if (bytes.length > 12 && bytes[0] === 0x52 && bytes[1] === 0x49 && bytes[2] === 0x46 && bytes[3] === 0x46 && bytes[8] === 0x57 && bytes[9] === 0x45) return 'image/webp';
  return null;
};
