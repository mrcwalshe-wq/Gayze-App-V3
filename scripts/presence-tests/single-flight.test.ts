import test from 'node:test';
import assert from 'node:assert/strict';
import { singleFlight } from '../../src/services/singleFlight';

test('overlapping calls share one run and one result', async () => {
  const run = singleFlight<number>();
  let runs = 0;
  const task = async () => { runs += 1; await new Promise((r) => setTimeout(r, 20)); return runs; };
  const [a, b, c] = await Promise.all([run('k', task), run('k', task), run('k', task)]);
  assert.equal(runs, 1);
  assert.deepEqual([a, b, c], [1, 1, 1]);
});
test('a later call after it finishes runs again, and a failure is not remembered', async () => {
  const run = singleFlight<number>();
  let runs = 0;
  await assert.rejects(run('k', async () => { runs += 1; throw new Error('x'); }));
  assert.equal(await run('k', async () => { runs += 1; return 7; }), 7);
  assert.equal(runs, 2);
});
