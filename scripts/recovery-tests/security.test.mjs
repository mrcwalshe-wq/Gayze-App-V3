import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync } from 'node:fs';
import { PGlite } from '@electric-sql/pglite';

const userA = '00000000-0000-4000-8000-000000000001';
const userB = '00000000-0000-4000-8000-000000000002';

// These are tests of the CURRENT checked-in push migration, not of a guessed
// live message/presence policy or of the absent send-push implementation.
test('current push RLS, ledger uniqueness, and message-write independence from failed dispatch', async () => {
  const db = new PGlite();
  try {
    await db.exec(`
      create role anon; create role authenticated; create role service_role bypassrls;
      create schema auth; create schema extensions; create schema net; create schema vault;
      grant usage on schema auth, public to authenticated;
      create table auth.users(id uuid primary key);
      create function auth.uid() returns uuid language sql stable as
        $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
      create table public.profiles(id uuid primary key, display_name text);
      create table public.messages(id uuid primary key, conversation_id uuid, sender_id uuid, ciphertext text);
      create table vault.decrypted_secrets(name text, decrypted_secret text);
      create table public.test_dispatches(url text, body jsonb);
      create function net.http_post(url text, headers jsonb, body jsonb, timeout_milliseconds int)
      returns bigint language plpgsql as $$ begin
        insert into public.test_dispatches values(url, body); return 1;
      end $$;
    `);
    for (const file of ['20260929120000_push_notifications.sql', '20261002090000_push_dispatch_url_fix.sql']) {
      const sql = readFileSync(new URL(`../../supabase/migrations/${file}`, import.meta.url), 'utf8')
        .replace(/^create extension if not exists pgcrypto;$/gm, '')
        .replace(/^create extension if not exists pg_net with schema extensions;$/gm, '');
      await db.exec(sql);
    }
    await db.exec(`grant select, insert, update, delete on public.push_subscriptions, public.notification_preferences, public.notification_dispatch_log to authenticated;`);
    await db.query('insert into auth.users values ($1), ($2)', [userA, userB]);
    await db.query('insert into public.profiles values ($1, $2)', [userA, 'Test sender']);
    const asUser = (id, action) => db.transaction(async (tx) => {
      await tx.exec('set local role authenticated');
      await tx.query("select set_config('request.jwt.claim.sub', $1, true)", [id]);
      return action(tx);
    });
    await asUser(userA, (tx) => tx.query(`insert into push_subscriptions(user_id,endpoint,p256dh,auth) values ($1,'https://push.example/a','public-test-key','test-auth')`, [userA]));
    const hidden = await asUser(userB, (tx) => tx.query('select * from push_subscriptions'));
    assert.equal(hidden.rows.length, 0, 'other user must not read endpoint/keys');
    await assert.rejects(asUser(userB, (tx) => tx.query(`insert into push_subscriptions(user_id,endpoint,p256dh,auth) values ($1,'https://push.example/forged','x','y')`, [userA])), /row-level security/);
    const changed = await asUser(userB, (tx) => tx.query(`update push_subscriptions set user_id=$1 where endpoint='https://push.example/a' returning id`, [userB]));
    assert.equal(changed.rows.length, 0, 'cannot steal another user endpoint');
    await db.query(`insert into notification_dispatch_log(user_id,category,dedupe_key) values ($1,'message','one')`, [userA]);
    await assert.rejects(db.query(`insert into notification_dispatch_log(user_id,category,dedupe_key) values ($1,'message','one')`, [userA]), /duplicate key/);
    assert.equal((await asUser(userA, (tx) => tx.query('select * from notification_dispatch_log'))).rows.length, 0);
    await assert.rejects(asUser(userA, (tx) => tx.query(`select public.request_push_dispatch('{}')`)), /permission denied/);
    await db.exec(`insert into vault.decrypted_secrets values ('gayze_functions_url','https://project.example'),('gayze_push_dispatch_secret','test-only-secret');`);
    await db.query('insert into messages values ($1,$2,$3,$4)', [userA, userA, userA, 'encrypted-only']);
    const dispatch = (await db.query('select * from test_dispatches')).rows[0];
    assert.equal(dispatch.url, 'https://project.example/functions/v1/send-push');
    assert.equal(dispatch.body.event, 'message');
    assert.equal(dispatch.body.ciphertext, undefined);
    await db.exec(`create or replace function net.http_post(url text, headers jsonb, body jsonb, timeout_milliseconds int)
      returns bigint language plpgsql as $$ begin raise exception 'simulated push outage'; end $$;`);
    await db.query('insert into messages values ($1,$2,$3,$4)', [userB, userA, userA, 'still-persisted']);
    assert.equal((await db.query('select count(*)::int as count from messages')).rows[0].count, 2);
  } finally { await db.close(); }
});
