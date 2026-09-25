import { supabase } from './supabaseClient';
import type { UserActiveIntent } from '../types';

export interface RightNowDiscoveryRow {
  intent_id: string; user_id: string; display_name: string; age: number | null; bio: string | null;
  avatar_path: string | null; neighborhood: string | null; mode: 'social' | 'private'; intent: string;
  description: string | null; expires_at: string; distance_m: number; map_lat: number; map_lng: number;
  reliability_score: number; verified_peers_count: number; safety_verified: boolean;
  travel_distance_label: string | null; can_host: string | null; travel_willingness: string | null;
}

export async function discoverRightNow(options?: { radiusMeters?: number; mode?: 'social' | 'private'; intent?: string }): Promise<RightNowDiscoveryRow[]> {
  if (!supabase) return [];
  const { data, error } = await supabase.rpc('discover_right_now', {
    p_radius_m: options?.radiusMeters ?? 5000, p_mode: options?.mode ?? null, p_intent: options?.intent ?? null,
  });
  if (error) throw error;
  return (data ?? []) as RightNowDiscoveryRow[];
}

export async function saveActiveIntent(intent: UserActiveIntent, location?: { lat: number; lng: number }) {
  if (!supabase) return null;
  const { data: userData, error: userError } = await supabase.auth.getUser();
  if (userError || !userData.user) throw userError ?? new Error('Authentication required');
  const point = location ? 'SRID=4326;POINT(' + location.lng + ' ' + location.lat + ')' : null;
  const { data, error } = await supabase.from('intents').insert({
    user_id: userData.user.id, mode: intent.mode, intent: intent.intent, description: intent.description,
    starts_at: new Date(intent.activatedAt).toISOString(), expires_at: new Date(intent.expiresAt).toISOString(),
    duration_label: intent.duration, travel_distance_label: intent.travelDistance, travel_willingness: intent.travelWillingness,
    can_host: intent.canHost, context: intent.context, area: intent.area, is_near_safe_haven: Boolean(intent.isNearSafeHaven),
    safe_haven_id: null, location: point, is_paused: Boolean(intent.isPaused),
  }).select('id,expires_at').single();
  if (error) throw error;
  return data;
}

export async function submitInterest(toUserId: string, intentId?: string) {
  if (!supabase) throw new Error('Supabase is not configured');
  const { data, error } = await supabase.rpc('submit_interest', { p_to_user: toUserId, p_intent_id: intentId ?? null });
  if (error) throw error;
  return data as { mutual: boolean; conversation_id: string | null };
}

export function subscribeToRightNow(onChange: () => void) {
  if (!supabase) return () => undefined;
  const channel = supabase.channel('gayze-right-now')
    .on('postgres_changes', { event: '*', schema: 'public', table: 'intents' }, onChange)
    .on('postgres_changes', { event: '*', schema: 'public', table: 'interests' }, onChange)
    .subscribe();
  return () => { void supabase.removeChannel(channel); };
}
