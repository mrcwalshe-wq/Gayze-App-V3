export interface LatLng { lat: number; lng: number }

/** Great-circle distance in km. */
export function distanceKm(a: LatLng, b: LatLng): number {
  const rad = (d: number) => (d * Math.PI) / 180;
  const dLat = rad(b.lat - a.lat), dLng = rad(b.lng - a.lng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * 6371 * Math.asin(Math.sqrt(h));
}

export function formatDistance(km: number): string {
  if (km < 0.95) return `${Math.max(50, Math.round(km * 10) * 100)} m`;
  return `${km < 10 ? km.toFixed(1) : Math.round(km)} km`;
}
