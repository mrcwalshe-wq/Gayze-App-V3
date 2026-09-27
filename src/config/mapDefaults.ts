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
