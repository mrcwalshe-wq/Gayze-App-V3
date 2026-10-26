import { supabase } from './supabaseClient';

export interface PlaceResult { id: string; name: string; address: string; area: string; kind: string; lat: number; lng: number }
export { distanceKm, formatDistance, type LatLng } from './geo';
import type { LatLng } from './geo';

/** Search real places (OpenStreetMap data) near the member. Returns [] on any failure so callers can fall back to typing. */
export async function searchPlaces(query: string, near: LatLng | null, signal?: AbortSignal): Promise<PlaceResult[]> {
  const q = query.trim();
  if (!supabase || q.length < 2) return [];
  const { data, error } = await supabase.functions.invoke('place-search', {
    body: { q, lat: near?.lat, lng: near?.lng },
    ...(signal ? { signal } : {}),
  });
  if (error || !Array.isArray(data?.results)) throw new Error('place search unavailable');
  return data.results as PlaceResult[];
}

/** The nearest named places of one kind (cafe, bar, pub, restaurant, park, station) around the member. */
export async function nearbyPlaces(category: string, near: LatLng, signal?: AbortSignal): Promise<PlaceResult[]> {
  if (!supabase) return [];
  const { data, error } = await supabase.functions.invoke('place-search', {
    body: { category, lat: near.lat, lng: near.lng },
    ...(signal ? { signal } : {}),
  });
  if (error || !Array.isArray(data?.results)) throw new Error('place search unavailable');
  return data.results as PlaceResult[];
}
