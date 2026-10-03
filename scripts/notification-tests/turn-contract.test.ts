import assert from 'node:assert/strict';
import { test } from 'node:test';
import { IceCredentialCache, iceExpiry } from '../../src/services/iceCredentials.ts';

test('documented TURN expiry formats normalize to the same deadline; absent TTL is not fabricated',()=>{
  const now=1_800_000_000_000,expiry=now+300_000;
  for(const response of [{expiresAt:expiry},{expiresAt:expiry/1000},{expiresAt:String(expiry/1000)},
    {expiresAt:new Date(expiry).toISOString()},{expires_at:new Date(expiry).toISOString()},{ttl:300},{ttlSeconds:300}]){
    assert.equal(iceExpiry(response,now),expiry);
  }
  assert.equal(iceExpiry({},now),undefined);assert.equal(iceExpiry({ttl:-1},now),undefined);
});
test('TURN refresh occurs early under supplied TTL and drops provider-only metadata',async()=>{
  let now=1_800_000_000_000,fetches=0;
  const cache=new IceCredentialCache(async()=>{fetches++;return {ttl:300,providerSecret:'must-not-be-retained',iceServers:[{
    urls:'turn:existing-provider.example:3478',username:'temporary',credential:'ephemeral',providerSecret:'must-not-be-retained',
  }]};},()=>now);
  const servers=await cache.get();assert.equal(cache.nextRefreshAt,now+240_000);
  assert.deepEqual(Object.keys(servers[0]).sort(),['credential','urls','username']);
  now+=239_999;await cache.get();assert.equal(fetches,1);now+=1;await cache.get();assert.equal(fetches,2);
});
test('TURN rejects expired/malformed relay credentials without echoing secret values',async()=>{
  const now=1_800_000_000_000;
  for(const response of [{expiresAt:now,iceServers:[{urls:'turn:relay',username:'u',credential:'test-only'}]},
    {ttl:300,iceServers:[{urls:'turn:relay',username:'u',credential:{secret:'do-not-echo'}}]},
    {ttl:300,iceServers:[null]}]){
    const cache=new IceCredentialCache(async()=>response as any,()=>now);
    await assert.rejects(cache.get(),error=>!String(error).includes('do-not-echo')&&!String(error).includes('test-only'));
  }
});
