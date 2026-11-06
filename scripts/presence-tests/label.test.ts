import test from 'node:test';
import assert from 'node:assert/strict';
import { presenceLabel } from '../../src/services/presenceLabel.ts';

const now = Date.UTC(2026, 10, 6, 12, 0, 0);
const ago = (m: number) => now - m * 60_000;

test('online is green and wins over any last-seen time', () => {
  assert.deepEqual(presenceLabel(true, ago(500), now), { tone: 'online', text: 'Online now' });
});

test('amber tiers: 5 min, 30 min, hour, then recently online for up to a day', () => {
  assert.deepEqual(presenceLabel(false, ago(0), now), { tone: 'recent', text: 'Active in the last 5 min' });
  assert.deepEqual(presenceLabel(false, ago(4), now), { tone: 'recent', text: 'Active in the last 5 min' });
  assert.deepEqual(presenceLabel(false, ago(5), now), { tone: 'recent', text: 'Active in the last 30 min' });
  assert.deepEqual(presenceLabel(false, ago(29), now), { tone: 'recent', text: 'Active in the last 30 min' });
  assert.deepEqual(presenceLabel(false, ago(30), now), { tone: 'recent', text: 'Active in the last hour' });
  assert.deepEqual(presenceLabel(false, ago(59), now), { tone: 'recent', text: 'Active in the last hour' });
  assert.deepEqual(presenceLabel(false, ago(60), now), { tone: 'recent', text: 'Recently online' });
  assert.deepEqual(presenceLabel(false, ago(23 * 60 + 59), now), { tone: 'recent', text: 'Recently online' });
});

test('grey after a day, with no time at all when it is hidden', () => {
  const day = presenceLabel(false, ago(24 * 60), now);
  assert.equal(day.tone, 'offline');
  assert.match(day.text, /^Offline · last seen /);
  assert.deepEqual(presenceLabel(false, undefined, now), { tone: 'offline', text: 'Offline' });
});

test('a last-seen slightly in the future (clock skew) counts as just now', () => {
  assert.equal(presenceLabel(false, now + 30_000, now).text, 'Active in the last 5 min');
});
