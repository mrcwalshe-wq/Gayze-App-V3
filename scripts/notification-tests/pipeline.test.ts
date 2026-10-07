import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync } from 'node:fs';
import { createECDH, randomBytes } from 'node:crypto';
import { PGlite } from '@electric-sql/pglite';
import { createPushHandler, allowedEndpoint, type PushStore, type Subscription } from '../../supabase/functions/send-push/handler.ts';

const a = '00000000-0000-4000-8000-000000000001';
const b = '00000000-0000-4000-8000-000000000002';
const c = '00000000-0000-4000-8000-000000000003';
const room = '10000000-0000-4000-8000-000000000001';
const secret = 'synthetic-dispatch-secret-used-only-in-local-tests';
async function fixture(applyDurable = true) {
  const db = new PGlite();
  await db.exec(`
    create role anon; create role authenticated; create role service_role bypassrls;
    create schema auth; create schema net; create schema vault; create schema extensions;
    grant usage on schema auth,public to authenticated;
    create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
    create table auth.users(id uuid primary key);
    create table profiles(id uuid primary key,display_name text);
    create table conversation_members(conversation_id uuid,user_id uuid,primary key(conversation_id,user_id));
    create table messages(id uuid primary key default gen_random_uuid(),conversation_id uuid,sender_id uuid,ciphertext text,expires_at timestamptz,burned_at timestamptz);
    create table gazes(from_user_id uuid,to_user_id uuid,intent_id uuid);
    create table intents(id uuid primary key,user_id uuid,expires_at timestamptz,is_paused boolean);
    create table safety_checkins(id uuid primary key,user_id uuid,expires_at timestamptz,status text);
    create table vault.decrypted_secrets(name text,decrypted_secret text);
    create table test_http(url text,body jsonb);
    create function net.http_post(url text,headers jsonb,body jsonb,timeout_milliseconds int) returns bigint language plpgsql as $$ begin
      insert into test_http values(url,body); return 1; end $$;
  `);
  for (const file of ['20260929120000_push_notifications.sql', '20261002090000_push_dispatch_url_fix.sql', '20261002100000_durable_notifications.sql']) {
    if (!applyDurable && file === '20261002100000_durable_notifications.sql') continue;
    const sql = readFileSync(new URL('../../supabase/migrations/' + file, import.meta.url), 'utf8')
      .replace(/^create extension if not exists .*;$/gm, '');
    await db.exec('begin;\n' + sql + '\ncommit;');
  }
  await db.exec(`grant select,insert,update,delete on push_subscriptions,notification_preferences to authenticated;
    grant insert,select on messages,gazes to authenticated;`);
  for (const id of [a,b,c]) await db.query('insert into auth.users values ($1)', [id]);
  for (const id of [a,b]) await db.query('insert into conversation_members values ($1,$2)', [room,id]);
  await db.query('insert into vault.decrypted_secrets values ($1,$2),($3,$4)', ['gayze_functions_url','https://project.example','gayze_push_dispatch_secret',secret]);
  const rows = async (sql: string, params: unknown[] = []) => (await db.query<any>(sql, params)).rows;
  const own = <T>(id: string, fn: (tx: any) => Promise<T>) => db.transaction(async tx => {
    await tx.exec('set local role authenticated'); await tx.query("select set_config('request.jwt.claim.sub',$1,true)", [id]); return fn(tx);
  });
  const store: PushStore = {
    async user(token) { return token === 'a' ? { id:a } : token === 'b' ? { id:b } : token === 'admin' ? { id:b, app_metadata:{role:'admin'} } : null; },
    async notice(id) { return (await rows('select * from gayze_notifications where id=$1',[id]))[0] ?? null; },
    async eligible(id) { return (await rows('select gayze_notification_push_allowed($1) as allowed',[id]))[0].allowed; },
    async preferences(user) { return (await rows('select * from notification_preferences where user_id=$1',[user]))[0] ?? null; },
    async subscriptions(user) { return rows('select * from push_subscriptions where user_id=$1',[user]); },
    async claim(id,sub) { return (await rows('select gayze_claim_notification_delivery($1,$2) as claimed',[id,sub]))[0].claimed; },
    async finish(id,endpoint,state,status) { await rows('update gayze_notification_deliveries set state=$3,status_code=$4 where notification_id=$1 and endpoint=$2',[id,endpoint,state,status??null]); },
    async prune(sub) { await rows('delete from push_subscriptions where id=$1 and user_id=$2 and endpoint=$3',[sub.id,sub.user_id,sub.endpoint]); },
    async complete(id) { await rows('update gayze_notifications set push_processed_at=now() where id=$1',[id]); },
    async unread(user) { return (await rows('select count(*)::int as n from gayze_notifications where user_id=$1 and read_at is null',[user]))[0].n; },
    async test(user,key) { return (await rows("select gayze_enqueue_notification($1,null,'test',$2,'/notifications') as id",[user,key]))[0].id; },
    async connection(token, conversation) { return own(token === 'a' ? a : b, async tx => (await tx.query('select gayze_connection_notification($1) as id',[conversation])).rows[0].id); },
  };
  const device = createECDH('prime256v1'); device.generateKeys();
  const publicKey = device.getPublicKey().toString('base64url'), authKey = randomBytes(16).toString('base64url');
  const subscription = async (user=b,endpoint='https://fcm.googleapis.com/fcm/send/local-test') =>
    (await rows("insert into push_subscriptions(user_id,endpoint,p256dh,auth) values ($1,$2,$3,$4) returning *",[user,endpoint,publicKey,authKey]))[0] as Subscription;
  const gaze = async () => { await own(a, tx => tx.query('insert into gazes values ($1,$2,null)',[a,b])); return (await rows("select * from gayze_notifications where category='gaze'"))[0]; };
  const message = async () => { await own(a, tx => tx.query("insert into messages(conversation_id,sender_id,ciphertext) values ($1,$2,'ciphertext-never-in-push')",[room,a])); return (await rows("select * from gayze_notifications where category='message' order by created_at desc"))[0]; };
  return {db,rows,own,store,subscription,gaze,message};
}
const request = (payload: unknown, token?: string, dispatch=secret, origin?: string) => new Request('https://project.example/functions/v1/send-push', {
  method:'POST', headers:{'Content-Type':'application/json', ...(dispatch ? {'x-gayze-dispatch-secret':dispatch} : {}), ...(token ? {Authorization:`Bearer ${token}`} : {}), ...(origin ? {Origin:origin} : {})}, body:JSON.stringify(payload),
});
const config = { dispatchSecret:secret, origins:['https://gayze.co.uk'], configured:true };

