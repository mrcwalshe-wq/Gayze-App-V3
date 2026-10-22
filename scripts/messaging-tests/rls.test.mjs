/**
 * Messaging access control + key-version protocol, executed in real Postgres
 * (PGlite) against a replica of the production schema (live-schema.sql) with
 * the real migrations applied. Every request runs under the same role + JWT
 * claim mechanism PostgREST uses (`set local role` + request.jwt.claim.sub).
 *
 *   node --test scripts/messaging-tests/rls.test.mjs
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync } from 'node:fs';
import { PGlite } from '@electric-sql/pglite';

const root = new URL('../../', import.meta.url);
const read = (path) => readFileSync(new URL(path, root), 'utf8');
const MIGRATIONS = [
  'supabase/migrations/20261022090000_messaging_rls_and_grants_hardening.sql',
  'supabase/migrations/20261022091000_conversation_key_versions.sql',
];

const A = '00000000-0000-4000-8000-00000000000a';
const B = '00000000-0000-4000-8000-00000000000b';
const C = '00000000-0000-4000-8000-00000000000c'; // never a member
const dev = (n) => `d0000000-0000-4000-8000-0000000000${n}`;
const DA = dev('a1'); const DA2 = dev('a2'); const DB = dev('b1'); const DB2 = dev('b2'); const DC = dev('c1');
const HEX_KEY = 'ab'.repeat(48);
const HEX_NONCE = 'cd'.repeat(12);

async function createDb({ migrated }) {
  const db = new PGlite();
  await db.exec(read('scripts/messaging-tests/live-schema.sql'));
  if (migrated) for (const file of MIGRATIONS) await db.exec(read(file));
  await db.exec(`insert into auth.users values ('${A}'),('${B}'),('${C}');
                 insert into public.profiles values ('${A}'),('${B}'),('${C}');`);
  for (const [user, id] of [[A, DA], [A, DA2], [B, DB], [B, DB2], [C, DC]]) {
    await db.query(`insert into identity_devices(user_id,device_id,device_fingerprint,public_key) values ($1,$2,$3,$4)`,
      [user, id, `fp-${id}`, `{"kty":"EC","pub":"${id}"}`]);
  }
  // Conversation is created exactly the way production creates it.
  await db.query(`insert into interests(from_user_id,to_user_id) values ($1,$2)`, [A, B]);
  const interest = (await db.query('select id from interests')).rows[0].id;
  const created = await as(db, B, (tx) => tx.query('select accept_interest($1) r', [interest]));
  return { db, conversationId: created.rows[0].r.conversation_id, interest };
}

const as = (db, userId, action) => db.transaction(async (tx) => {
  await tx.exec(userId ? 'set local role authenticated' : 'set local role anon');
  await tx.query("select set_config('request.jwt.claim.sub', $1, true)", [userId ?? '']);
  return action(tx);
});
const rows = async (db, userId, sql, params = []) => (await as(db, userId, (tx) => tx.query(sql, params))).rows;
const insertMessage = (db, userId, conversationId, extra = {}) => as(db, userId, (tx) => extra.legacy
  ? tx.query(`insert into messages(conversation_id,sender_id,ciphertext,nonce) values ($1,$2,'aa11','bb22') returning id,created_at`, [conversationId, userId])
  : tx.query(
    `insert into messages(id,conversation_id,sender_id,ciphertext,nonce,client_message_id,key_version)
     values (coalesce($1,gen_random_uuid()),$2,$3,'aa11','bb22',$4,$5) returning id,created_at`,
    [extra.id ?? null, conversationId, extra.sender ?? userId, extra.clientId ?? null, extra.keyVersion ?? 1]));
const claim = (db, userId, conversationId, device, version) => rows(db, userId,
  'select claim_conversation_key_bootstrap($1,$2,$3) ok', [conversationId, device, version]).then((r) => r[0].ok);
const saveEnv = (db, userId, conversationId, target, targetDevice, creator, version) => rows(db, userId,
  'select * from save_conversation_key_envelope($1,$2,$3,$4,$5,$6,$7)',
  [conversationId, target, targetDevice, HEX_KEY, HEX_NONCE, creator, version]);

test('BEFORE migration: the self-join exploit is real (any signed-in user reads another conversation)', async () => {
  const { db, conversationId } = await createDb({ migrated: false });
  await insertMessage(db, A, conversationId, { legacy: true });
  assert.equal((await rows(db, C, 'select 1 from messages where conversation_id=$1', [conversationId])).length, 0, 'non-member sees nothing initially');
  await as(db, C, (tx) => tx.query('insert into conversation_members(conversation_id,user_id) values ($1,$2)', [conversationId, C]));
  assert.equal((await rows(db, C, 'select 1 from messages where conversation_id=$1', [conversationId])).length, 1,
    'after self-inserting a membership row the attacker reads the victim message');
  await as(db, C, (tx) => tx.query('truncate messages')); // TRUNCATE is not subject to RLS
  assert.equal((await db.query('select count(*)::int n from messages')).rows[0].n, 0, 'authenticated TRUNCATE wiped every message');
});

test('AFTER migration: self-join exploit, TRUNCATE and anon access are all rejected', async () => {
  const { db, conversationId } = await createDb({ migrated: true });
  await insertMessage(db, A, conversationId);

  await assert.rejects(as(db, C, (tx) => tx.query('insert into conversation_members(conversation_id,user_id) values ($1,$2)', [conversationId, C])), /permission denied/);
  await assert.rejects(as(db, C, (tx) => tx.query('update conversation_members set user_id=$2 where conversation_id=$1', [conversationId, C])), /permission denied/);
  await assert.rejects(as(db, C, (tx) => tx.query('insert into conversations default values')), /permission denied/);
  assert.equal((await rows(db, C, 'select 1 from messages where conversation_id=$1', [conversationId])).length, 0);
  assert.equal((await rows(db, C, 'select 1 from conversation_key_envelopes')).length, 0);
  assert.equal((await rows(db, C, 'select 1 from conversation_members where conversation_id=$1', [conversationId])).length, 0, 'non-member cannot enumerate members');

  for (const table of ['messages', 'conversation_members', 'conversations', 'conversation_key_envelopes', 'identity_devices']) {
    await assert.rejects(as(db, A, (tx) => tx.query(`truncate ${table} cascade`)), /permission denied/, `authenticated TRUNCATE ${table}`);
    await assert.rejects(as(db, null, (tx) => tx.query(`select 1 from ${table}`)), /permission denied/, `anon SELECT ${table}`);
  }
  await assert.rejects(insertMessage(db, null, conversationId, { sender: A }), /permission denied/, 'anon insert');
  assert.equal((await db.query('select count(*)::int n from messages')).rows[0].n, 1);
});

test('non-member insert rejected, sender spoofing rejected, members read both directions', async () => {
  const { db, conversationId } = await createDb({ migrated: true });
  await assert.rejects(insertMessage(db, C, conversationId), /row-level security/, 'non-member insert');
  await assert.rejects(insertMessage(db, A, conversationId, { sender: B }), /row-level security/, 'A cannot send as B');
  await insertMessage(db, A, conversationId);
  await insertMessage(db, B, conversationId);
  assert.equal((await rows(db, A, 'select 1 from messages')).length, 2);
  assert.equal((await rows(db, B, 'select 1 from messages')).length, 2, 'B receives A and sees own reply');
});

test('stored ciphertext is immutable to clients (tamper / delete rejected)', async () => {
  const { db, conversationId } = await createDb({ migrated: true });
  const { rows: [m] } = await insertMessage(db, A, conversationId);
  await assert.rejects(as(db, A, (tx) => tx.query(`update messages set ciphertext='ff' where id=$1`, [m.id])), /permission denied/);
  await assert.rejects(as(db, B, (tx) => tx.query(`update messages set ciphertext='ff' where id=$1`, [m.id])), /permission denied/);
  await assert.rejects(as(db, A, (tx) => tx.query('delete from messages where id=$1', [m.id])), /permission denied/);
  assert.equal((await db.query('select ciphertext from messages')).rows[0].ciphertext, 'aa11');
});

test('duplicate submit: same message id and same (sender, client_message_id) cannot create two rows', async () => {
  const { db, conversationId } = await createDb({ migrated: true });
  const id = '11111111-1111-4111-8111-111111111111';
  await insertMessage(db, A, conversationId, { id, clientId: 'c-1' });
  await assert.rejects(insertMessage(db, A, conversationId, { id }), /duplicate key/);
  await assert.rejects(insertMessage(db, A, conversationId, { clientId: 'c-1' }), /duplicate key/);
  await insertMessage(db, B, conversationId, { clientId: 'c-1' }); // same client id, different sender is a different message
  assert.equal((await db.query('select count(*)::int n from messages')).rows[0].n, 2);
});

test('rapid sends keep a stable server order (created_at, id tiebreak)', async () => {
  const { db, conversationId } = await createDb({ migrated: true });
  for (let i = 0; i < 25; i++) await insertMessage(db, i % 2 ? A : B, conversationId, { clientId: `r-${i}` });
  const ordered = await rows(db, A, 'select client_message_id from messages order by created_at asc, id asc');
  assert.equal(ordered.length, 25);
  assert.equal(new Set(ordered.map((r) => r.client_message_id)).size, 25, 'no duplicates under rapid sends');
});

test('conversation creation is atomic and one-per-pair, including crossed accepts', async () => {
  const { db, conversationId } = await createDb({ migrated: true });
  assert.equal((await db.query('select count(*)::int n from conversation_members where conversation_id=$1', [conversationId])).rows[0].n, 2);
  // B -> A interest accepted by A must reuse the existing conversation.
  await db.query(`insert into interests(from_user_id,to_user_id) values ($1,$2)`, [B, A]);
  const crossed = (await db.query(`select id from interests where from_user_id=$1`, [B])).rows[0].id;
  const again = await as(db, A, (tx) => tx.query('select accept_interest($1) r', [crossed]));
  assert.equal(again.rows[0].r.conversation_id, conversationId);
  assert.equal((await db.query('select count(*)::int n from conversations')).rows[0].n, 1);
  assert.equal((await db.query(`select count(*)::int n from (select conversation_id from conversation_members group by 1 having count(*)<>2) x`)).rows[0].n, 0);
  await db.query(`insert into interests(from_user_id,to_user_id) values ($1,$2)`, [A, C]);
  const forC = (await db.query(`select id from interests where to_user_id=$1`, [C])).rows[0].id;
  await assert.rejects(rows(db, B, 'select accept_interest($1)', [forC]), /not authorized/, 'only the addressee can accept');
  await assert.rejects(rows(db, null, 'select accept_interest($1)', [forC]), /permission denied/, 'anon cannot accept');
});

test('leaving a conversation removes read access (and is the only way a member count drops)', async () => {
  const { db, conversationId } = await createDb({ migrated: true });
  await insertMessage(db, A, conversationId);
  await rows(db, B, 'select leave_conversation($1)', [conversationId]);
  assert.equal((await rows(db, B, 'select 1 from messages')).length, 0);
  assert.equal((await rows(db, A, 'select 1 from messages')).length, 1);
  await assert.rejects(rows(db, B, 'select leave_conversation($1)', [conversationId]), /Not a conversation member/);
});

test('device registry rows cannot be forged or un-revoked through direct table writes', async () => {
  const { db } = await createDb({ migrated: true });
  await assert.rejects(as(db, A, (tx) => tx.query(`update identity_devices set status='active' where user_id=$1`, [A])), /permission denied/);
  await assert.rejects(as(db, A, (tx) => tx.query(`insert into identity_devices(user_id,device_id,public_key) values ($1,gen_random_uuid(),'k')`, [A])), /permission denied/);
  assert.equal((await rows(db, A, 'select 1 from identity_devices')).length, 2, 'user still reads only their own devices');
  assert.equal((await rows(db, C, 'select 1 from identity_devices')).length, 1);
});

test('key versions: claim serialisation, second-device provisioning, re-key, and version guard', async () => {
  const { db, conversationId } = await createDb({ migrated: true });

  // Only one device wins the first claim; the other member sees "busy".
  assert.equal(await claim(db, A, conversationId, DA, 1), true);
  assert.equal(await claim(db, B, conversationId, DB, 1), false, 'competing key creation is refused');
  assert.equal(await claim(db, A, conversationId, DA, 2), false, 'cannot skip ahead of the next version');
  await assert.rejects(claim(db, C, conversationId, DC, 1), /membership required/, 'non-member cannot claim');
  await assert.rejects(claim(db, A, conversationId, DB, 1), /not authorised/, 'cannot claim with someone else\'s device');

  // Version-1 envelopes: creator wraps for itself, then for the peer.
  await saveEnv(db, A, conversationId, A, DA, DA, 1);
  await assert.rejects(saveEnv(db, B, conversationId, B, DB, DB, 1), /already holds|claimed by another/, 'a non-holder cannot inject the first envelope after claim');
  await saveEnv(db, A, conversationId, B, DB, DA, 1);
  await assert.rejects(saveEnv(db, C, conversationId, C, DC, DC, 1), /membership required/, 'non-member cannot write envelopes');
  await assert.rejects(saveEnv(db, A, conversationId, B, DB2, DB, 1), /not authorised/, 'creator device must belong to the caller');
  await assert.rejects(saveEnv(db, A, conversationId, A, DA2, DA, 1).then(() => saveEnv(db, A, conversationId, A, DA2, dev('ff'), 1)), /not authorised/);

  // THE multi-device fix: B's own non-creator device DB provisions B's second device DB2
  // while the bootstrap creator DA is still active (the old guard rejected exactly this).
  const second = await saveEnv(db, B, conversationId, B, DB2, DB, 1);
  assert.equal(second[0].device_id, DB2);
  assert.equal(second[0].creator_public_key, `{"kty":"EC","pub":"${DB}"}`, 'creator public key is recorded by the server, not supplied by the client');

  // Re-saving never overwrites an existing envelope.
  const again = await rows(db, A, 'select * from save_conversation_key_envelope($1,$2,$3,$4,$5,$6,1)',
    [conversationId, B, DB, 'ee'.repeat(48), HEX_NONCE, DA]);
  assert.equal(again[0].wrapped_key, HEX_KEY);

  // Messages can reference version 1 only until a version 2 exists.
  await insertMessage(db, A, conversationId, { keyVersion: 1 });
  await assert.rejects(insertMessage(db, A, conversationId, { keyVersion: 2 }), /Unknown conversation key version/);

  // Re-key: B's device claims v2; A is told it is busy; B mints and wraps for everybody.
  assert.equal(await claim(db, B, conversationId, DB2, 2), true);
  assert.equal(await claim(db, A, conversationId, DA, 2), false);
  await assert.rejects(saveEnv(db, A, conversationId, A, DA, DA, 2), /claimed by another/, 'only the claim holder may write the first v2 envelope');
  await saveEnv(db, B, conversationId, B, DB2, DB2, 2);
  await saveEnv(db, B, conversationId, A, DA, DB2, 2); // the claim holder wraps v2 for the peer's device too
  await insertMessage(db, B, conversationId, { keyVersion: 2 });
  await assert.rejects(insertMessage(db, B, conversationId, { keyVersion: 3 }), /Unknown conversation key version/);
  assert.equal(await claim(db, A, conversationId, DA, 2), false, 'v2 can no longer be minted once it has envelopes');
  assert.equal(await claim(db, A, conversationId, DA, 3), true, 'next version is claimable');

  // Old versions stay stored: nothing was deleted by the re-key.
  assert.equal((await db.query('select count(*)::int n from conversation_key_envelopes where key_version=1')).rows[0].n, 4);
});

test('abandoned claims are taken over; revoked creators cannot hold the lock', async () => {
  const { db, conversationId } = await createDb({ migrated: true });
  assert.equal(await claim(db, A, conversationId, DA, 1), true);
  assert.equal(await claim(db, B, conversationId, DB, 1), false);
  await db.exec(`update conversation_key_bootstrap set claimed_at = now() - interval '31 seconds'`);
  assert.equal(await claim(db, B, conversationId, DB, 1), true, 'stale lease is taken over');
  await db.exec(`update identity_devices set status='revoked' where device_id='${DB}'`);
  await assert.rejects(claim(db, B, conversationId, DB, 1), /not authorised/, 'revoked device cannot claim');
  assert.equal(await claim(db, A, conversationId, DA, 1), true, 'lock held by a revoked device is abandoned');
});

test('envelope input is validated server-side', async () => {
  const { db, conversationId } = await createDb({ migrated: true });
  await claim(db, A, conversationId, DA, 1);
  await assert.rejects(rows(db, A, 'select * from save_conversation_key_envelope($1,$2,$3,$4,$5,$6,1)', [conversationId, A, DA, 'not-hex!', HEX_NONCE, DA]), /Malformed/);
  await assert.rejects(rows(db, A, 'select * from save_conversation_key_envelope($1,$2,$3,$4,$5,$6,0)', [conversationId, A, DA, HEX_KEY, HEX_NONCE, DA]), /Invalid key version/);
  await assert.rejects(rows(db, null, 'select * from save_conversation_key_envelope($1,$2,$3,$4,$5,$6,1)', [conversationId, A, DA, HEX_KEY, HEX_NONCE, DA]), /permission denied/, 'anon cannot call the RPC');
});

test('backward compatibility: the currently deployed client (no key_version anywhere) keeps working on the new schema', async () => {
  const { db, conversationId } = await createDb({ migrated: true });
  // Old claim signature (2 args), old save signature (6 args), old message insert (no key_version column).
  assert.equal((await rows(db, A, 'select claim_conversation_key_bootstrap($1,$2) ok', [conversationId, DA]))[0].ok, true);
  const own = await rows(db, A, 'select * from save_conversation_key_envelope($1,$2,$3,$4,$5,$6)', [conversationId, A, DA, HEX_KEY, HEX_NONCE, DA]);
  assert.equal(own[0].key_version, 1);
  await rows(db, A, 'select * from save_conversation_key_envelope($1,$2,$3,$4,$5,$6)', [conversationId, B, DB, HEX_KEY, HEX_NONCE, DA]);
  const legacy = await insertMessage(db, A, conversationId, { legacy: true });
  assert.equal(legacy.rows.length, 1);
  assert.equal((await rows(db, B, 'select key_version from messages'))[0].key_version, 1, 'old rows/inserts are version 1');
  // The columns the old client selects still exist.
  await rows(db, B, 'select conversation_id,user_id,device_id,wrapped_key,nonce,created_by_device_id,created_at from conversation_key_envelopes');
  await rows(db, B, 'select id,conversation_id,sender_id,ciphertext,nonce,created_at,expires_at,burned_at from messages');
});
