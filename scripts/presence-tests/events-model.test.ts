import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { eventDefaultTime, EVENT_CATEGORIES, categoryKey, quickTime } from '../../src/services/eventsModel';

const sql = fs.readFileSync(new URL('../../supabase/migrations/20261108130000_event_categories.sql', import.meta.url), 'utf8');

test('the six categories are all allowed by the database check', () => {
  for (const c of EVENT_CATEGORIES) assert.ok(sql.includes(`'${c}'`), c);
});
test('older categories read as their new equivalent, and unknown ones as social', () => {
  assert.equal(categoryKey('active'), 'outdoor');
  assert.equal(categoryKey('nightlife'), 'music');
  assert.equal(categoryKey('arts'), 'games');
  assert.equal(categoryKey('discussions'), 'social');
  assert.equal(categoryKey('fitness'), 'fitness');
  assert.equal(categoryKey('whatever'), 'social');
});
test('every quick plan time is in the future, on the right day and hour', () => {
  // Wed 12 Nov 2026 14:00 local, then a Saturday evening and a Sunday afternoon
  for (const from of [new Date(2026, 10, 11, 14, 0), new Date(2026, 10, 14, 22, 30), new Date(2026, 10, 15, 15, 0), new Date(2026, 10, 14, 8, 0)]) {
    for (const w of ['hour', 'tonight', 'tomorrow', 'weekend', 'sunday'] as const) {
      assert.ok(quickTime(w, from) > from.getTime() + 25 * 60_000, `${w} from ${from.toString()}`);
    }
    const sun = new Date(quickTime('sunday', from)); assert.equal(sun.getDay(), 0); assert.equal(sun.getHours(), 11);
    const sat = new Date(quickTime('weekend', from)); assert.equal(sat.getDay(), 6); assert.equal(sat.getHours(), 21);
    const tom = new Date(quickTime('tomorrow', from)); assert.equal(tom.getHours(), 12);
  }
  const wed = new Date(2026, 10, 11, 14, 0);
  assert.equal(new Date(quickTime('tonight', wed)).getHours(), 19);
  assert.equal(new Date(quickTime('tonight', new Date(2026, 10, 11, 20, 0))).getTime(), new Date(2026, 10, 11, 20, 0).getTime() + 90 * 60_000);
});

test('a new event never opens with an empty or past time', () => {
  for (const from of [new Date(2026, 10, 11, 9, 0), new Date(2026, 10, 11, 18, 59), new Date(2026, 10, 11, 19, 30), new Date(2026, 10, 11, 23, 59), new Date(2026, 10, 14, 0, 5)]) {
    const t = eventDefaultTime(from);
    assert.ok(t >= from.getTime() + 60 * 60_000, `at least an hour ahead from ${from.toString()}`);
    assert.equal(new Date(t).getHours(), 20);
    assert.equal(new Date(t).getMinutes(), 0);
  }
  assert.equal(new Date(eventDefaultTime(new Date(2026, 10, 11, 9, 0))).getDate(), 11, 'morning: tonight');
  assert.equal(new Date(eventDefaultTime(new Date(2026, 10, 11, 19, 30))).getDate(), 12, 'under an hour to 20:00: tomorrow');
});