test('real migration → durable inbox → authenticated sender → provider boundary', async t => {
  const f = await fixture();
  const sent: any[] = [];
  const handler = createPushHandler(f.store, async (subscription,payload) => { sent.push({subscription,payload}); }, config);
  try {
    await t.test('Gayze creates one durable recipient record and canonical dispatch; repeat is idempotent', async () => {
      const notice = await f.gaze(); await f.gaze();
      assert.equal((await f.rows("select * from gayze_notifications where category='gaze'")).length,1);
      assert.equal(notice.user_id,b); assert.equal(notice.actor_id,a); assert.equal(notice.url,'/notifications');
      const http = (await f.rows('select * from test_http'))[0];
      assert.equal(http.url,'https://project.example/functions/v1/send-push'); assert.deepEqual(http.body,{notificationId:notice.id});
      assert.equal(await f.store.unread(b),1); assert.equal(await f.store.unread(a),0);
    });
    await t.test('anonymous base-table writes cannot create notification-producing events', async () => {
      await f.db.exec('grant usage on schema public,auth to anon; grant insert on gazes to anon');
      await assert.rejects(f.db.transaction(async tx=>{await tx.exec('set local role anon');await tx.query('insert into gazes values($1,$2,null)',[a,b]);}),/Sign in required/);
    });
    await t.test('message creates recipient notification atomically, never sends ciphertext', async () => {
      const notice = await f.message(); await f.subscription();
      const response = await handler(request({notificationId:notice.id,body:'attacker text',toUserId:a,url:'https://evil.example'}));
      assert.equal(response.status,200); assert.equal(sent.length,1);
      assert.equal(sent[0].subscription.user_id,b);
      assert.equal(sent[0].payload.messageId,notice.event_key); assert.equal(sent[0].payload.recipientId,b); assert.equal(sent[0].payload.conversationId,room);
      assert.equal(sent[0].payload.type,'message'); assert.equal(sent[0].payload.url,`/messages/${room}?notification=${notice.id}&recipient=${b}`);
      assert(!JSON.stringify(sent[0].payload).includes('ciphertext')); assert(!JSON.stringify(sent[0].payload).includes('attacker'));
    });
    await t.test('concurrent/replayed invocations do not duplicate provider calls', async () => {
      const notice = (await f.rows("select * from gayze_notifications where category='gaze'"))[0];
      const before=sent.length;
      await Promise.all(Array.from({length:8},()=>handler(request({notificationId:notice.id}))));
      assert.equal(sent.length,before+1); assert.equal(sent.at(-1).payload.type,'gaze');
      assert.equal(sent.at(-1).payload.url,`/notifications?notification=${notice.id}&recipient=${b}`);
    });
    await t.test('unauthenticated, invalid JWT/secret, cross-account and untrusted-origin requests are denied', async () => {
      const notice=(await f.rows('select id from gayze_notifications limit 1'))[0];
      assert.equal((await handler(request({notificationId:notice.id},undefined,''))).status,401);
      assert.equal((await handler(request({notificationId:notice.id},'fake','wrong'))).status,401);
      assert.equal((await handler(request({notificationId:notice.id},'a',''))).status,403);
      assert.equal((await handler(request({notificationId:notice.id},'b','', 'https://evil.example'))).status,403);
      assert.equal((await handler(request({action:'test'},'b',''))).status,403);
      assert.equal((await handler(request({event:'message',toUserId:b}))).status,400);
      assert.equal((await handler(request({notificationId:notice.id,large:'x'.repeat(9000)}))).status,400);
    });
    await t.test('own inbox RLS, immutable content, owner-only read state and exact unread count', async () => {
      const notice=(await f.rows("select * from gayze_notifications where category='gaze'"))[0];
      const readA=await f.own(a,tx=>tx.query('select * from gayze_notifications')); assert.equal(readA.rows.length,0);
      const readB=await f.own(b,tx=>tx.query('select * from gayze_notifications')); assert.equal(readB.rows.length,2);
      await assert.rejects(f.own(b,tx=>tx.query("update gayze_notifications set category='safety'")),/permission denied/);
      await assert.rejects(f.own(b,tx=>tx.query('select * from gayze_notification_deliveries')),/permission denied/);
      await assert.rejects(f.own(b,tx=>tx.query("select gayze_enqueue_notification($1,null,'gaze','forged','/notifications')",[a])),/permission denied/);
      await assert.rejects(f.own(b,tx=>tx.query('select gayze_claim_notification_delivery($1,$2)',[notice.id,a])),/permission denied/);
      await f.own(a,tx=>tx.query('select gayze_mark_notification_read($1,null)',[notice.id])); assert.equal(await f.store.unread(b),2);
      await f.own(b,tx=>tx.query('select gayze_mark_notification_read($1,null)',[notice.id])); assert.equal(await f.store.unread(b),1);
      await f.own(b,tx=>tx.query('select gayze_mark_notification_read(null,$1)',[room])); assert.equal(await f.store.unread(b),0);
    });
    await t.test('subscription ownership and claim ownership reject spoofing', async () => {
      await assert.rejects(f.own(a,tx=>tx.query("insert into push_subscriptions(user_id,endpoint,p256dh,auth) values ($1,'https://fcm.googleapis.com/forged','x','y')",[b])),/row-level security/);
      assert.equal((await f.own(a,tx=>tx.query('select * from push_subscriptions'))).rows.length,0);
      const notice=await f.message(), other=await f.subscription(a,'https://fcm.googleapis.com/a');
      assert.equal(await f.store.claim(notice.id,other.id),false);
      await assert.rejects(f.own(a,tx=>tx.query('insert into gazes values($1,$2,null)',[b,a])),/sender mismatch/);
    });
    await t.test('malformed subscription keys are pruned without contacting a provider or deleting the record', async () => {
      const invalid=await f.subscription(b,'https://fcm.googleapis.com/invalid-keys');
      await f.rows("update push_subscriptions set auth='malformed' where id=$1",[invalid.id]);
      const notice=await f.message(),before=sent.length;
      await handler(request({notificationId:notice.id})); assert.equal(sent.length,before+1);
      assert.equal((await f.rows('select id from push_subscriptions where id=$1',[invalid.id])).length,0);
      assert(await f.store.notice(notice.id));
      assert.equal((await f.rows('select state from gayze_notification_deliveries where notification_id=$1 and endpoint=$2',[notice.id,invalid.endpoint]))[0].state,'invalid');
    });
    await t.test('provider 410 prunes only expired subscription; failure never deletes the notification', async () => {
      const notice=await f.message();
      const failing=createPushHandler(f.store,async()=>{ throw {statusCode:410}; },config);
      assert.equal((await failing(request({notificationId:notice.id}))).status,200);
      assert(await f.store.notice(notice.id)); assert.equal((await f.store.subscriptions(b)).length,0);
      assert.equal((await f.store.subscriptions(a)).length,1);
      assert.equal((await f.rows('select state from gayze_notification_deliveries where notification_id=$1',[notice.id]))[0].state,'expired');
    });
    await t.test('ambiguous provider timeout retains record and never automatically resends', async () => {
      await f.subscription(); const notice=await f.message(); let attempts=0;
      const failing=createPushHandler(f.store,async()=>{ attempts++; throw new Error('timeout'); },config);
      await failing(request({notificationId:notice.id})); await failing(request({notificationId:notice.id}));
      assert.equal(attempts,1); assert(await f.store.notice(notice.id));
      assert.equal((await f.rows('select state from gayze_notification_deliveries where notification_id=$1',[notice.id]))[0].state,'unknown');
    });
    await t.test('preferences and missing configuration preserve unread records without sending', async () => {
      const notice=await f.message(); const before=sent.length;
      await f.rows('insert into notification_preferences(user_id,messages) values($1,false)',[b]);
      await handler(request({notificationId:notice.id})); assert.equal(sent.length,before); assert(await f.store.notice(notice.id));
      await f.rows('update notification_preferences set messages=true where user_id=$1',[b]);
      const fresh=await f.message(); const unavailable=createPushHandler(f.store,async()=>{throw new Error('must not send');},{...config,configured:false});
      assert.equal((await unavailable(request({notificationId:fresh.id}))).status,503);
      assert.equal((await f.rows('select push_processed_at from gayze_notifications where id=$1',[fresh.id]))[0].push_processed_at,null);
    });
    await t.test('HTTP dispatch outage cannot roll back messages, Gayzes or notification records; drain requeues IDs', async () => {
      await f.db.exec("create or replace function net.http_post(url text,headers jsonb,body jsonb,timeout_milliseconds int) returns bigint language plpgsql as $$ begin raise exception 'simulated outage'; end $$;");
      const before=await f.store.unread(b); await f.message();
      const gazeIntent='20000000-0000-4000-8000-000000000001';
      await f.rows("insert into intents values($1,$2,now()+interval '1 hour',false)",[gazeIntent,b]);
      await f.rows('insert into gazes values($1,$2,$3)',[a,b,gazeIntent]); assert.equal(await f.store.unread(b),before+2);
      await f.db.exec('select gayze_drain_notifications()');
      assert((await f.rows('select * from messages')).length>0);
    });
    await t.test('connection recipient derived from membership, not caller-selected recipient', async () => {
      await assert.rejects(f.own(c,tx=>tx.query('select gayze_connection_notification($1)',[room])),/Not a conversation member/);
      const id=await f.store.connection('a',room); assert.equal((await f.store.notice(id))?.user_id,b);
      assert.equal(await f.store.connection('a',room),id);
      assert.equal((await handler(request({notificationId:id}))).status,200);
      assert.equal(sent.at(-1).payload.type,'connection'); assert.equal(sent.at(-1).payload.notificationId,id);
      assert.equal(sent.at(-1).payload.conversationId,room); assert.equal(sent.at(-1).payload.url,`/messages/${room}?notification=${id}&recipient=${b}`);
    });
    await t.test('legacy intent/safety sweeps now persist durable records and deduplicate', async () => {
      await f.rows("insert into intents values($1,$2,now()+interval '5 minutes',false)",[room,b]);
      await f.rows("insert into safety_checkins values($1,$2,now()-interval '5 minutes','active')",[room,b]);
      await f.db.exec('select sweep_expiring_intents(); select sweep_expired_safety_checkins(); select sweep_expiring_intents(); select sweep_expired_safety_checkins();');
      const records=await f.rows("select category from gayze_notifications where category in ('intent_expiring','safety')"); assert.equal(records.length,2);
    });
    await t.test('expired/burned messages and removed membership suppress pushes without deleting inbox records', async () => {
      const before=sent.length, notice=await f.message();
      await f.rows("update messages set expires_at=now()-interval '1 second' where id::text=$1",[notice.event_key]);
      await handler(request({notificationId:notice.id})); assert.equal(sent.length,before); assert(await f.store.notice(notice.id));
      const burned=await f.message(); await f.rows('update messages set burned_at=now() where id::text=$1',[burned.event_key]);
      await handler(request({notificationId:burned.id})); assert.equal(sent.length,before);
      const left=await f.message(); await f.rows('delete from conversation_members where conversation_id=$1 and user_id=$2',[room,b]);
      await handler(request({notificationId:left.id})); assert.equal(sent.length,before);
      await f.rows('insert into conversation_members values($1,$2)',[room,b]);
    });
    await t.test('temporary tables cannot shadow membership inside definer RPCs', async () => {
      await assert.rejects(f.own(c,async tx=>{
        await tx.exec('create temporary table conversation_members(conversation_id uuid,user_id uuid) on commit drop');
        await tx.query('insert into pg_temp.conversation_members values($1,$2),($1,$3)',[room,c,a]);
        return tx.query('select gayze_connection_notification($1)',[room]);
      }),/Not a conversation member/);
    });
    await t.test('an intent-linked Gayze cannot use another recipient intent or an invented intent', async () => {
      const otherIntent='20000000-0000-4000-8000-000000000002';
      await f.rows("insert into intents values($1,$2,now()+interval '1 hour',false)",[otherIntent,c]);
      await assert.rejects(f.own(a,tx=>tx.query('insert into gazes values($1,$2,$3)',[a,b,otherIntent])),/recipient mismatch/);
      await assert.rejects(f.own(a,tx=>tx.query('insert into gazes values($1,$2,$3)',[a,b,c])),/recipient mismatch/);
    });
    await t.test('insecure dispatch base does not receive secrets or roll back a durable notice', async () => {
      const before=(await f.rows('select * from test_http')).length;
      await f.rows("update vault.decrypted_secrets set decrypted_secret='http://insecure.example' where name='gayze_functions_url'");
      const notice=await f.message(); assert(await f.store.notice(notice.id));
      assert.equal((await f.rows('select * from test_http')).length,before);
      await f.rows("update vault.decrypted_secrets set decrypted_secret='https://project.example' where name='gayze_functions_url'");
    });
    await t.test('admin test is self-targeted, one record per minute; local UI flags cannot authorize it', async () => {
      const response=await handler(request({action:'test',toUserId:a},'admin',''));
      assert.equal(response.status,200);
      await handler(request({action:'test'},'admin',''));
      const records=await f.rows("select user_id from gayze_notifications where category='test'"); assert.deepEqual(records,[{user_id:b}]);
    });
  } finally { await f.db.close(); }
});

