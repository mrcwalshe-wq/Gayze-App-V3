/**
 * Explicit map defaults when no authenticated user location is available.
 * These are NOT a product geography (not Soho / London / any venue).
 * Screens must prefer the live user location + privacy/jitter pipeline.
 */
export const FALLBACK_MAP_CENTER = {
  lat: 20,
  lng: 0,
} as const;

export const FALLBACK_MAP_ZOOM = 2;
export const LOCATED_MAP_ZOOM = 14;

/**
 * GAYZE travel-distance ceiling. Discovery never looks further than this.
 * The limit is enforced in the UI *and* by the live `discover_right_now` RPC,
 * so a larger value can never be requested successfully.
 */
export const MAX_TRAVEL_DISTANCE_KM = 5;

/**
 * Clamp a requested travel distance into the supported 1..5 km range. Anything
 * out of range — including a hand-crafted 10 km / 25 km request — collapses to
 * the ceiling rather than widening discovery.
 */
export function clampTravelDistanceKm(km: number): number {
  if (!Number.isFinite(km) || Number.isNaN(km)) return MAX_TRAVEL_DISTANCE_KM;
  if (km <= 0) return MAX_TRAVEL_DISTANCE_KM;
  return Math.min(km, MAX_TRAVEL_DISTANCE_KM);
}

/** Neutral area label when neighbourhood cannot be resolved. */
export const NEUTRAL_AREA_LABEL = 'Near you';

export function resolveAreaLabel(neighborhood?: string | null): string {
  const value = (neighborhood || '').trim();
  if (!value) return NEUTRAL_AREA_LABEL;
  const lowered = value.toLowerCase();
  if (
    lowered === 'soho' ||
    lowered === 'soho / covent garden' ||
    lowered === 'central london'
  ) {
    return NEUTRAL_AREA_LABEL;
  }
  return value;
}
