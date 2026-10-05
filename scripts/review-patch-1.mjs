/**
 * REVIEW EVIDENCE ONLY, not acceptance tests for the app.
 * Runs the new realtimeManager straight from `patch 1`, without applying it.
 * Assertions deliberately confirm defects in that submission. After the patch
 * is corrected these assertions should fail; do not add this to `npm test`.
 * Setup: npm ci && npm run test:setup
 * Run: node scripts/review-patch-1.mjs
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { transform } from 'esbuild';

const patch = readFileSync(new URL('../patch 1', import.meta.url), 'utf8');
function addedFile(path) {
  const header = `diff --git a/${path} b/${path}\n`;
  const section = patch.split(header)[1]?.split('\ndiff --git ')[0];
  assert(section?.includes('--- /dev/null'), `Expected added file: ${path}`);
  return section.split('\n')
    .filter((line) => line.startsWith('+') && !line.startsWith('+++'))
    .map((line) => line.slice(1)).join('\n');
}
const source = addedFile('src/services/realtimeManager.ts')
  .replace("import { supabase } from './supabaseClient';", 'const supabase = globalThis.testClient;');
const { code } = await transform(source, { loader: 'ts', format: 'cjs', target: 'es2022' });

function harness() {
  let nextTimer = 0;
  const timers = new Map();
  const created = [];
  const removed = [];
  const listeners = new Map();
  const navigator = { onLine: true };
  const document = { visibilityState: 'visible', addEventListener: addListener };
  function addListener(name, callback) {
    const callbacks = listeners.get(name) || [];
    callbacks.push(callback);
    listeners.set(name, callbacks);
  }
  const client = {
    channel(topic) {
      const bindings = [];
      const channel = {
        topic,
        on(_type, _filter, listener) { bindings.push(listener); return channel; },
        subscribe(callback) { channel.status = callback; return channel; },
        emit(payload) { bindings.forEach((listener) => listener(payload)); },
      };
      created.push(channel);
      return channel;
    },
    removeChannel(channel) {
      removed.push(channel);
      // Deliberately do not deliver CLOSED yet: network teardown is async.
      return Promise.resolve('ok');
    },
  };
  const module = { exports: {} };
  vm.runInNewContext(code, {
    module, exports: module.exports, testClient: client, navigator, document,
    window: {
      addEventListener: addListener,
      setTimeout(callback) { const id = ++nextTimer; timers.set(id, callback); return id; },
      clearTimeout(id) { timers.delete(id); },
    },
    console: { warn() {} },
  });
  return {
    manager: module.exports, created, removed, timers, navigator,
    event(name) { listeners.get(name)?.forEach((callback) => callback({ persisted: true })); },
  };
}

{
  const h = harness();
  let firstMessages = 0;
  let secondMessages = 0;
  const a = h.manager.acquireChannel('room', (c) => c.on('postgres_changes', {}, () => firstMessages++));
  const b = h.manager.acquireChannel('room', (c) => c.on('postgres_changes', {}, () => secondMessages++));
  h.created[0].emit({ id: 'message-1' });
  assert.equal(firstMessages, 1);
  assert.equal(secondMessages, 0);
  a.release();
  h.created[0].emit({ id: 'message-2' });
  assert.equal(firstMessages, 2);
  assert.equal(secondMessages, 0);
  b.release();
  console.log('CONFIRMED: second consumer never receives rows; released first consumer still receives them.');
}
{
  const h = harness();
  const a = h.manager.acquireChannel('room', (c) => c);
  const b = h.manager.acquireChannel('room', (c) => c);
  const updates = [];
  b.onStatus((status) => updates.push(status));
  a.release();
  h.created[0].status('SUBSCRIBED');
  assert.equal(b.status(), 'subscribed');
  assert.deepEqual(updates, ['connecting']);
  b.release();
  console.log('CONFIRMED: releasing one handle erases the other handle\'s status listeners.');
}
{
  const h = harness();
  const handle = h.manager.acquireChannel('room', (c) => c);
  h.created[0].status('SUBSCRIBED');
  h.event('visibilitychange');
  assert.equal(h.created.length, 2);
  h.created[1].status('SUBSCRIBED');
  h.created[0].status('CLOSED');
  assert.equal(handle.status(), 'reconnecting');
  assert.equal(h.timers.size, 1);
  handle.release();
  console.log('CONFIRMED: delayed CLOSED from retired generation marks a healthy replacement reconnecting.');
}
{
  const h = harness();
  const handle = h.manager.acquireChannel('room', (c) => c);
  h.created[0].status('CHANNEL_ERROR');
  h.created[0].status('SUBSCRIBED');
  assert.equal(handle.status(), 'subscribed');
  assert.equal(h.timers.size, 1);
  const [id, retry] = [...h.timers.entries()][0];
  h.timers.delete(id);
  retry();
  assert.equal(h.created.length, 2);
  assert.equal(h.removed.length, 1);
  handle.release();
  console.log('CONFIRMED: successful SDK recovery leaves a retry timer that tears down the healthy channel.');
}
{
  const h = harness();
  const handle = h.manager.acquireChannel('room', (c) => c);
  h.created[0].status('SUBSCRIBED');
  h.navigator.onLine = false;
  h.event('offline');
  h.navigator.onLine = true; // The online event was missed during suspension.
  h.event('visibilitychange');
  h.event('pageshow');
  assert.equal(handle.status(), 'offline');
  assert.equal(h.created.length, 1);
  handle.release();
  console.log('CONFIRMED: foreground/pageshow cannot recover offline state when online event was missed.');
}
{
  const h = harness();
  const handle = h.manager.acquireChannel('room', (c) => c);
  h.event('visibilitychange');
  h.event('pageshow');
  assert.equal(handle.status(), 'connecting');
  assert.equal(h.created.length, 1);
  handle.release();
  console.log('CONFIRMED: a connecting channel is excluded from foreground recovery.');
}
// Real PostgreSQL-in-WASM evidence of the incompatible push migrations.
// Only table DDL / the ownership preflight are needed; no network, real users,
// triggers, service-role secrets or production schema are involved.
const { PGlite } = await import('@electric-sql/pglite');
const currentPush = readFileSync(new URL('../supabase/migrations/20260929120000_push_notifications.sql', import.meta.url), 'utf8');
const proposedPush = addedFile('supabase/migrations/20260928160000_push_subscriptions.sql');
function subscriptionDDL(sql) {
  return sql.slice(sql.indexOf('create table if not exists public.push_subscriptions'),
    sql.indexOf('alter table public.push_subscriptions enable row level security'));
}
const preflightStart = currentPush.indexOf('do $$');
const preflight = currentPush.slice(preflightStart, currentPush.indexOf('$$;', preflightStart) + 3);
for (const order of ['patch-first', 'current-first']) {
  const db = new PGlite();
  try {
    await db.exec('create schema auth; create table auth.users(id uuid primary key); create table public.profiles(id uuid primary key);');
    if (order === 'patch-first') {
      await db.exec(subscriptionDDL(proposedPush));
      await assert.rejects(db.exec(preflight), /refusing to reuse it/);
      console.log('CONFIRMED: patch-first migration order fails the existing push ownership preflight.');
    } else {
      await db.exec(subscriptionDDL(currentPush));
      await assert.rejects(db.exec(subscriptionDDL(proposedPush)), /column "disabled_at" does not exist/);
      console.log('CONFIRMED: current-first migration order fails because patch expects missing disabled_at.');
    }
  } finally {
    await db.close();
  }
}
console.log('\n8 isolated defect scenarios reproduced. No production connections or credentials used.');
