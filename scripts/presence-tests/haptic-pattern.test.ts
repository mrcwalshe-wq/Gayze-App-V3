import test from 'node:test';
import assert from 'node:assert/strict';
import { hapticStepsFor } from '../../src/services/hapticPattern';

test('a single short pulse is one light tap', () => {
  assert.deepEqual(hapticStepsFor([25]), [{ at: 0, style: 'LIGHT' }]);
  assert.deepEqual(hapticStepsFor(35), [{ at: 0, style: 'LIGHT' }]);
});
test('buzzes become timed taps and pauses are skipped, strength follows length', () => {
  assert.deepEqual(hapticStepsFor([60, 40, 60]), [{ at: 0, style: 'MEDIUM' }, { at: 100, style: 'MEDIUM' }]);
  assert.deepEqual(hapticStepsFor([200, 100, 200, 100, 300, 150]), [
    { at: 0, style: 'HEAVY' }, { at: 300, style: 'HEAVY' }, { at: 600, style: 'HEAVY' },
  ]);
});
test('zero-length buzzes are ignored', () => {
  assert.deepEqual(hapticStepsFor([0, 50, 0]), []);
});
