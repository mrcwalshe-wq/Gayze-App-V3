import test from 'node:test';
import assert from 'node:assert/strict';
import { discoveryRowsToPulses } from '../../src/services/discoveryPulses';
import type { RightNowDiscoveryRow } from '../../src/services/supabaseService';
const row = (over: Partial<RightNowDiscoveryRow>): RightNowDiscoveryRow => ({
  intent_id: 'i1', user_id: 'u1', display_name: 'Sam', age: 30, bio: null, avatar_path: null, neighborhood: 'Soho', mode: 'social', intent: 'Meet',
  description: null, expires_at: new Date(Date.now() + 3600_000).toISOString(), distance_m: 500, map_lat: 51.5, map_lng: -0.1, reliability_score: 0,
  verified_peers_count: 0, safety_verified: false, travel_distance_label: null, can_host: null, travel_willingness: null, ...over,
});
test('discovery rows carry activities, with a fallback for older databases', () => {
  const [a] = discoveryRowsToPulses([row({ activities: ['coffee', 'walks'], connections: ['new'] })]);
  assert.deepEqual(a.activities, ['coffee', 'walks']);
  assert.deepEqual(a.connections, ['new']);
  assert.equal(a.activityCategory, 'coffee');
  assert.equal(a.title, 'Coffee & conversation +1');
  const [b] = discoveryRowsToPulses([row({ intent: 'Hookup · Outdoor', mode: 'private' })]);
  assert.deepEqual(b.activities, ['walks']);
  assert.equal(b.activityCategory, 'walk');
  assert.ok(!/hookup|private/i.test(`${b.title} ${b.description}`), 'old wording never reaches the screen');
});
