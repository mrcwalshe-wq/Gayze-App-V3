import { supabase } from './supabaseClient';
import type { LatLng } from './geo';

export type RouteMode = 'walk' | 'drive' | 'cycle';
export interface RouteStep { text: string; distanceM: number }
export interface RouteSummary { distanceM: number; durationS: number; steps: RouteStep[] }

/** Turn-by-turn directions on foot, by bike or by car. Throws when no route could be found or the service is down. */
export async function fetchRoute(from: LatLng, to: LatLng, mode: RouteMode, signal?: AbortSignal): Promise<RouteSummary> {
  if (!supabase) throw new Error('directions unavailable');
  const { data, error } = await supabase.functions.invoke('place-search', {
    body: { route: { from, to, mode } },
    ...(signal ? { signal } : {}),
  });
  if (error || !data?.route) throw new Error('directions unavailable');
  return data.route as RouteSummary;
}

export const formatDuration = (seconds: number): string => {
  const m = Math.max(1, Math.round(seconds / 60));
  return m < 60 ? `${m} min` : `${Math.floor(m / 60)} h ${m % 60 ? `${m % 60} min` : ''}`.trim();
};
