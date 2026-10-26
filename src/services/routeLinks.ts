export type TravelMode = 'walk' | 'transit' | 'drive' | 'cycle';
export const TRAVEL_MODES: { id: TravelMode; label: string }[] = [
  { id: 'walk', label: 'Walk' }, { id: 'transit', label: 'Transit' }, { id: 'drive', label: 'Drive' }, { id: 'cycle', label: 'Cycle' },
];

export const isApplePlatform = (ua: string, maxTouchPoints = 0): boolean =>
  /iPhone|iPad|iPod/.test(ua) || (/Macintosh/.test(ua) && maxTouchPoints > 1);

/** Opens the phone's own maps app with a route to the venue. Only the venue's position is used, never the traveller's. */
export function routeUrl(dest: { lat: number; lng: number }, mode: TravelMode, apple: boolean): string {
  const d = `${dest.lat.toFixed(6)},${dest.lng.toFixed(6)}`;
  if (apple) {
    const flag = { walk: 'w', transit: 'r', drive: 'd', cycle: 'w' }[mode];
    return `https://maps.apple.com/?daddr=${d}&dirflg=${flag}`;
  }
  const travelmode = { walk: 'walking', transit: 'transit', drive: 'driving', cycle: 'bicycling' }[mode];
  return `https://www.google.com/maps/dir/?api=1&destination=${d}&travelmode=${travelmode}`;
}
