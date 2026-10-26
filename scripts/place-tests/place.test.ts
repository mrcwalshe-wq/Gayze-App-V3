import test from 'node:test';
import assert from 'node:assert/strict';
import { createPlaceSearchHandler, normalizePhoton } from '../../supabase/functions/place-search/handler.ts';

const photon = {
  features: [
    { geometry: { coordinates: [-0.1268, 51.5126] }, properties: { name: 'Timberyard', osm_key: 'amenity', osm_value: 'cafe', osm_type: 'N', osm_id: 1, housenumber: '7', street: 'Upper St Martin’s Lane', district: 'Covent Garden', city: 'London', postcode: 'WC2H 9DL' } },
    { geometry: { coordinates: [-0.1268, 51.5126] }, properties: { name: 'Timberyard', osm_value: 'cafe', osm_type: 'N', osm_id: 1 } },
    { geometry: { coordinates: [200, 51] }, properties: { name: 'Bad coords' } },
    { geometry: { coordinates: [-0.1, 51.5] }, properties: { osm_value: 'yes' } },
    { geometry: { coordinates: [-0.12, 51.51] }, properties: { street: 'Old Compton Street', housenumber: '12', city: 'London', osm_value: 'yes', osm_type: 'W', osm_id: 9 } },
  ],
};

const ok = (urls: string[]) => (async (url: string) => { urls.push(String(url)); return new Response(JSON.stringify(photon), { status: 200 }); }) as unknown as typeof fetch;
const req = (body: unknown, token: string | null = 't', method = 'POST') =>
  new Request('http://x/place-search', { method, headers: token ? { authorization: `Bearer ${token}` } : {}, body: method === 'POST' ? JSON.stringify(body) : undefined });
const auth = async (t: string) => (t === 't' ? 'user-1' : null);

test('normalises, dedupes and drops unusable features', () => {
  const r = normalizePhoton(photon);
  assert.equal(r.length, 2);
  assert.equal(r[0].name, 'Timberyard');
  assert.equal(r[0].kind, 'cafe');
  assert.match(r[0].address, /7 Upper St/);
  assert.equal(r[0].area, 'Covent Garden, London');
  assert.equal(r[1].name, '12 Old Compton Street');
  assert.equal(r[1].kind, '');
});

test('rejects unauthenticated and non-POST requests', async () => {
  const h = createPlaceSearchHandler({ authenticate: auth, fetchImpl: ok([]) });
  assert.equal((await h(req({ q: 'cafe' }, null))).status, 401);
  assert.equal((await h(req({ q: 'cafe' }, 'bad'))).status, 401);
  assert.equal((await h(req(null, 't', 'GET'))).status, 405);
});

test('validates the query', async () => {
  const h = createPlaceSearchHandler({ authenticate: auth, fetchImpl: ok([]) });
  assert.equal((await h(req({ q: 'a' }))).status, 400);
  assert.equal((await h(req({}))).status, 400);
});

test('rounds the position to ~1 km before it leaves the project', async () => {
  const urls: string[] = [];
  const h = createPlaceSearchHandler({ authenticate: auth, fetchImpl: ok(urls) });
  const res = await h(req({ q: 'timberyard', lat: 51.512637, lng: -0.126849 }));
  assert.equal(res.status, 200);
  const u = new URL(urls[0]);
  assert.equal(u.searchParams.get('lat'), '51.51');
  assert.equal(u.searchParams.get('lon'), '-0.13');
  assert.equal(u.searchParams.get('q'), 'timberyard');
  assert.equal((await res.json()).results.length, 2);
});

test('works without a position and ignores invalid ones', async () => {
  const urls: string[] = [];
  const h = createPlaceSearchHandler({ authenticate: auth, fetchImpl: ok(urls) });
  await h(req({ q: 'bar' }));
  await h(req({ q: 'bar', lat: 999, lng: 0 }));
  for (const u of urls) assert.equal(new URL(u).searchParams.has('lat'), false);
});

test('rate-limits per member and recovers', async () => {
  let t = 1000;
  const h = createPlaceSearchHandler({ authenticate: auth, fetchImpl: ok([]), now: () => t });
  for (let i = 0; i < 25; i++) assert.equal((await h(req({ q: 'cafe' }))).status, 200);
  assert.equal((await h(req({ q: 'cafe' }))).status, 429);
  t += 31_000;
  assert.equal((await h(req({ q: 'cafe' }))).status, 200);
});

test('an upstream failure is a clean 502, not a leak', async () => {
  const bad = (async () => new Response('boom', { status: 500 })) as unknown as typeof fetch;
  const thrown = (async () => { throw new Error('secret host down'); }) as unknown as typeof fetch;
  for (const f of [bad, thrown]) {
    const res = await createPlaceSearchHandler({ authenticate: auth, fetchImpl: f })(req({ q: 'cafe' }));
    assert.equal(res.status, 502);
    assert.deepEqual(await res.json(), { error: 'search_unavailable' });
  }
});

import { placeMessage } from '../../src/services/placeMessage.ts';
test('a shared place message has the place and a map link, and nothing about the sender', () => {
  const m = placeMessage({ name: 'Timberyard', address: '7 Upper St Martin’s Lane, WC2H 9DL', area: 'Covent Garden, London', lat: 51.5126, lng: -0.1268 });
  assert.match(m, /^Timberyard\n7 Upper St/);
  assert.match(m, /openstreetmap\.org\/\?mlat=51\.51260&mlon=-0\.12680/);
  assert.equal(m.split('\n').length, 3);
});

test('category search: nearest places of one kind, position rounded, bad input refused', async () => {
  const urls: string[] = [];
  const h = createPlaceSearchHandler({ authenticate: auth, fetchImpl: ok(urls) });
  const res = await h(req({ category: 'cafe', lat: 52.80123, lng: -1.23456 }));
  assert.equal(res.status, 200);
  assert.equal((await res.json()).results.length, 2);
  assert.match(urls[0], /photon\.komoot\.io\/reverse\?/);
  assert.match(urls[0], /lat=52\.8&lon=-1\.23/);
  assert.match(urls[0], /osm_tag=amenity%3Acafe/);
  assert.equal((await h(req({ category: 'nope', lat: 1, lng: 1 }))).status, 400);
  assert.equal((await h(req({ category: 'cafe' }))).status, 400);
});
