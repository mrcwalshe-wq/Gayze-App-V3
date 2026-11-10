import assert from 'node:assert/strict';
import { test } from 'node:test';
import { decryptPhotoBytes, encryptPhotoBytes, fromB64u, generateAlbumKeyRaw, importAlbumKey, looksLikeImage, toB64u } from '../../src/services/albumCrypto';

test('a photo round-trips, and the stored bytes are not the photo', async () => {
  const key = await importAlbumKey(generateAlbumKeyRaw());
  const photo = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, ...Array.from({ length: 500 }, (_, i) => i % 251)]);
  const stored = await encryptPhotoBytes(key, photo);
  assert.equal(stored.length, 12 + photo.length + 16);
  assert.notDeepEqual(Array.from(stored.subarray(12, 20)), Array.from(photo.subarray(0, 8)));
  assert.deepEqual(Array.from(await decryptPhotoBytes(key, stored)), Array.from(photo));
});

test('the same photo encrypts differently each time (fresh nonce)', async () => {
  const key = await importAlbumKey(generateAlbumKeyRaw());
  const photo = new Uint8Array(64).fill(7);
  const a = await encryptPhotoBytes(key, photo), b = await encryptPhotoBytes(key, photo);
  assert.notDeepEqual(Array.from(a), Array.from(b));
});

test('a wrong key, or an altered file, is refused', async () => {
  const key = await importAlbumKey(generateAlbumKeyRaw());
  const other = await importAlbumKey(generateAlbumKeyRaw());
  const stored = await encryptPhotoBytes(key, new Uint8Array(100).fill(1));
  await assert.rejects(decryptPhotoBytes(other, stored));
  const tampered = stored.slice(); tampered[40] ^= 1;
  await assert.rejects(decryptPhotoBytes(key, tampered));
  await assert.rejects(decryptPhotoBytes(key, new Uint8Array(10)), /damaged/);
});

test('the key survives the trip through a message (base64url)', async () => {
  const raw = generateAlbumKeyRaw();
  const text = toB64u(raw);
  assert.match(text, /^[A-Za-z0-9_-]{43}$/);
  assert.deepEqual(Array.from(fromB64u(text)), Array.from(raw));
  const stored = await encryptPhotoBytes(await importAlbumKey(raw), new Uint8Array([1, 2, 3]));
  assert.deepEqual(Array.from(await decryptPhotoBytes(await importAlbumKey(fromB64u(text)), stored)), [1, 2, 3]);
});

test('only real raster images are drawn', () => {
  assert.equal(looksLikeImage(new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0])), 'image/jpeg');
  assert.equal(looksLikeImage(new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0, 0, 0, 0, 0])), 'image/png');
  assert.equal(looksLikeImage(new TextEncoder().encode('<svg onload="x()"></svg>')), null);
  assert.equal(looksLikeImage(new TextEncoder().encode('<script>alert(1)</script>')), null);
});
