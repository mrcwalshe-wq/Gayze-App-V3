import test from 'node:test';
import assert from 'node:assert/strict';
import { mergeOnlineIds } from '../../src/services/presenceLabel';

const m = (o: Record<string, 'online' | 'away' | 'offline' | 'hidden'>) => new Map(Object.entries(o).map(([k, v]) => [k, { status: v }]));

test('someone the live channel sees is online even while the server poll is stale', () => {
  assert.deepEqual([...mergeOnlineIds(new Set(['a']), m({ a: 'offline' }))], ['a']);
  assert.deepEqual([...mergeOnlineIds(new Set(['a']), m({ a: 'away' }))], ['a']);
});
test('the server saying online is enough on its own', () => {
  assert.deepEqual([...mergeOnlineIds(new Set(), m({ b: 'online' }))], ['b']);
});
test('hidden always wins, even over the live channel', () => {
  assert.deepEqual([...mergeOnlineIds(new Set(['c']), m({ c: 'hidden' }))], []);
});
