import assert from 'node:assert/strict';
import { test } from 'node:test';
import { albumLineText, decodePayload, encodePayload, sanitizeAlbum } from '../../src/services/meetupWire';

const SHARE = { shareId: '5f0b6f2e-1c3d-4e5f-8a9b-0c1d2e3f4a5b', name: 'Beach', count: 6, key: 'A'.repeat(43), expiresAt: 1_900_000_000_000 };

test('an album survives the trip through an encrypted message body', () => {
  const body = encodePayload(albumLineText(SHARE), undefined, undefined, undefined, undefined, SHARE);
  const decoded = decodePayload(body, Date.now());
  assert.deepEqual(decoded.album, SHARE);
  assert.equal(decoded.text, 'Private album: Beach (6 photos)');
});

test('plain text is untouched, and an album never turns a normal message into JSON', () => {
  assert.equal(encodePayload('hello'), 'hello');
  assert.deepEqual(decodePayload('hello', 0), { text: 'hello' });
});

test('a peer album reference is untrusted: bad ids, keys and sizes are refused or clamped', () => {
  assert.equal(sanitizeAlbum({ ...SHARE, shareId: 'not-a-uuid' }), undefined);
  assert.equal(sanitizeAlbum({ ...SHARE, key: 'short' }), undefined);
  assert.equal(sanitizeAlbum({ ...SHARE, key: 'A'.repeat(42) + '!' }), undefined);
  assert.equal(sanitizeAlbum(null), undefined);
  assert.equal(sanitizeAlbum({ ...SHARE, count: 9999 })!.count, 30);
  assert.equal(sanitizeAlbum({ ...SHARE, count: -4 })!.count, 1);
  assert.equal(sanitizeAlbum({ ...SHARE, name: '<b>x</b>\n'.repeat(40) })!.name.length <= 60, true);
  assert.equal(sanitizeAlbum({ ...SHARE, expiresAt: 'soon' })!.expiresAt, undefined);
  assert.equal(sanitizeAlbum({ ...SHARE, shareId: SHARE.shareId.toUpperCase() })!.shareId, SHARE.shareId);
});

test('older app versions still see readable text for an album message', () => {
  const body = encodePayload(albumLineText({ ...SHARE, count: 1 }), undefined, undefined, undefined, undefined, { ...SHARE, count: 1 });
  assert.equal(JSON.parse(body).text, 'Private album: Beach (1 photo)');
});
