/**
 * Place search for signed-in members: a thin, privacy-preserving proxy to the free Photon geocoder
 * (OpenStreetMap data, https://photon.komoot.io). Runs server-side so:
 *  - the member's exact position is never sent to a third party: it is rounded to ~1 km first;
 *  - the browser never talks to the geocoder directly;
 *  - only signed-in members can use it, with a per-member rate limit (the upstream is shared and free).
 * Queries are never logged or stored.
 */
export interface PlaceResult { id: string; name: string; address: string; area: string; kind: string; lat: number; lng: number }

export interface RouteStep { text: string; distanceM: number }
export interface RouteResult { distanceM: number; durationS: number; steps: RouteStep[] }

export interface PlaceSearchDeps {
  authenticate: (token: string) => Promise<string | null>;
  fetchImpl?: typeof fetch;
  now?: () => number;
  upstream?: string;
}

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};
const RATE_WINDOW_MS = 30_000;
const RATE_MAX = 25;
const UPSTREAM = 'https://photon.komoot.io/api/';

/** Quick categories: the OpenStreetMap tag to look for near the member. */
const CATEGORIES: Record<string, string> = {
  cafe: 'amenity:cafe',
  bar: 'amenity:bar',
  pub: 'amenity:pub',
  restaurant: 'amenity:restaurant',
  park: 'leisure:park',
  station: 'railway:station',
};
/** Free OSM routing by FOSSGIS (OSRM). Public transport is not available here: the app opens the phone's maps app for that. */
const ROUTERS: Record<string, string> = {
  walk: 'https://routing.openstreetmap.de/routed-foot/route/v1/foot',
  drive: 'https://routing.openstreetmap.de/routed-car/route/v1/driving',
  cycle: 'https://routing.openstreetmap.de/routed-bike/route/v1/bike',
};
const CATEGORY_RADIUS_KM: Record<string, number> = { park: 3, station: 6 };

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { ...CORS, 'Content-Type': 'application/json', 'Cache-Control': 'no-store' } });

const round2 = (n: number) => Math.round(n * 100) / 100;
const round3 = (n: number) => Math.round(n * 1000) / 1000;
const clean = (v: unknown, max = 120) => (typeof v === 'string' ? v.replace(/[\u0000-\u001f]/g, ' ').trim().slice(0, max) : '');

