import type { SafeHaven } from '../types';
import { distanceKm, type LatLng } from './geo';

/** Safe Havens with their real distance from `from` (km, in approxDistanceKm), nearest first. Unchanged when `from` is unknown. */
export function withDistances(havens: SafeHaven[], from?: LatLng | null): SafeHaven[] {
  if (!from) return havens;
  return havens
    .map((h) => (Number.isFinite(h.lat) && Number.isFinite(h.lng) ? { ...h, approxDistanceKm: Math.round(distanceKm(from, { lat: h.lat, lng: h.lng }) * 10) / 10 } : h))
    .sort((a, b) => a.approxDistanceKm - b.approxDistanceKm);
}
