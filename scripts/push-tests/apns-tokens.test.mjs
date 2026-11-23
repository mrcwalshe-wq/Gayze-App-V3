/**
 * Notification token registration (migration 20261123100000) in real Postgres (PGlite), under the same role + claim mechanism as PostgREST.
 *   node --test scripts/push-tests/apns-tokens.test.mjs
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync } from 'node:fs';
import { PGlite } from '@electric-sql/pglite';

const migration = readFileSync(new URL('../../supabase/migrations/20261123100000_apns_alert_tokens.sql', import.meta.url), 'utf8');
const A = '00000000-0000-4000-8000-00000000000a';
const B = '00000000-0000-4000-8000-00000000000b';
const T1 = 'a'.repeat(64), T2 = 'b'.repeat(64), T3 = 'c'.repeat(64);
const PHONE = 'abcdef12-3456-4789-8abc-def012345678';

async function createDb() {
  const db = new PGlite();
  await db.exec(`create role anon nologin; create role authenticated nologin; create role service_role nologin;
    create schema auth;
    create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
    create table auth.users(id uuid primary key);
    grant usage on schema public, auth to authenticated, anon, service_role;
    grant execute on function auth.uid() to authenticated, anon, service_role;`);
  await db.exec(migration);
  await db.exec(`insert into auth.users values ('${A}'), ('${B}')`);
  return db;
}
const as = (db, user, action) => db.transaction(async (tx) => {
  await tx.exec(user ? 'set local role authenticated' : 'set local role anon');
  await tx.query("select set_config('request.jwt.claim.sub', $1, true)", [user ?? '']);
  return action(tx);
});
const q = async (db, user, sql, params = []) => (await as(db, user, (tx) => tx.query(sql, params))).rows;
const reg = (db, user, token, env = 'production', device = PHONE) => q(db, user, 'select public.register_apns_token($1,$2,$3)', [token, env, device]);
const rows = async (db) => (await db.query('select token, user_id, environment, device_id from public.apns_tokens order by token')).rows;

test('the migration applies twice without error', async () => { const db = await createDb(); await db.exec(migration); });

test('a signed-in member registers a token; signed-out callers cannot', async () => {
  const db = await createDb();
  await reg(db, A, T1);
  assert.deepEqual(await rows(db), [{ token: T1, user_id: A, environment: 'production', device_id: PHONE }]);
  await assert.rejects(reg(db, null, T2), /permission denied|not authenticated/);
});

test('bad tokens, environments and device ids are refused', async () => {
  const db = await createDb();
  await assert.rejects(reg(db, A, 'not-hex'), /invalid token/);
  await assert.rejects(reg(db, A, 'ab'), /invalid token/);
  await assert.rejects(reg(db, A, T1, 'staging'), /invalid environment/);
  await assert.rejects(reg(db, A, T1, 'production', 'x; drop table'), /invalid device/);
  assert.deepEqual(await rows(db), []);
});

test('a phone has one token: a new token for the same phone replaces the old one, whichever account it was', async () => {
  const db = await createDb();
  await reg(db, A, T1);
  await reg(db, B, T2);            // signed in as someone else on the same phone
  assert.deepEqual((await rows(db)).map((r) => [r.token, r.user_id]), [[T2, B]]);
  await reg(db, B, T3, 'sandbox');
  assert.deepEqual((await rows(db)).map((r) => [r.token, r.environment]), [[T3, 'sandbox']]);
});

test('registering the same token again keeps one row', async () => {
  const db = await createDb();
  await reg(db, A, T1); await reg(db, A, T1);
  assert.equal((await rows(db)).length, 1);
});

test('members cannot read or write the table directly; unregister removes only their own token', async () => {
  const db = await createDb();
  await reg(db, A, T1, 'production', PHONE);
  await reg(db, B, T2, 'production', '99999999-9999-4999-8999-999999999999');
  await assert.rejects(q(db, A, 'select * from public.apns_tokens'), /permission denied/);
  await assert.rejects(q(db, A, "insert into public.apns_tokens(token,user_id,environment) values ('dd','00000000-0000-4000-8000-00000000000a','production')"), /permission denied/);
  await q(db, A, 'select public.unregister_apns_token($1)', [T2]);        // someone else's token: nothing happens
  assert.equal((await rows(db)).length, 2);
  await q(db, A, 'select public.unregister_apns_token($1)', [T1]);
  assert.deepEqual((await rows(db)).map((r) => r.token), [T2]);
});

test('deleting an account removes its tokens', async () => {
  const db = await createDb();
  await reg(db, A, T1);
  await db.query('delete from auth.users where id = $1', [A]);
  assert.deepEqual(await rows(db), []);
});