export function normalizePhoton(data: unknown): PlaceResult[] {
  const features = Array.isArray((data as { features?: unknown })?.features) ? (data as { features: unknown[] }).features : [];
  const seen = new Set<string>();
  const out: PlaceResult[] = [];
  for (const f of features) {
    const p = (f as { properties?: Record<string, unknown> })?.properties ?? {};
    const c = (f as { geometry?: { coordinates?: unknown } })?.geometry?.coordinates;
    if (!Array.isArray(c) || typeof c[0] !== 'number' || typeof c[1] !== 'number') continue;
    const lng = c[0], lat = c[1];
    if (!Number.isFinite(lat) || !Number.isFinite(lng) || Math.abs(lat) > 90 || Math.abs(lng) > 180) continue;
    const street = [clean(p.housenumber, 12), clean(p.street)].filter(Boolean).join(' ');
    const name = clean(p.name) || street;
    if (!name) continue;
    const area = [clean(p.district) || clean(p.suburb) || clean(p.locality), clean(p.city) || clean(p.county)].filter(Boolean).filter((v, i, a) => a.indexOf(v) === i).join(', ');
    const address = [street && street !== name ? street : '', clean(p.postcode, 12)].filter(Boolean).join(', ');
    const key = `${name.toLowerCase()}|${lat.toFixed(4)}|${lng.toFixed(4)}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const kind = clean(p.osm_value, 40).replace(/_/g, ' ');
    out.push({ id: `${clean(p.osm_type, 1)}${clean(String(p.osm_id ?? ''), 20)}` || key, name, address, area, kind: kind === 'yes' ? '' : kind, lat, lng });
    if (out.length >= 8) break;
  }
  return out;
}

const COMPASS = ['north', 'north-east', 'east', 'south-east', 'south', 'south-west', 'west', 'north-west'];
const ORDINAL = ['', 'first', 'second', 'third', 'fourth', 'fifth', 'sixth'];

/** One plain-English instruction from an OSRM step. */
export function stepText(step: unknown): string {
  const st = step as { name?: unknown; maneuver?: { type?: string; modifier?: string; bearing_after?: number; exit?: number } };
  const m = st?.maneuver ?? {};
  const road = clean(st?.name, 80);
  const onto = road ? ` onto ${road}` : '';
  const mod = (m.modifier ?? '').replace('slight ', 'slightly ');
  switch (m.type) {
    case 'depart': return `Head ${typeof m.bearing_after === 'number' ? COMPASS[Math.round(m.bearing_after / 45) % 8] : 'off'}${road ? ` on ${road}` : ''}`;
    case 'arrive': return 'Arrive at your destination';
    case 'turn': return mod === 'straight' ? `Continue straight${onto}` : `Turn ${mod || 'ahead'}${onto}`;
    case 'end of road': return `At the end of the road turn ${mod || 'ahead'}${onto}`;
    case 'fork': return `Keep ${mod.includes('left') ? 'left' : 'right'} at the fork${onto}`;
    case 'merge': return `Merge${onto}`;
    case 'on ramp': case 'off ramp': return `Take the ramp${onto}`;
    case 'roundabout': case 'rotary': return `At the roundabout take the ${ORDINAL[m.exit ?? 0] || 'next'} exit${onto}`;
    case 'roundabout turn': return `At the roundabout turn ${mod || 'ahead'}${onto}`;
    default: return road ? `Continue on ${road}` : 'Continue';
  }
}

export function normalizeRoute(data: unknown): RouteResult | null {
  const route = (data as { routes?: { distance?: number; duration?: number; legs?: { steps?: unknown[] }[] }[] })?.routes?.[0];
  if (!route || typeof route.distance !== 'number' || typeof route.duration !== 'number') return null;
  const steps: RouteStep[] = [];
  for (const leg of route.legs ?? []) for (const step of leg.steps ?? []) {
    const d = (step as { distance?: number }).distance;
    steps.push({ text: stepText(step), distanceM: Math.round(typeof d === 'number' && Number.isFinite(d) ? d : 0) });
  }
  return { distanceM: Math.round(route.distance), durationS: Math.round(route.duration), steps: steps.slice(0, 60) };
}

export function createPlaceSearchHandler(deps: PlaceSearchDeps) {
  const fetchImpl = deps.fetchImpl ?? fetch;
  const now = deps.now ?? Date.now;
  const upstream = deps.upstream ?? UPSTREAM;
  const hits = new Map<string, number[]>();

  return async (req: Request): Promise<Response> => {
    if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
    if (req.method !== 'POST') return json(405, { error: 'method_not_allowed' });

    const token = (req.headers.get('authorization') ?? '').replace(/^Bearer\s+/i, '');
    const userId = token ? await deps.authenticate(token) : null;
    if (!userId) return json(401, { error: 'unauthorized' });

    const t = now();
    const recent = (hits.get(userId) ?? []).filter((x) => t - x < RATE_WINDOW_MS);
    if (recent.length >= RATE_MAX) return json(429, { error: 'slow_down' });
    recent.push(t);
    hits.set(userId, recent);
    if (hits.size > 5000) for (const [k, v] of hits) if (!v.some((x) => t - x < RATE_WINDOW_MS)) hits.delete(k);

    let body: { q?: unknown; lat?: unknown; lng?: unknown; category?: unknown; route?: unknown };
    try { body = await req.json(); } catch { return json(400, { error: 'bad_request' }); }
    if (body.route && typeof body.route === 'object') {
      const r = body.route as { from?: { lat?: unknown; lng?: unknown }; to?: { lat?: unknown; lng?: unknown }; mode?: unknown };
      const base = typeof r.mode === 'string' ? ROUTERS[r.mode] : undefined;
      const ok = (v: unknown, lim: number) => typeof v === 'number' && Number.isFinite(v) && Math.abs(v) <= lim;
      if (!base || !ok(r.from?.lat, 90) || !ok(r.from?.lng, 180) || !ok(r.to?.lat, 90) || !ok(r.to?.lng, 180)) return json(400, { error: 'bad_request' });
      // The start is rounded to ~100 m before it leaves GAYZE; the destination is the venue itself.
      const path = `${round3(r.from!.lng as number)},${round3(r.from!.lat as number)};${(r.to!.lng as number).toFixed(6)},${(r.to!.lat as number).toFixed(6)}`;
      try {
        const res = await fetchImpl(`${base}/${path}?steps=true&overview=false&alternatives=false`, {
          headers: { 'User-Agent': 'GAYZE/1.0 (+https://gayze.co.uk)', Accept: 'application/json' },
          signal: AbortSignal.timeout(7000),
        });
        if (!res.ok) return json(502, { error: 'search_unavailable' });
        const route = normalizeRoute(await res.json());
        return route ? json(200, { route, attribution: '© OpenStreetMap contributors' }) : json(404, { error: 'no_route' });
      } catch {
        return json(502, { error: 'search_unavailable' });
      }
    }

    const category = typeof body.category === 'string' ? body.category : '';
    if (category) {
      const tag = CATEGORIES[category];
      const cLat = typeof body.lat === 'number' ? body.lat : NaN, cLng = typeof body.lng === 'number' ? body.lng : NaN;
      if (!tag || !Number.isFinite(cLat) || !Number.isFinite(cLng) || Math.abs(cLat) > 90 || Math.abs(cLng) > 180) return json(400, { error: 'bad_request' });
      // The nearest places of that kind around the member. Their position is rounded to ~1 km before it leaves GAYZE.
      const near = new URLSearchParams({
        lat: String(round2(cLat)), lon: String(round2(cLng)), radius: String(CATEGORY_RADIUS_KM[category] ?? 2.5),
        limit: '30', lang: 'en', osm_tag: tag,
      });
      try {
        const res = await fetchImpl(`${upstream.replace(/\/api\/?$/, '')}/reverse?${near}`, {
          headers: { 'User-Agent': 'GAYZE/1.0 (+https://gayze.co.uk)', Accept: 'application/json' },
          signal: AbortSignal.timeout(6000),
        });
        if (!res.ok) return json(502, { error: 'search_unavailable' });
        return json(200, { results: normalizePhoton(await res.json()), attribution: '© OpenStreetMap contributors' });
      } catch {
        return json(502, { error: 'search_unavailable' });
      }
    }

    const q = clean(body.q, 80);
    if (q.length < 2) return json(400, { error: 'query_too_short' });

    const params = new URLSearchParams({ q, limit: '10', lang: 'en' });
    const lat = typeof body.lat === 'number' ? body.lat : NaN;
    const lng = typeof body.lng === 'number' ? body.lng : NaN;
    if (Number.isFinite(lat) && Number.isFinite(lng) && Math.abs(lat) <= 90 && Math.abs(lng) <= 180) {
      params.set('lat', String(round2(lat)));
      params.set('lon', String(round2(lng)));
      params.set('location_bias_scale', '0.8');
    }

    try {
      const res = await fetchImpl(`${upstream}?${params}`, {
        headers: { 'User-Agent': 'GAYZE/1.0 (+https://gayze.co.uk)', Accept: 'application/json' },
        signal: AbortSignal.timeout(6000),
      });
      if (!res.ok) return json(502, { error: 'search_unavailable' });
      return json(200, { results: normalizePhoton(await res.json()), attribution: '© OpenStreetMap contributors' });
    } catch {
      return json(502, { error: 'search_unavailable' });
    }
  };
}
