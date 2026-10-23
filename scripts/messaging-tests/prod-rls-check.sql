-- Production RLS / key-protocol check. SAFE TO RUN AGAINST PRODUCTION: it creates
-- three throwaway users inside one transaction, exercises the policies under the
-- real `anon` / `authenticated` roles with JWT claims, and ALWAYS ends by raising
-- an exception, so every row it creates is rolled back. The exception text is the
-- report: each line is PASS or FAIL. Run it with the Supabase SQL editor / MCP
-- execute_sql. (Last run 2026-10-23 against qdewyupsqmtonkloqxsh: 48/48 PASS.)
do $t$
declare
  a uuid := gen_random_uuid(); b uuid := gen_random_uuid(); c uuid := gen_random_uuid();
  da uuid := gen_random_uuid(); db uuid := gen_random_uuid(); db2 uuid := gen_random_uuid(); dc uuid := gen_random_uuid();
  conv uuid; interest uuid; m1 uuid := gen_random_uuid(); k text := repeat('ab',48); nn text := repeat('cd',12); out text;
begin
  perform set_config('t.res','',true);
  create function pg_temp.t_log(label text, ok boolean, detail text) returns void language plpgsql as $f$
  begin perform set_config('t.res', current_setting('t.res', true) || (case when ok then 'PASS ' else 'FAIL ' end) || label || ' [' || left(coalesce(detail,''),110) || ']' || E'\n', true); end $f$;
  create function pg_temp.t_err(label text, who uuid, rl text, q text) returns void language plpgsql as $f$
  begin
    perform set_config('request.jwt.claim.sub', coalesce(who::text,''), true); execute 'set local role '||rl;
    begin execute q; execute 'reset role'; perform pg_temp.t_log(label,false,'no error raised');
    exception when others then execute 'reset role'; perform pg_temp.t_log(label,true,sqlerrm); end;
  end $f$;
  create function pg_temp.t_ok(label text, who uuid, rl text, q text) returns void language plpgsql as $f$
  begin
    perform set_config('request.jwt.claim.sub', coalesce(who::text,''), true); execute 'set local role '||rl;
    begin execute q; execute 'reset role'; perform pg_temp.t_log(label,true,'');
    exception when others then execute 'reset role'; perform pg_temp.t_log(label,false,sqlerrm); end;
  end $f$;
  create function pg_temp.t_val(label text, who uuid, rl text, q text, expected text) returns void language plpgsql as $f$
  declare v text;
  begin
    perform set_config('request.jwt.claim.sub', coalesce(who::text,''), true); execute 'set local role '||rl;
    begin execute q into v; execute 'reset role'; perform pg_temp.t_log(label, v is not distinct from expected, 'got '||coalesce(v,'null')||' expected '||expected);
    exception when others then execute 'reset role'; perform pg_temp.t_log(label,false,sqlerrm); end;
  end $f$;

  -- setup (as owner): three throwaway users, devices, a mutual interest, accepted by B exactly as the app does
  insert into auth.users(id, aud, role, email, instance_id) select x, 'authenticated','authenticated', x::text||'@test.invalid','00000000-0000-0000-0000-000000000000' from unnest(array[a,b,c]) x;
  insert into public.profiles(id, handle, display_name) values (a,'t_'||substr(a::text,1,8),'T A'),(b,'t_'||substr(b::text,1,8),'T B'),(c,'t_'||substr(c::text,1,8),'T C');
  insert into public.identity_devices(user_id, device_id, device_fingerprint, identity_fingerprint, public_key, signing_public_key, status)
    values (a,da,'dev_'||da,'idfp_'||repeat('a',20),'{"kty":"EC","crv":"P-256","x":"a","y":"a"}','{"kty":"EC","k":"sig-a-pad-pad-pad-pad-pad-pad-pad-pad"}','active'),
           (b,db,'dev_'||db,'idfp_'||repeat('b',20),'{"kty":"EC","crv":"P-256","x":"b","y":"b"}','{"kty":"EC","k":"sig-b-pad-pad-pad-pad-pad-pad-pad-pad"}','active'),
           (b,db2,'dev_'||db2,'idfp_'||repeat('b',20),'{"kty":"EC","crv":"P-256","x":"b2","y":"b2"}','{"kty":"EC","k":"sig-b2-pad-pad-pad-pad-pad-pad-pad-pad"}','active'),
           (c,dc,'dev_'||dc,'idfp_'||repeat('c',20),'{"kty":"EC","crv":"P-256","x":"c","y":"c"}','{"kty":"EC","k":"sig-c-pad-pad-pad-pad-pad-pad-pad-pad"}','active');
  insert into public.interests(from_user_id,to_user_id) values (a,b) returning id into interest;
  perform set_config('request.jwt.claim.sub', b::text, true); set local role authenticated;
  select (public.accept_interest(interest)->>'conversation_id')::uuid into conv;
  reset role;
  perform pg_temp.t_log('setup: accept_interest created conversation', conv is not null, conv::text);
  perform pg_temp.t_log('setup: conversation has exactly 2 members', (select count(*) from conversation_members where conversation_id=conv)=2, '');

  -- anon
  perform pg_temp.t_err('anon cannot read messages', null, 'anon', 'select * from public.messages');
  perform pg_temp.t_err('anon cannot insert messages', null, 'anon', format('insert into public.messages(conversation_id,sender_id,ciphertext,nonce) values (%L,%L,''aa'',''bb'')', conv, a));
  perform pg_temp.t_err('anon cannot truncate messages', null, 'anon', 'truncate public.messages');
  perform pg_temp.t_err('anon cannot call save_conversation_key_envelope', null, 'anon', format('select public.save_conversation_key_envelope(%L,%L,%L,%L,%L,%L,1)', conv,a,da,k,nn,da));
  -- non-member C: self-join exploit and reads
  perform pg_temp.t_err('non-member self-join (member_self_all exploit) rejected', c, 'authenticated', format('insert into public.conversation_members(conversation_id,user_id) values (%L,%L)', conv, c));
  perform pg_temp.t_err('non-member cannot update memberships', c, 'authenticated', format('update public.conversation_members set user_id=%L where conversation_id=%L', c, conv));
  perform pg_temp.t_err('non-member cannot insert a message', c, 'authenticated', format('insert into public.messages(conversation_id,sender_id,ciphertext,nonce) values (%L,%L,''aa'',''bb'')', conv, c));
  perform pg_temp.t_err('authenticated cannot truncate messages', c, 'authenticated', 'truncate public.messages');
  perform pg_temp.t_err('authenticated cannot truncate conversation_members', c, 'authenticated', 'truncate public.conversation_members');
  perform pg_temp.t_err('non-member cannot claim key bootstrap', c, 'authenticated', format('select public.claim_conversation_key_bootstrap(%L,%L,1)', conv, dc));
  perform pg_temp.t_err('non-member cannot save envelope', c, 'authenticated', format('select public.save_conversation_key_envelope(%L,%L,%L,%L,%L,%L,1)', conv,c,dc,k,nn,dc));
  perform pg_temp.t_err('user cannot insert identity_devices row directly', a, 'authenticated', format('insert into public.identity_devices(user_id,device_id,public_key) values (%L,gen_random_uuid(),''x'')', a));
  perform pg_temp.t_err('user cannot un-revoke/modify identity_devices directly', a, 'authenticated', format('update public.identity_devices set status=''active'' where user_id=%L', a));
  -- messaging A -> B, B reply
  perform pg_temp.t_ok('A sends message (persist)', a, 'authenticated', format('insert into public.messages(id,conversation_id,sender_id,ciphertext,nonce,client_message_id,key_version) values (%L,%L,%L,''aa11'',''bb22'',''cid-1'',1)', m1, conv, a));
  perform pg_temp.t_err('duplicate submit (same id) rejected', a, 'authenticated', format('insert into public.messages(id,conversation_id,sender_id,ciphertext,nonce,client_message_id) values (%L,%L,%L,''aa11'',''bb22'',''cid-x'')', m1, conv, a));
  perform pg_temp.t_err('duplicate submit (same client_message_id) rejected', a, 'authenticated', format('insert into public.messages(conversation_id,sender_id,ciphertext,nonce,client_message_id) values (%L,%L,''aa11'',''bb22'',''cid-1'')', conv, a));
  perform pg_temp.t_err('A cannot send as B (sender spoof)', a, 'authenticated', format('insert into public.messages(conversation_id,sender_id,ciphertext,nonce) values (%L,%L,''aa'',''bb'')', conv, b));
  perform pg_temp.t_val('B receives A message (members read)', b, 'authenticated', format('select count(*)::text from public.messages where conversation_id=%L', conv), '1');
  perform pg_temp.t_ok('B replies', b, 'authenticated', format('insert into public.messages(conversation_id,sender_id,ciphertext,nonce,client_message_id) values (%L,%L,''cc33'',''dd44'',''cid-b1'')', conv, b));
  perform pg_temp.t_val('A sees both messages', a, 'authenticated', format('select count(*)::text from public.messages where conversation_id=%L', conv), '2');
  perform pg_temp.t_val('non-member sees 0 messages', c, 'authenticated', format('select count(*)::text from public.messages where conversation_id=%L', conv), '0');
  perform pg_temp.t_err('member cannot rewrite ciphertext (UPDATE)', a, 'authenticated', format('update public.messages set ciphertext=''ff'' where id=%L', m1));
  perform pg_temp.t_err('member cannot DELETE messages', a, 'authenticated', format('delete from public.messages where id=%L', m1));
  -- key protocol with OLD client signatures (backward compatibility) and new
  perform pg_temp.t_val('old 2-arg claim shim: A wins first claim', a, 'authenticated', format('select public.claim_conversation_key_bootstrap(%L,%L)::text', conv, da), 'true');
  perform pg_temp.t_val('B cannot claim concurrently (busy)', b, 'authenticated', format('select public.claim_conversation_key_bootstrap(%L,%L,1)::text', conv, db), 'false');
  perform pg_temp.t_ok('old 6-arg save shim: creator stores own envelope', a, 'authenticated', format('select public.save_conversation_key_envelope(%L,%L,%L,%L,%L,%L)', conv,a,da,k,nn,da));
  perform pg_temp.t_ok('creator wraps for B device', a, 'authenticated', format('select public.save_conversation_key_envelope(%L,%L,%L,%L,%L,%L,1)', conv,b,db,k,nn,da));
  perform pg_temp.t_ok('ROOT-CAUSE FIX: non-creator holder (B) provisions B second device', b, 'authenticated', format('select public.save_conversation_key_envelope(%L,%L,%L,%L,%L,%L,1)', conv,b,db2,k,nn,db));
  perform pg_temp.t_val('server records creator public key', b, 'authenticated', format('select (creator_public_key like ''%%"x":"b"%%'')::text from public.conversation_key_envelopes where conversation_id=%L and device_id=%L', conv, db2), 'true');
  perform pg_temp.t_err('non-holder C-style device cannot inject envelope as someone else''s device', a, 'authenticated', format('select public.save_conversation_key_envelope(%L,%L,%L,%L,%L,%L,1)', conv,b,db2,k,nn,db));
  perform pg_temp.t_val('existing envelope is never overwritten', a, 'authenticated', format('select (wrapped_key=%L)::text from public.save_conversation_key_envelope(%L,%L,%L,%L,%L,%L,1)', k, conv,b,db,repeat('ee',48),nn,da), 'true');
  perform pg_temp.t_err('malformed envelope rejected', a, 'authenticated', format('select public.save_conversation_key_envelope(%L,%L,%L,''not-hex!'',%L,%L,1)', conv,a,da,nn,da));
  perform pg_temp.t_err('message with unknown key version 2 rejected before re-key', a, 'authenticated', format('insert into public.messages(conversation_id,sender_id,ciphertext,nonce,key_version) values (%L,%L,''aa'',''bb'',2)', conv, a));
  -- re-key
  perform pg_temp.t_val('re-key: B second device claims v2', b, 'authenticated', format('select public.claim_conversation_key_bootstrap(%L,%L,2)::text', conv, db2), 'true');
  perform pg_temp.t_val('re-key: A cannot claim v2 concurrently', a, 'authenticated', format('select public.claim_conversation_key_bootstrap(%L,%L,2)::text', conv, da), 'false');
  perform pg_temp.t_err('re-key: only claim holder writes first v2 envelope', a, 'authenticated', format('select public.save_conversation_key_envelope(%L,%L,%L,%L,%L,%L,2)', conv,a,da,k,nn,da));
  perform pg_temp.t_ok('re-key: v2 envelope for B device', b, 'authenticated', format('select public.save_conversation_key_envelope(%L,%L,%L,%L,%L,%L,2)', conv,b,db2,k,nn,db2));
  perform pg_temp.t_ok('re-key: v2 envelope for A device', b, 'authenticated', format('select public.save_conversation_key_envelope(%L,%L,%L,%L,%L,%L,2)', conv,a,da,k,nn,db2));
  perform pg_temp.t_ok('message encrypted under v2 accepted', b, 'authenticated', format('insert into public.messages(conversation_id,sender_id,ciphertext,nonce,key_version) values (%L,%L,''ee55'',''ff66'',2)', conv, b));
  perform pg_temp.t_err('message with key version 3 rejected', b, 'authenticated', format('insert into public.messages(conversation_id,sender_id,ciphertext,nonce,key_version) values (%L,%L,''aa'',''bb'',3)', conv, b));
  perform pg_temp.t_val('old v1 envelopes preserved after re-key', a, 'authenticated', format('select count(*)::text from public.conversation_key_envelopes where conversation_id=%L and key_version=1', conv), '3');
  -- crossed accept does not create a second conversation
  insert into public.interests(from_user_id,to_user_id) values (b,a) returning id into interest;
  perform pg_temp.t_val('crossed accept reuses the conversation', a, 'authenticated', format('select (public.accept_interest(%L)->>''conversation_id'')::uuid = %L', interest, conv), 'true');
  perform pg_temp.t_val('still exactly one conversation for the pair', a, 'authenticated', format('select count(distinct cm.conversation_id)::text from public.conversation_members cm join public.conversation_members o on o.conversation_id=cm.conversation_id where cm.user_id=%L and o.user_id=%L', a, b), '1');
  -- leaving removes access
  perform pg_temp.t_ok('B leaves conversation (delete chat)', b, 'authenticated', format('select public.leave_conversation(%L)', conv));
  perform pg_temp.t_val('B can no longer read the thread', b, 'authenticated', format('select count(*)::text from public.messages where conversation_id=%L', conv), '0');
  perform pg_temp.t_val('A still reads the thread', a, 'authenticated', format('select count(*)::text from public.messages where conversation_id=%L', conv), '3');

  out := current_setting('t.res', true);
  raise exception E'ROLLBACK_AFTER_TEST\n%', out;
end
$t$;
