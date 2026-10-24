import assert from 'node:assert/strict';
import { test } from 'node:test';
import { loadModule } from '../recovery-tests/load-module.mjs';
const { orderPeerPhotos, pickHighlights, shortFacts, isUuid, isLongBio } = await loadModule('src/services/profilePeek.ts');

const row = (id, path, order, primary = false) => ({ id, storage_path: path, sort_order: order, is_primary: primary });

test('primary photo leads, then the owner order; duplicates by path are dropped', () => {
  const out = orderPeerPhotos([row('c', 'p/c', 2), row('a', 'p/a', 0), row('b', 'p/b', 1, true), row('a2', 'p/a', 5)]);
  assert.deepEqual(out.map((r) => r.id), ['b', 'a', 'c']);
});

test('no visible photos gives an empty list (what row-level security returns)', () => {
  assert.deepEqual(orderPeerPhotos([]), []);
});

test('shared interests come first and are flagged, case-insensitively', () => {
  const { chips, sharedCount } = pickHighlights(
    { lookingFor: ['Dates', 'Friends'], hobbies: ['Climbing', 'Cooking', 'Film'] },
    { lookingFor: ['friends'], hobbies: ['film', 'Gaming'] },
  );
  assert.equal(sharedCount, 2);
  assert.deepEqual(chips.map((c) => c.label), ['Friends', 'Film', 'Dates', 'Climbing', 'Cooking']);
  assert.deepEqual(chips.map((c) => c.shared), [true, true, false, false, false]);
});

test('without a viewer nothing is marked shared and the limit applies', () => {
  const { chips, sharedCount } = pickHighlights({ lookingFor: ['a', 'b', 'c'], hobbies: ['d', 'e', 'f'] }, null, 4);
  assert.equal(sharedCount, 0);
  assert.equal(chips.length, 4);
  assert.ok(chips.every((c) => !c.shared));
});

test('duplicates and blanks are ignored', () => {
  const { chips } = pickHighlights({ lookingFor: ['Dates', 'dates', ' '], hobbies: ['Dates'] }, null);
  assert.deepEqual(chips.map((c) => c.label), ['Dates']);
});

test('short facts skip anything missing', () => {
  assert.deepEqual(shortFacts({ pronouns: 'he/him', heightCm: 182 }), ['he/him', '182 cm']);
  assert.deepEqual(shortFacts({}), []);
});

test('uuid guard and long-bio check', () => {
  assert.equal(isUuid('2f6a1c0e-1111-4222-8333-444455556666'), true);
  assert.equal(isUuid('room_abc'), false);
  assert.equal(isUuid(undefined), false);
  assert.equal(isLongBio('x'.repeat(141)), true);
  assert.equal(isLongBio('short'), false);
});
