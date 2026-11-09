import test from 'node:test';
import assert from 'node:assert/strict';
import { formatCooldown, noteGayzeCooldown, gayzeCooldownRemaining } from '../../src/services/gayzeCooldown.ts';

test('a wait is shown in plain hours and minutes', () => {
  assert.equal(formatCooldown(18_720), '5h 12m');
  assert.equal(formatCooldown(86_400), '24h 0m');
  assert.equal(formatCooldown(3_600), '1h 0m');
  assert.equal(formatCooldown(2_520), '42m');
  assert.equal(formatCooldown(61), '2m');
  assert.equal(formatCooldown(59), 'under a minute');
  assert.equal(formatCooldown(0), 'under a minute');
  assert.equal(formatCooldown(3_599), '1h 0m', 'rounding up never prints 60m');
});

test('the reported wait is remembered and counts down', () => {
  const t0 = 1_000_000;
  noteGayzeCooldown(600, t0);
  assert.equal(gayzeCooldownRemaining(t0), 600);
  assert.equal(gayzeCooldownRemaining(t0 + 100_000), 500);
  assert.equal(gayzeCooldownRemaining(t0 + 600_000), 0);
  assert.equal(gayzeCooldownRemaining(t0 + 900_000), 0, 'never negative');
});
