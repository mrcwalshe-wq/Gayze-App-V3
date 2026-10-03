/**
 * Profile-photo signed-URL cache regression tests (real profilePhotoService,
 * Supabase Storage calls routed to a counting fetch stub).
 * Run: npx tsx --import ./scripts/profile-tests/register-hooks.mjs scripts/profile-tests/photo-cache.test.mjs
 */
import assert from 'node:assert/strict';

globalThis.__GAYZE_VITE_ENV__ = {
  VITE_SUPABASE_URL: 'http://127.0.0.1:54321',
  VITE_SUPABASE_PUBLISHABLE_KEY: 'sb_publishable_test',
};

const signCalls = [];
globalThis.fetch = async (input) => {
  const url = String(typeof input === 'string' ? input : input?.url ?? '');
  const marker = '/object/sign/profile-photos/';
  if (url.includes(marker)) {
    const path = decodeURIComponent(url.split(marker)[1].split('?')[0]);
    signCalls.push(path);
    return new Response(JSON.stringify({ signedURL: `/object/sign/profile-photos/${path}?token=t${signCalls.length}` }),
      { status: 200, headers: { 'content-type': 'application/json' } });
  }
  return new Response('{}', { status: 404 });
};

const { getProfilePhotoUrl, signedUrl } = await import('../../src/services/profilePhotoService.ts');
const avatar = (user, path) => `gayze-user-avatar:${user}:${path}`;

// Two users whose avatar_path values are identical/legacy must not collide.
const SHARED = 'shared/photo.jpg';
const [a, b] = await Promise.all([
  getProfilePhotoUrl(avatar('user-a', SHARED)),
  getProfilePhotoUrl(avatar('user-b', SHARED)),
]);
assert.ok(a && b);
assert.notEqual(a, b, 'identical paths for different users resolve independently (no cross-user cache pollution)');
assert.equal(signCalls.length, 2);

// Cache hits per user; rerenders / reorders / reloads do not re-fetch.
const before = signCalls.length;
for (const id of ['user-a', 'user-b', 'user-a', 'user-b']) await getProfilePhotoUrl(avatar(id, SHARED));
assert.equal(signCalls.length, before, 'repeat resolution (rerender/reorder/reload) is a cache hit');
assert.equal(await getProfilePhotoUrl(avatar('user-a', SHARED)), a);
assert.equal(await getProfilePhotoUrl(avatar('user-b', SHARED)), b);

// Distinct users with distinct photos, resolved in two different orders.
const paths = { u1: 'u1/1.jpg', u2: 'u2/2.jpg', u3: 'u3/3.jpg' };
const first = {};
for (const id of Object.keys(paths)) first[id] = await getProfilePhotoUrl(avatar(id, paths[id]));
const count = signCalls.length;
for (const id of Object.keys(paths).reverse()) assert.equal(await getProfilePhotoUrl(avatar(id, paths[id])), first[id]);
assert.equal(signCalls.length, count, 'reordering does not corrupt or refetch the cache');
assert.equal(new Set(Object.values(first)).size, 3);

// Unscoped legacy callers are still scoped by the path owner segment.
const legacy1 = await signedUrl('u1/1.jpg');
assert.equal(legacy1, first.u1);
assert.notEqual(await signedUrl('u2/2.jpg'), first.u1);

// Concurrent loads share a single in-flight request.
const n = signCalls.length;
await Promise.all(Array.from({ length: 5 }, () => getProfilePhotoUrl(avatar('u9', 'u9/9.jpg'))));
assert.equal(signCalls.length, n + 1);

console.log('PROFILE PHOTO CACHE TESTS: ALL PASSED');
process.exit(0);
