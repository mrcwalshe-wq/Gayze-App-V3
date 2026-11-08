import test from 'node:test';
import assert from 'node:assert/strict';
import { autoRekeyDue, isStuckWithoutKey, AUTO_REKEY_AFTER_FAILURE_MS, AUTO_REKEY_AFTER_SUCCESS_MS } from '../../src/services/autoRekey.ts';

const stuck = { key: null, canRekey: true, code: 'key_not_shared' };

test('a device that can never open the key re-keys when it has not tried before', () => {
  assert.equal(autoRekeyDue(stuck, null, 1000), true);
  assert.equal(autoRekeyDue({ ...stuck, code: 'cannot_unwrap' }, null, 1000), true);
});

test('transient or already-working states never re-key', () => {
  assert.equal(isStuckWithoutKey({ key: {}, canRekey: true, code: 'key_not_shared' }), false);
  assert.equal(isStuckWithoutKey({ ...stuck, transient: true }), false);
  assert.equal(isStuckWithoutKey({ key: null, code: 'device_pending', transient: true }), false);
  assert.equal(isStuckWithoutKey({ key: null, canRekey: false, code: 'key_not_shared' }), false);
  assert.equal(isStuckWithoutKey({ key: null, canRekey: true, code: 'provision_failed' }), false);
});

test('cool-down: after a success wait a day, after a failure wait ten minutes', () => {
  const t = 10_000_000;
  assert.equal(autoRekeyDue(stuck, { at: t, ok: true }, t + AUTO_REKEY_AFTER_SUCCESS_MS - 1), false);
  assert.equal(autoRekeyDue(stuck, { at: t, ok: true }, t + AUTO_REKEY_AFTER_SUCCESS_MS), true);
  assert.equal(autoRekeyDue(stuck, { at: t, ok: false }, t + AUTO_REKEY_AFTER_FAILURE_MS - 1), false);
  assert.equal(autoRekeyDue(stuck, { at: t, ok: false }, t + AUTO_REKEY_AFTER_FAILURE_MS), true);
});
