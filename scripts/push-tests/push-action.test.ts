/**
 * What a notification tap hands to the web layer (src/services/pushAction.ts).
 *   npx tsx --test scripts/push-tests/push-action.test.ts
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { parsePushAction } from '../../src/services/pushAction.ts';

const ID = '11111111-1111-4111-8111-111111111111';
const INTEREST = 'ABCDEF12-3456-4789-8ABC-DEF012345678';

test('a received Gayze Accept keeps the interest id (lower-cased) and the notification', () => {
  assert.deepEqual(parsePushAction({ action: 'accept', type: 'gaze', notificationId: ID, interestId: INTEREST, url: `/notifications?notification=${ID}&recipient=${ID}` }),
    { action: 'accept', type: 'gaze', notificationId: ID, interestId: INTEREST.toLowerCase(), url: `/notifications?notification=${ID}&recipient=${ID}` });
});

test('Not now keeps the interest id; a plain tap needs none', () => {
  assert.equal(parsePushAction({ action: 'decline', interestId: INTEREST })?.action, 'decline');
  assert.equal(parsePushAction({ action: 'open', conversationId: ID })?.conversationId, ID);
});

test('Accept or Not now with no usable interest id become a plain tap', () => {
  assert.equal(parsePushAction({ action: 'accept' })?.action, 'open');
  assert.equal(parsePushAction({ action: 'decline', interestId: 'not-an-id' })?.action, 'open');
});

test('unknown actions and non-objects are dropped', () => {
  assert.equal(parsePushAction({ action: 'delete' }), null);
  assert.equal(parsePushAction(null), null);
  assert.equal(parsePushAction('accept'), null);
  assert.equal(parsePushAction({}), null);
});

test('only paths inside the app are kept; anything else is ignored', () => {
  for (const url of ['https://evil.example/x', '//evil.example/x', 'javascript:alert(1)', '/a b', `/${'x'.repeat(400)}`, 'messages/1']) {
    assert.equal(parsePushAction({ action: 'open', url })?.url, undefined, url.slice(0, 30));
  }
  assert.equal(parsePushAction({ action: 'open', url: '/messages/abc?x=1&y=2' })?.url, '/messages/abc?x=1&y=2');
});

test('ids that are not real ids and odd types are dropped, nothing else passes through', () => {
  const out = parsePushAction({ action: 'open', conversationId: '../../etc', notificationId: 'x', type: 'Gaze!', extra: 'x', interestId: 5 }) as Record<string, unknown>;
  assert.deepEqual(out, { action: 'open' });
});