test('SSRF hardening accepts only existing browser Web Push service hosts', () => {
  for(const url of ['http://127.0.0.1/x','https://127.0.0.1/x','https://evil.example/x','https://fcm.googleapis.com.evil.example/x','https://a@fcm.googleapis.com/x','https://fcm.googleapis.com:444/x']) assert.equal(allowedEndpoint(url),false,url);
  for(const url of ['https://fcm.googleapis.com/fcm/send/a','https://updates.push.services.mozilla.com/wpush/v2/a','https://web.push.apple.com/a','https://wns.notify.windows.com/a']) assert.equal(allowedEndpoint(url),true,url);
});


test('durable migration failure rolls back transactionally; existing source tables survive and unread index is partial', async () => {
  const f = await fixture(false);
  const sql = readFileSync(new URL('../../supabase/migrations/20261002100000_durable_notifications.sql', import.meta.url), 'utf8');
  try {
    // A late unknown-object collision must not leave half an installed inbox.
    await f.db.exec("create function public.gayze_drain_notifications() returns void language sql as $$ select $$;");
    await assert.rejects(f.db.transaction(tx => tx.exec(sql)), /already exists/);
    assert.equal((await f.rows("select to_regclass('public.gayze_notifications') as object"))[0].object, null);
    assert((await f.rows("select to_regclass('public.messages') as object"))[0].object);
    await f.db.exec('drop function public.gayze_drain_notifications()');
    await f.db.transaction(tx => tx.exec(sql));
    const index = (await f.rows("select indexdef from pg_indexes where indexname='gayze_notifications_unread'"))[0];
    assert.match(index.indexdef, /user_id, category/); assert.match(index.indexdef, /WHERE \(read_at IS NULL\)/);
    const before = (await f.rows('select count(*)::int as n from messages'))[0].n;
    await f.db.exec('alter table gayze_notifications add constraint test_capture_failure check(false) not valid');
    await assert.rejects(f.own(a, tx => tx.query("insert into messages(conversation_id,sender_id,ciphertext) values($1,$2,'encrypted')", [room,a])), /test_capture_failure/);
    assert.equal((await f.rows('select count(*)::int as n from messages'))[0].n, before);
  } finally { await f.db.close(); }
});
