import test from 'node:test';
import assert from 'node:assert/strict';
import { snackKind } from '../../src/components/Snack.tsx';

test('a Gayze cooldown is a calm wait, not a success and not an error', () => {
  for (const m of ['GAYZE already sent. Try again in 17h 2m.', 'You can send your next Gayze in 5h 12m.', 'GAYZE already sent. You can send another in 42m.']) {
    assert.equal(snackKind(m), 'wait', m);
  }
});

test('the other tones still read from the wording', () => {
  assert.equal(snackKind('Gayze request could not be sent. Try again.'), 'error');
  assert.equal(snackKind('Gayze request sent to Chris — awaiting their response.'), 'success');
  assert.equal(snackKind('Gathering created. You are hosting.'), 'success');
  assert.equal(snackKind('Sending…'), 'info');
  assert.equal(snackKind('Your intent is paused'), 'paused');
});
