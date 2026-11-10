import test from 'node:test';
import assert from 'node:assert/strict';
import { enqueueOutbox, drainOutbox, loadOutbox, isNetworkFailure, removeFromOutbox, OUTBOX_MAX_AGE_MS, type KeyValueStore } from '../../src/services/outbox';

const store = (): KeyValueStore => { const m = new Map<string, string>(); return { getItem: (k) => m.get(k) ?? null, setItem: (k, v) => { m.set(k, v); }, removeItem: (k) => { m.delete(k); } }; };
const entry = (id: string, createdAt: number, extra: Record<string, unknown> = {}) => ({ id, roomId: 'r1', cipherHex: 'aa', nonceHex: 'bb', expiresAt: null, keyVersion: 1, createdAt, ...extra });
const down = () => Object.assign(new TypeError('Failed to fetch'), {});
const NOW = 1_000_000_000_000;

test('queued messages are kept in order and survive a reload', () => {
  const s = store();
  enqueueOutbox(s, 'u1', entry('b', NOW + 2));
  enqueueOutbox(s, 'u1', entry('a', NOW + 1));
  assert.deepEqual(loadOutbox(s, 'u1').map((e) => e.id), ['a', 'b']);
  assert.deepEqual(loadOutbox(s, 'u2'), []);
});

test('queuing the same message twice keeps one copy', () => {
  const s = store();
  enqueueOutbox(s, 'u1', entry('a', NOW));
  enqueueOutbox(s, 'u1', entry('a', NOW));
  assert.equal(loadOutbox(s, 'u1').length, 1);
});

test('the saved data holds the ciphertext fields only, never message text', () => {
  const s = store();
  enqueueOutbox(s, 'u1', entry('a', NOW));
  const raw = s.getItem('gayze_outbox_v1_u1')!;
  assert.deepEqual(Object.keys(JSON.parse(raw)[0]).sort(), ['attempts', 'cipherHex', 'createdAt', 'expiresAt', 'id', 'keyVersion', 'nonceHex', 'roomId']);
});

test('drain sends oldest first and empties the queue', async () => {
  const s = store(); const order: string[] = [];
  enqueueOutbox(s, 'u1', entry('b', NOW + 2)); enqueueOutbox(s, 'u1', entry('a', NOW + 1));
  const r = await drainOutbox(s, 'u1', async (e) => { order.push(e.id); }, NOW + 10, () => true);
  assert.deepEqual(order, ['a', 'b']); assert.deepEqual(r.sent, ['a', 'b']); assert.equal(loadOutbox(s, 'u1').length, 0);
});

test('a connection failure stops the drain, keeps order and counts the attempt', async () => {
  const s = store(); const tried: string[] = [];
  enqueueOutbox(s, 'u1', entry('a', NOW + 1)); enqueueOutbox(s, 'u1', entry('b', NOW + 2));
  const r = await drainOutbox(s, 'u1', async (e) => { tried.push(e.id); throw down(); }, NOW + 10, () => true);
  assert.deepEqual(tried, ['a']);
  assert.deepEqual(r.remaining.map((e) => [e.id, e.attempts]), [['a', 1], ['b', 0]]);
});

test('a refusal by the server is dropped, and later messages still go', async () => {
  const s = store();
  enqueueOutbox(s, 'u1', entry('a', NOW + 1)); enqueueOutbox(s, 'u1', entry('b', NOW + 2));
  const r = await drainOutbox(s, 'u1', async (e) => { if (e.id === 'a') throw new Error('Messaging is blocked between these accounts'); }, NOW + 10, () => true);
  assert.deepEqual(r.failed, ['a']); assert.deepEqual(r.sent, ['b']); assert.equal(loadOutbox(s, 'u1').length, 0);
});

test('a message whose disappearing time passed, or that is a week old, is dropped unsent', async () => {
  const s = store(); const sent: string[] = [];
  enqueueOutbox(s, 'u1', entry('gone', NOW, { expiresAt: new Date(NOW + 5).toISOString() }));
  enqueueOutbox(s, 'u1', entry('old', NOW - OUTBOX_MAX_AGE_MS - 1));
  enqueueOutbox(s, 'u1', entry('ok', NOW + 1));
  const r = await drainOutbox(s, 'u1', async (e) => { sent.push(e.id); }, NOW + 10, () => true);
  assert.deepEqual(r.expired.sort(), ['gone', 'old']); assert.deepEqual(sent, ['ok']);
});

test('network failures are told apart from refusals', () => {
  assert.equal(isNetworkFailure(new TypeError('Failed to fetch'), true), true);
  assert.equal(isNetworkFailure({ message: 'TypeError: Load failed' }, true), true);
  assert.equal(isNetworkFailure(new Error('Authentication required'), false), true);   // offline: can't refresh the session
  assert.equal(isNetworkFailure(new Error('Authentication required'), true), false);
  assert.equal(isNetworkFailure({ message: 'new row violates row-level security policy' }, true), false);
});

test('remove takes only the named messages', () => {
  const s = store(); enqueueOutbox(s, 'u1', entry('a', NOW)); enqueueOutbox(s, 'u1', entry('b', NOW + 1));
  removeFromOutbox(s, 'u1', ['a']); assert.deepEqual(loadOutbox(s, 'u1').map((e) => e.id), ['b']);
});
