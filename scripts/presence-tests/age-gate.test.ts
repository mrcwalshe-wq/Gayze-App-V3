import test from 'node:test';
import assert from 'node:assert/strict';
import { ageFromDob, isAdultDob, recordUnderageAttempt, underageBlockActive } from '../../src/services/ageGate';

const now = new Date('2026-11-08T12:00:00Z');

test('age counts whole years and respects the birthday', () => {
  assert.equal(ageFromDob('2008-11-08', now), 18);
  assert.equal(ageFromDob('2008-11-09', now), 17);
  assert.equal(ageFromDob('2000-02-29', now), 26);
});
test('bad or future dates are rejected', () => {
  assert.equal(ageFromDob('', now), null);
  assert.equal(ageFromDob('2026-13-01', now), null);
  assert.equal(ageFromDob('2002-02-30', now), null);
  assert.equal(ageFromDob('2030-01-01', now), null);
});
test('only 18 to 120 passes', () => {
  assert.equal(isAdultDob('2008-11-08', now), true);
  assert.equal(isAdultDob('2008-11-09', now), false);
  assert.equal(isAdultDob('1890-01-01', now), false);
});
test('an under-18 attempt blocks the device for 24 hours', () => {
  const m = new Map<string, string>();
  const s = { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => { m.set(k, v); } };
  assert.equal(underageBlockActive(1000, s), false);
  recordUnderageAttempt(1000, s);
  assert.equal(underageBlockActive(1000 + 23 * 3600e3, s), true);
  assert.equal(underageBlockActive(1000 + 25 * 3600e3, s), false);
});
