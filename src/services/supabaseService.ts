import { supabase } from './supabaseClient';
import type { UserActiveIntent, Pulse } from '../types';
import { INITIAL_USER } from './storageService';

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


export async function ensureSupabaseSession() {
  if (!supabase) return null;
  const { data: sessionData } = await supabase.auth.getSession();
  if (sessionData.session?.user) return sessionData.session.user;

  const { data, error } = await supabase.auth.signInAnonymously();
  if (error) throw error;
  return data.user;
}

export async function ensureSupabaseProfile(userId: string, sourceUser = INITIAL_USER) {
  if (!supabase) return null;
  const { data, error } = await supabase.from('profiles').upsert({
    id: userId,
    handle: sourceUser.handle || 'gayze-user',
    display_name: sourceUser.displayName || 'Gayze User',
    bio: sourceUser.bio || null,
    age: null,
    privacy_setting: sourceUser.privacySetting || 'fuzzy_500m',
    reliability_score: sourceUser.reliabilityScore || 94,
    verified_peers_count: sourceUser.verifiedPeersCount || 0,
    safety_verified: Boolean(sourceUser.safetyVerified),
    neighborhood: sourceUser.neighborhood || null,
  }, { onConflict: 'id' }).select('*').single();
  if (error) throw error;
  return data;
}

export function discoveryRowsToPulses(rows: RightNowDiscoveryRow[]): Pulse[] {
  return rows.map((row) => ({
    id: `supabase_${row.intent_id}`,
    peerId: row.user_id,
    peerName: row.display_name || 'Gayze member',
    peerShortKey: row.user_id.slice(0, 8) + '...',
    peerAvatar: row.avatar_path || 'user',
    peerAge: row.age ?? undefined,
    title: `${row.mode.toUpperCase()} · ${row.intent}`,
    description: row.description || `Available for ${row.intent.toLowerCase()} nearby.`,
    activityCategory: row.intent.toLowerCase().includes('drink') ? 'drinks'
      : row.intent.toLowerCase().includes('meet') ? 'coffee'
      : row.intent.toLowerCase().includes('walk') ? 'walk'
      : row.mode === 'private' ? 'chill' : 'active',
    intentMode: row.mode,
    intent: row.intent as Pulse['intent'],
    travelDistance: row.travel_distance_label || undefined,
    canHost: row.can_host || undefined,
    travelWillingness: row.travel_willingness || undefined,
    venueName: row.neighborhood || 'Nearby',
    neighborhood: row.neighborhood || 'Nearby',
    approxDistanceKm: row.distance_m / 1000,
    jitterMeters: 300,
    lat: row.map_lat,
    lng: row.map_lng,
    durationHours: Math.max(1, Math.ceil((new Date(row.expires_at).getTime() - Date.now()) / 3600000)),
    createdAt: Date.now(),
    expiresAt: new Date(row.expires_at).getTime(),
    tags: [row.intent, row.mode],
    isPaused: false,
  }));
}

export async function saveActiveIntentWithSession(
  intent: UserActiveIntent,
  location?: { lat: number; lng: number },
  sourceUser = INITIAL_USER,
) {
  const user = await ensureSupabaseSession();
  if (!user) throw new Error('Unable to create a Supabase session');
  await ensureSupabaseProfile(user.id, sourceUser);
  return saveActiveIntent(intent, location);
}
