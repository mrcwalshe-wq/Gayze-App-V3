import test from 'node:test';
import assert from 'node:assert/strict';
import { reconcileArchive } from '../../src/services/chatArchiveModel.ts';

const A = '11111111-1111-4111-8111-111111111111', B = '22222222-2222-4222-8222-222222222222', C = '33333333-3333-4333-8333-333333333333';

test('the account list is what shows when nothing is pending', () => {
  const plan = reconcileArchive([A, B], [], {}, true);
  assert.deepEqual([...plan.archived].sort(), [A, B]);
  assert.deepEqual(plan.toArchive, []);
});

test('a list archived on this device before the account kept one is sent up once', () => {
  const plan = reconcileArchive([A], [A, B, 'not-a-chat'], {}, false);
  assert.deepEqual([...plan.archived].sort(), [A, B]);
  assert.deepEqual(plan.toArchive, [B]);
  // After that, local-only entries are not resurrected.
  assert.deepEqual([...reconcileArchive([A], [A, B], {}, true).archived], [A]);
});

test('changes made offline win over the account and are sent up', () => {
  const plan = reconcileArchive([A, B], [A, B], { [A]: false, [C]: true }, true);
  assert.deepEqual([...plan.archived].sort(), [B, C]);
  assert.deepEqual(plan.toArchive, [C]);
  assert.deepEqual(plan.toRestore, [A]);
});
