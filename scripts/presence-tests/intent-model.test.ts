import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { ACTIVITIES, CONNECTIONS, cleanActivities, cleanConnections, activitySummary, makeMain } from '../../src/services/intentModel';

const sql = fs.readFileSync(new URL('../../supabase/migrations/20261108100000_intent_model_v2.sql', import.meta.url), 'utf8');
const listFrom = (marker: string) => {
  const m = sql.match(new RegExp(`${marker}[\\s\\S]*?array\\[([^\\]]+)\\]`));
  return m ? m[1].split(',').map((x) => x.trim().replace(/'/g, '')) : [];
};

test('the app\'s activity ids match the database check', () => {
  assert.deepEqual(ACTIVITIES.map((a) => a.id).sort(), listFrom('intents_activities_known').sort());
});
test('the app\'s connection ids match the database check', () => {
  assert.deepEqual(CONNECTIONS.map((c) => c.id).sort(), listFrom('intents_connections_known').sort());
});
test('unknown, duplicate and surplus values are dropped before saving', () => {
  assert.deepEqual(cleanActivities(['coffee', 'coffee', 'nope', 'walks']), ['coffee', 'walks']);
  assert.equal(cleanActivities(ACTIVITIES.map((a) => a.id)).length, 6);
  assert.deepEqual(cleanConnections(['new', 'x', 'dating', 'new']), ['new', 'dating']);
});
test('the summary line', () => {
  assert.equal(activitySummary([]), '');
  assert.equal(activitySummary(['coffee']), 'Coffee & conversation');
  assert.equal(activitySummary(['coffee', 'walks']), 'Coffee & conversation +1');
});
test('every back-filled activity in the migration is an allowed id', () => {
  const allowed = new Set(ACTIVITIES.map((a) => a.id));
  for (const m of sql.matchAll(/then array\['([a-z]+)'\]/g)) {
    if (['new', 'friends', 'dating', 'see', 'social'].includes(m[1]) && !allowed.has(m[1] as never)) continue; // connection list
    assert.ok(allowed.has(m[1] as never) || ['new', 'friends', 'dating', 'social'].includes(m[1]), `unknown id ${m[1]}`);
  }
});

import { legacyActivityFor } from '../../src/services/intentModel';
test('older signals without saved activities map to the closest activity', () => {
  assert.deepEqual(legacyActivityFor('Drinks'), ['drinks']);
  assert.deepEqual(legacyActivityFor('Hookup · Outdoor'), ['walks']);
  assert.deepEqual(legacyActivityFor('Hookup'), ['spontaneous']);
  assert.deepEqual(legacyActivityFor(undefined), ['spontaneous']);
});

test('makeMain moves one pick to the front and keeps the rest in order', () => {
  assert.deepEqual(makeMain(['coffee', 'food', 'music'], 'music'), ['music', 'coffee', 'food']);
  assert.deepEqual(makeMain(['coffee', 'food'], 'coffee'), ['coffee', 'food']);
  assert.deepEqual(makeMain(['coffee', 'food'], 'walks'), ['coffee', 'food']);
});
