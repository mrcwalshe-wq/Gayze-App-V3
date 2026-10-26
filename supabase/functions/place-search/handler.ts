/**
 * Place search for signed-in members: a thin, privacy-preserving proxy to the free Photon geocoder
 * (OpenStreetMap data, https://photon.komoot.io). Runs server-side so:
 *  - the member's exact position is never sent to a third party: it is rounded to ~1 km first;
 *  - the browser never talks to the geocoder directly;
 *  - only signed-in members can use it, with a per-member rate limit (the upstream is shared and free).
 * Queries are never logged or stored.
 */
export interface PlaceResult { id: string; name: string; address: string; area: string; kind: string; lat: number; lng: number }

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

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { ...CORS, 'Content-Type': 'application/json', 'Cache-Control': 'no-store' } });

const round2 = (n: number) => Math.round(n * 100) / 100;
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

    let body: { q?: unknown; lat?: unknown; lng?: unknown };
    try { body = await req.json(); } catch { return json(400, { error: 'bad_request' }); }
    const q = clean(body.q, 80);
    if (q.length < 2) return json(400, { error: 'query_too_short' });

    const params = new URLSearchParams({ q, limit: '10', lang: 'en' });
    const lat = typeof body.lat === 'number' ? body.lat : NaN;
    const lng = typeof body.lng === 'number' ? body.lng : NaN;
    if (Number.isFinite(lat) && Number.isFinite(lng) && Math.abs(lat) <= 90 && Math.abs(lng) <= 180) {
      params.set('lat', String(round2(lat)));
      params.set('lon', String(round2(lng)));
      params.set('location_bias_scale', '0.4');
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
