import { supabase } from './supabaseClient';
import type { UserActiveIntent, Pulse, SafeHaven, UserProfile } from '../types';

export interface RightNowDiscoveryRow {
  intent_id: string; user_id: string; display_name: string; age: number | null; bio: string | null;
  avatar_path: string | null; neighborhood: string | null; mode: 'social' | 'private'; intent: string;
  description: string | null; expires_at: string; distance_m: number; map_lat: number; map_lng: number;
  reliability_score: number; verified_peers_count: number; safety_verified: boolean;
  travel_distance_label: string | null; can_host: string | null; travel_willingness: string | null;
}

export async function loadSafeHavens(): Promise<SafeHaven[]> {
  if (!supabase) return [];
  const { data, error } = await supabase
    .from('safe_havens')
    .select('id,name,type,address,neighborhood,safety_score,features,location,open_hours,emergency_phone,staff_trained')
    .order('name');
  if (error) {
    console.warn('[GAYZE] Safe haven load failed:', error.message);
    return [];
  }
  return (data ?? []).map((row) => {
    const locationText = typeof row.location === 'string' ? row.location : '';
    const match = locationText.match(/POINT\s*\(\s*([-0-9.]+)\s+([-0-9.]+)\s*\)/i);
    const lng = match ? Number(match[1]) : 0;
    const lat = match ? Number(match[2]) : 0;
    return {
    id: row.id,
    name: row.name,
    type: row.type,
    address: row.address || '',
    neighborhood: row.neighborhood || '',
    safetyScore: Number(row.safety_score) || 0,
    features: Array.isArray(row.features) ? row.features : [],
    lat,
    lng,
    openHours: row.open_hours || '',
    approxDistanceKm: 0,
    emergencyPhone: row.emergency_phone || '',
    staffTrained: Boolean(row.staff_trained),
    };
  });
}

export interface SupabaseGatheringRow {
  id: string;
  host_id: string;
  title: string;
  description: string;
  category: 'social' | 'arts' | 'active' | 'games' | 'discussions' | 'nightlife';
  scheduled_at: string;
  location_name: string;
  address: string;
  neighborhood: string;
  is_safe_haven_venue: boolean;
  lat: number | null;
  lng: number | null;
  capacity: number;
  tags: unknown;
  safety_guidelines: string;
}

export async function loadGatherings(): Promise<import('../types').Gathering[]> {
  if (!supabase) return [];
  const user = await ensureSupabaseSession();
  if (!user) return [];
  const { data, error } = await supabase
    .from('gatherings')
    .select('id,host_id,title,description,category,scheduled_at,location_name,address,neighborhood,is_safe_haven_venue,lat,lng,capacity,tags,safety_guidelines')
    .gte('scheduled_at', new Date().toISOString())
    .order('scheduled_at', { ascending: true });
  if (error) {
    console.warn('[GAYZE] Gathering load failed:', error.message);
    return [];
  }
  const ids = (data ?? []).map((row) => row.id);
  let attending = new Set<string>();
  let counts = new Map<string, number>();
  if (ids.length) {
    const { data: rsvps } = await supabase
      .from('gathering_rsvps')
      .select('gathering_id,user_id,status')
      .in('gathering_id', ids)
      .eq('status', 'attending');
    attending = new Set((rsvps ?? []).filter((row) => row.user_id === user.id).map((row) => row.gathering_id));
    counts = new Map<string, number>();
    for (const row of rsvps ?? []) counts.set(row.gathering_id, (counts.get(row.gathering_id) ?? 0) + 1);
  }
  return (data ?? []).map((row: SupabaseGatheringRow) => ({
    id: row.id,
    hostId: row.host_id,
    hostName: row.host_id === user.id ? 'You' : 'Gayze member',
    hostShortKey: row.host_id.slice(0, 8) + '...',
    hostAvatar: 'user',
    title: row.title,
    description: row.description,
    category: row.category,
    dateStr: new Date(row.scheduled_at).toLocaleString([], { weekday: 'long', hour: '2-digit', minute: '2-digit' }),
    timestamp: new Date(row.scheduled_at).getTime(),
    locationName: row.location_name,
    address: row.address,
    neighborhood: row.neighborhood,
    isSafeHavenVenue: row.is_safe_haven_venue,
    lat: row.lat ?? null,
    lng: row.lng ?? null,
    capacity: row.capacity,
    rsvpCount: counts.get(row.id) ?? 0,
    isAttending: attending.has(row.id),
    tags: Array.isArray(row.tags) ? row.tags as string[] : [],
    safetyGuidelines: row.safety_guidelines,
  }));
}

export async function createGathering(input: Omit<import('../types').Gathering, 'id' | 'rsvpCount' | 'isAttending'>) {
  if (!supabase) return null;
  const user = await ensureSupabaseSession();
  if (!user) return null;
  const { data, error } = await supabase.from('gatherings').insert({
    host_id: user.id,
    title: input.title,
    description: input.description,
    category: input.category,
    scheduled_at: new Date(input.timestamp).toISOString(),
    location_name: input.locationName,
    address: input.address,
    neighborhood: input.neighborhood,
    is_safe_haven_venue: input.isSafeHavenVenue,
    lat: input.lat,
    lng: input.lng,
    capacity: input.capacity,
    tags: input.tags,
    safety_guidelines: input.safetyGuidelines,
  }).select('id').single();
  if (error) {
    console.warn('[GAYZE] Gathering create failed:', error.message);
    return null;
  }
  return data?.id ?? null;
}

export async function toggleGatheringRsvp(gatheringId: string): Promise<boolean> {
  if (!supabase) return false;
  const { data, error } = await supabase.rpc('toggle_gathering_rsvp', { p_gathering_id: gatheringId });
  if (error) {
    console.warn('[GAYZE] Gathering RSVP failed:', error.message);
    return false;
  }
  return Boolean(data);
}

export interface SafetyCheckinRecord {
  id: string;
  partnerName: string;
  venueName: string;
  startedAt: number;
  expiresAt: number;
  endedAt: number | null;
  notes: string;
  status: 'active' | 'ended' | 'expired';
}

export async function loadActiveSafetyCheckin(): Promise<SafetyCheckinRecord | null> {
  if (!supabase) return null;
  const user = await ensureSupabaseSession();
  if (!user) return null;
  const { data, error } = await supabase.from('safety_checkins')
    .select('id,partner_name,venue_name,started_at,expires_at,ended_at,notes,status')
    .eq('user_id', user.id)
    .eq('status', 'active')
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error || !data) return null;
  return {
    id: data.id,
    partnerName: data.partner_name,
    venueName: data.venue_name,
    startedAt: new Date(data.started_at).getTime(),
    expiresAt: new Date(data.expires_at).getTime(),
    endedAt: data.ended_at ? new Date(data.ended_at).getTime() : null,
    notes: data.notes || '',
    status: data.status,
  };
}

export async function startSafetyCheckin(input: { partnerName: string; venueName: string; durationMinutes: number; notes: string }) {
  if (!supabase) return null;
  const user = await ensureSupabaseSession();
  if (!user) return null;
  await supabase.from('safety_checkins').update({ status: 'ended', ended_at: new Date().toISOString() })
    .eq('user_id', user.id).eq('status', 'active');
  const expiresAt = new Date(Date.now() + input.durationMinutes * 60 * 1000).toISOString();
  const { data, error } = await supabase.from('safety_checkins').insert({
    user_id: user.id,
    partner_name: input.partnerName,
    venue_name: input.venueName,
    started_at: new Date().toISOString(),
    expires_at: expiresAt,
    notes: input.notes,
    status: 'active',
  }).select('id').single();
  if (error) {
    console.warn('[GAYZE] Safety check-in start failed:', error.message);
    return null;
  }
  return { id: data.id, expiresAt: new Date(expiresAt).getTime() };
}

export async function updateSafetyCheckin(id: string, patch: { expiresAt?: number; status?: 'active' | 'ended' | 'expired' }) {
  if (!supabase) return false;
  const values: Record<string, string> = {};
  if (patch.expiresAt !== undefined) values.expires_at = new Date(patch.expiresAt).toISOString();
  if (patch.status) {
    values.status = patch.status;
    if (patch.status !== 'active') values.ended_at = new Date().toISOString();
  }
  const { error } = await supabase.from('safety_checkins').update(values).eq('id', id);
  return !error;
}

export async function discoverRightNow(options?: { radiusMeters?: number; mode?: 'social' | 'private'; intent?: string }): Promise<RightNowDiscoveryRow[]> {
  if (!supabase) return [];
  try {
    const { data, error } = await supabase.rpc('discover_right_now', {
      p_radius_m: options?.radiusMeters ?? 5000, p_mode: options?.mode ?? null, p_intent: options?.intent ?? null,
    });
    if (error) {
      console.warn('[GAYZE] Supabase discover_right_now unavailable:', error.message);
      return [];
    }
    return (data ?? []) as RightNowDiscoveryRow[];
  } catch (err: any) {
    console.warn('[GAYZE] Supabase discover_right_now exception:', err?.message || err);
    return [];
  }
}

export async function updateProfileLocation(location: { lat: number; lng: number }) {
  if (!supabase) return false;
  const user = await ensureSupabaseSession();
  if (!user) return false;
  const point = 'SRID=4326;POINT(' + location.lng + ' ' + location.lat + ')';
  const { error } = await supabase.from('profiles').update({ location: point }).eq('id', user.id);
  if (error) {
    console.warn('[GAYZE] Supabase profile location update failed:', error.message);
    return false;
  }
  return true;
}

export async function clearProfileLocation() {
  if (!supabase) return false;
  const { data, error: authError } = await supabase.auth.getUser();
  if (authError || !data.user) return false;
  const { error } = await supabase.from('profiles').update({ location: null }).eq('id', data.user.id);
  if (error) {
    console.warn('[GAYZE] Supabase profile location cleanup failed:', error.message);
    return false;
  }
  return true;
}

/**
 * Intent rows are the live source of truth for the Right Now broadcast.
 * `intents.created_at` is not assumed to exist — ordering uses `starts_at`,
 * which GAYZE writes on every insert.
 */
export interface SupabaseIntentRecord {
  id: string;
  expiresAt: number;
  isPaused: boolean;
}

/** Published privacy radius for other users' intents (client-side display only). */
export const DISCOVERY_JITTER_METERS = 300;

type IntentRow = {
  id: string;
  mode: string | null;
  intent: string | null;
  description: string | null;
  starts_at: string | null;
  expires_at: string | null;
  duration_label: string | null;
  travel_distance_label: string | null;
  travel_willingness: string | null;
  can_host: string | null;
  context: string | null;
  area: string | null;
  is_near_safe_haven: boolean | null;
  is_paused: boolean | null;
};

const INTENT_COLUMNS = 'id,mode,intent,description,starts_at,expires_at,duration_label,travel_distance_label,travel_willingness,can_host,context,area,is_near_safe_haven,is_paused';

const CAN_HOST_VALUES = ['Can host', 'Cannot host', 'Depends'] as const;
const TRAVEL_VALUES = ['Yes', 'Within reason', 'Car required'] as const;
const CONTEXT_VALUES = ['Private', 'Public', 'Either'] as const;

/**
 * `intents.when_label` does not exist in the schema, so the composer's timing
 * choice is derived from the activation time on reload. See
 * docs/BACKEND_REQUIREMENTS.md.
 */
function deriveIntentWhen(activatedAt: number): string {
  const minutesAgo = (Date.now() - activatedAt) / 60000;
  if (minutesAgo < 60) return 'Now';
  if (minutesAgo < 180) return 'Next 1 hour';
  if (minutesAgo < 360) return 'Next 2 hours';
  return 'Tonight';
}

export function intentRowToActiveIntent(row: IntentRow): UserActiveIntent {
  const activatedAt = row.starts_at ? new Date(row.starts_at).getTime() : Date.now();
  const expiresAt = row.expires_at ? new Date(row.expires_at).getTime() : activatedAt;
  return {
    remoteId: row.id,
    mode: row.mode === 'private' ? 'private' : 'social',
    intent: (row.intent || 'Meet') as UserActiveIntent['intent'],
    description: row.description || '',
    when: deriveIntentWhen(activatedAt),
    duration: row.duration_label || '2 hrs',
    travelDistance: row.travel_distance_label || 'Within 2 km',
    canHost: CAN_HOST_VALUES.find((value) => value === row.can_host),
    travelWillingness: TRAVEL_VALUES.find((value) => value === row.travel_willingness),
    context: CONTEXT_VALUES.find((value) => value === row.context),
    area: row.area || 'Near you',
    isNearSafeHaven: Boolean(row.is_near_safe_haven),
    activatedAt,
    expiresAt,
    isPaused: Boolean(row.is_paused),
  };
}

/**
 * The single live intent for the authenticated user, straight from Supabase.
 * Expired and paused rows are never returned, so a reload can never resurrect
 * a stale broadcast.
 */
export async function loadActiveIntent(): Promise<UserActiveIntent | null> {
  if (!supabase) return null;
  const user = await ensureSupabaseSession();
  if (!user) return null;
  const { data, error } = await supabase
    .from('intents')
    .select(INTENT_COLUMNS)
    .eq('user_id', user.id)
    .eq('is_paused', false)
    .gt('expires_at', new Date().toISOString())
    .order('starts_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) {
    console.warn('[GAYZE] Supabase loadActiveIntent unavailable:', error.message);
    return null;
  }
  if (!data) return null;
  const intent = intentRowToActiveIntent(data as IntentRow);
  return intent.expiresAt > Date.now() ? intent : null;
}

/** Retire every other live broadcast so one account can never hold two. */
async function retireOtherActiveIntents(userId: string, keepIntentId?: string | null) {
  if (!supabase) return;
  let query = supabase
    .from('intents')
    .update({ is_paused: true })
    .eq('user_id', userId)
    .eq('is_paused', false)
    .gt('expires_at', new Date().toISOString());
  if (keepIntentId) query = query.neq('id', keepIntentId);
  const { error } = await query;
  if (error) console.warn('[GAYZE] Supabase retire intents failed:', error.message);
}

export async function saveActiveIntent(
  intent: UserActiveIntent,
  location?: { lat: number; lng: number },
): Promise<SupabaseIntentRecord | null> {
  if (!supabase) return null;
  try {
    const { data: userData, error: userError } = await supabase.auth.getUser();
    if (userError || !userData?.user) return null;
    const point = location ? 'SRID=4326;POINT(' + location.lng + ' ' + location.lat + ')' : null;
    const values = {
      user_id: userData.user.id,
      mode: intent.mode,
      intent: intent.intent,
      description: intent.description,
      starts_at: new Date(intent.activatedAt).toISOString(),
      expires_at: new Date(intent.expiresAt).toISOString(),
      duration_label: intent.duration,
      travel_distance_label: intent.travelDistance,
      travel_willingness: intent.travelWillingness ?? null,
      can_host: intent.canHost ?? null,
      context: intent.context ?? null,
      area: intent.area,
      is_near_safe_haven: Boolean(intent.isNearSafeHaven),
      safe_haven_id: null,
      location: point,
      is_paused: Boolean(intent.isPaused),
    };

    // Editing an existing broadcast updates the same row: never insert a second
    // live intent for the same account.
    if (intent.remoteId) {
      const { data, error } = await supabase
        .from('intents')
        .update(values)
        .eq('id', intent.remoteId)
        .select('id,expires_at,is_paused')
        .maybeSingle();
      if (!error && data) {
        await retireOtherActiveIntents(userData.user.id, intent.remoteId);
        return {
          id: data.id,
          expiresAt: new Date(data.expires_at).getTime(),
          isPaused: Boolean(data.is_paused),
        };
      }
      console.warn('[GAYZE] Intent update failed, inserting a fresh broadcast:', error?.message);
    }

    await retireOtherActiveIntents(userData.user.id, null);
    const { data, error } = await supabase
      .from('intents')
      .insert(values)
      .select('id,expires_at,is_paused')
      .single();
    if (error) {
      console.warn('[GAYZE] Supabase saveActiveIntent error:', error.message);
      return null;
    }
    return {
      id: data.id,
      expiresAt: new Date(data.expires_at).getTime(),
      isPaused: Boolean(data.is_paused),
    };
  } catch (err: any) {
    console.warn('[GAYZE] Supabase saveActiveIntent exception:', err?.message || err);
    return null;
  }
}

/** Pause or resume the live broadcast. Returns false when the write failed. */
export async function updateActiveIntentPause(intentId: string, isPaused: boolean): Promise<boolean> {
  if (!supabase) return false;
  const { error } = await supabase.from('intents').update({ is_paused: isPaused }).eq('id', intentId);
  if (error) {
    console.warn('[GAYZE] Supabase intent pause update failed:', error.message);
    return false;
  }
  return true;
}

/**
 * End the live broadcast. `expires_at` is pushed to now so the intent stops
 * being discoverable even if a discovery function only filters on expiry.
 */
export async function endActiveIntent(intentId?: string | null): Promise<boolean> {
  if (!supabase) return false;
  const user = await ensureSupabaseSession();
  if (!user) return false;
  const nowIso = new Date().toISOString();

  const runUpdate = async (includeExpiry: boolean) => {
    const values: Record<string, unknown> = { is_paused: true };
    if (includeExpiry) values.expires_at = nowIso;
    const base = supabase!.from('intents').update(values);
    const scoped = intentId ? base.eq('id', intentId) : base.eq('user_id', user.id).eq('is_paused', false);
    return scoped;
  };

  const { error } = await runUpdate(true);
  if (error) {
    console.warn('[GAYZE] Ending intent with expiry failed, retrying without expiry:', error.message);
    const retry = await runUpdate(false);
    if (retry.error) {
      console.warn('[GAYZE] Failed to end active intent:', retry.error.message);
      return false;
    }
  }
  return true;
}

export interface SubmitInterestResult {
  sent: boolean;
  mutual: boolean;
  conversation_id: string | null;
}

export async function verifyPeerIdentity(
  peerPublicKey: string,
  peerFingerprint: string,
  deviceId?: string | null,
): Promise<boolean> {
  if (!supabase) return false;
  try {
    const { data, error } = await supabase.rpc('verify_peer_identity', {
      p_peer_public_key: peerPublicKey,
      p_peer_fingerprint: peerFingerprint,
      p_device_id: deviceId ?? null,
    });
    if (error) {
      console.warn('[GAYZE] Peer identity verification failed:', error.message);
      return false;
    }
    return data === true;
  } catch (err: any) {
    console.warn('[GAYZE] Peer identity verification exception:', err?.message || err);
    return false;
  }
}

export async function submitInterest(toUserId: string, intentId?: string): Promise<SubmitInterestResult> {
  if (!supabase) return { sent: false, mutual: false, conversation_id: null };
  try {
    const { data, error } = await supabase.rpc('submit_interest', { p_to_user: toUserId, p_intent_id: intentId ?? null });
    if (error) {
      console.warn('[GAYZE] Supabase submit_interest unavailable:', error.message);
      return { sent: false, mutual: false, conversation_id: null };
    }
    const result = data as { mutual?: boolean; conversation_id?: string | null };
    return {
      sent: true,
      mutual: Boolean(result.mutual),
      conversation_id: result.conversation_id ?? null,
    };
  } catch (err: any) {
    console.warn('[GAYZE] Supabase submit_interest exception:', err?.message || err);
    return { sent: false, mutual: false, conversation_id: null };
  }
}

export interface SupabaseMessageRow {
  id: string;
  conversation_id: string;
  sender_id: string;
  ciphertext: string;
  nonce: string | null;
  created_at: string;
  expires_at: string | null;
  burned_at: string | null;
}

export async function loadConversationMessages(conversationId: string): Promise<SupabaseMessageRow[]> {
  if (!supabase) return [];
  const { data, error } = await supabase
    .from('messages')
    .select('id,conversation_id,sender_id,ciphertext,nonce,created_at,expires_at,burned_at')
    .eq('conversation_id', conversationId)
    .order('created_at', { ascending: true });
  if (error) throw error;
  return (data ?? []) as SupabaseMessageRow[];
}

export async function persistConversationMessage(
  conversationId: string,
  ciphertext: string,
  nonce: string,
  expiresAt?: string | null,
) {
  if (!supabase) throw new Error('Supabase is not configured');
  const user = await ensureSupabaseSession();
  if (!user) throw new Error('Authentication required');

  const { data, error } = await supabase
    .from('messages')
    .insert({
      conversation_id: conversationId,
      sender_id: user.id,
      ciphertext,
      nonce,
      expires_at: expiresAt ?? null,
    })
    .select('id,conversation_id,sender_id,ciphertext,nonce,created_at,expires_at,burned_at')
    .single();

  if (error) throw error;
  return data as SupabaseMessageRow;
}

export function subscribeToConversationMessages(
  conversationId: string,
  onMessage: (row: SupabaseMessageRow) => void,
) {
  if (!supabase) return () => undefined;

  const channel = supabase
    .channel(`gayze-conversation-${conversationId}`)
    .on(
      'postgres_changes',
      {
        event: 'INSERT',
        schema: 'public',
        table: 'messages',
        filter: `conversation_id=eq.${conversationId}`,
      },
      (payload) => onMessage(payload.new as SupabaseMessageRow),
    )
    .subscribe();

  const client = supabase;
  return () => { void client.removeChannel(channel); };
}

export async function submitGaze(toUserId: string, intentId?: string) {
  if (!supabase) return { sent: false };
  try {
    const { data: userData, error: userError } = await supabase.auth.getUser();
    if (userError || !userData?.user) return { sent: false };

    const { error } = await supabase.from('gazes').insert({
      from_user_id: userData.user.id,
      to_user_id: toUserId,
      intent_id: intentId ?? null,
    });

    // A repeated Gaze is intentionally idempotent at the UX layer.
    if (error && error.code !== '23505') {
      console.warn('[GAYZE] Supabase submitGaze unavailable:', error.message);
      return { sent: false };
    }
    return { sent: true };
  } catch (err: any) {
    console.warn('[GAYZE] Supabase submitGaze exception:', err?.message || err);
    return { sent: false };
  }
}

export function subscribeToRightNow(onChange: () => void) {
  if (!supabase) return () => undefined;
  try {
    const channel = supabase.channel('gayze-right-now')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'intents' }, onChange)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'interests' }, onChange)
      .subscribe();
    const client = supabase;
    return () => { void client.removeChannel(channel); };
  } catch {
    return () => undefined;
  }
}


export async function ensureSupabaseSession() {
  if (!supabase) return null;
  try {
    const { data, error } = await supabase.auth.getSession();
    if (error) {
      console.warn('[GAYZE] Supabase getSession info:', error.message);
      return null;
    }
    return data.session?.user ?? null;
  } catch (err: any) {
    console.warn('[GAYZE] Supabase session check error:', err?.message || err);
    return null;
  }
}

export async function loadSupabaseProfile(userId: string): Promise<Partial<UserProfile> | null> {
  if (!supabase) return null;
  const { data, error } = await supabase
    .from('profiles')
    .select('display_name,handle,bio,privacy_setting,reliability_score,verified_peers_count,safety_verified,neighborhood,identity_public_key')
    .eq('id', userId)
    .maybeSingle();
  if (error) {
    console.warn('[GAYZE] Supabase profile load failed:', error.message);
    return null;
  }
  if (!data) return null;
  return {
    displayName: data.display_name || undefined,
    handle: data.handle || undefined,
    bio: data.bio || '',
    privacySetting: data.privacy_setting || undefined,
    // Trust signals are shown exactly as stored. A profile with no history reads
    // as 0, never as a fabricated score.
    reliabilityScore: Number(data.reliability_score) || 0,
    verifiedPeersCount: Number(data.verified_peers_count) || 0,
    safetyVerified: Boolean(data.safety_verified),
    neighborhood: data.neighborhood || 'Near you',
    publicKey: data.identity_public_key || undefined,
  };
}

export async function ensureSupabaseProfile(userId: string, sourceUser: UserProfile, identityPublicKey?: string) {
  if (!supabase) return null;
  try {
    const baseHandle = (sourceUser.handle || 'gayze-user')
      .toLowerCase()
      .replace(/[^a-z0-9._-]/g, '')
      .slice(0, 32) || 'gayze-user';
    const uniqueHandle = baseHandle + '-' + userId.slice(0, 8);

    const { data, error } = await supabase.from('profiles').upsert({
      id: userId,
      handle: uniqueHandle,
      display_name: sourceUser.displayName || 'Gayze User',
      bio: sourceUser.bio || null,
      privacy_setting: sourceUser.privacySetting || 'fuzzy_500m',
      // Reliability and verification counters are never written from the client:
      // they are computed by the backend. Sending 0 (or a default) here would
      // wipe a real score, so the columns are left untouched on conflict.
      neighborhood: sourceUser.neighborhood || null,
      identity_public_key: identityPublicKey ?? null,
    }, { onConflict: 'id' }).select('*').single();
    if (error) {
      console.warn('[GAYZE] Supabase profile upsert unavailable:', error.message);
      return null;
    }
    return data;
  } catch (err: any) {
    console.warn('[GAYZE] Supabase profile upsert exception:', err?.message || err);
    return null;
  }
}

export function discoveryRowsToPulses(rows: RightNowDiscoveryRow[], currentUserId?: string): Pulse[] {
  const now = Date.now();
  return rows
    .filter((row) => {
      // The authenticated user is never a "nearby person" in their own view.
      if (currentUserId && row.user_id === currentUserId) return false;
      const expTime = new Date(row.expires_at).getTime();
      if (!isNaN(expTime) && expTime <= now) return false;
      if (!Number.isFinite(row.map_lat) || !Number.isFinite(row.map_lng)) return false;
      return true;
    })
    .map((row) => ({
      id: `supabase_${row.intent_id}`,
      peerId: row.user_id,
      peerName: row.display_name || 'Gayze member',
      // A short member reference for display only. This is NOT key material and
      // must never be used to derive a safety code or a conversation key.
      peerShortKey: `${row.user_id.slice(0, 8)}…`,
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
      // Distances are whatever the discovery function measured. Never invent one.
      approxDistanceKm: typeof row.distance_m === 'number' && isFinite(row.distance_m)
        ? row.distance_m / 1000
        : 0,
      jitterMeters: DISCOVERY_JITTER_METERS,
      lat: row.map_lat,
      lng: row.map_lng,
      durationHours: Math.max(1, Math.ceil((new Date(row.expires_at).getTime() - now) / 3600000)),
      createdAt: now,
      expiresAt: new Date(row.expires_at).getTime(),
      tags: [row.intent, row.mode],
      isPaused: false,
      // A zero reliability score means "not established yet" — not 95.
      peerReliabilityScore: Number(row.reliability_score) > 0 ? Number(row.reliability_score) : undefined,
      verifiedPeersCount: row.verified_peers_count || 0,
      safetyVerified: Boolean(row.safety_verified),
      bio: row.bio || undefined,
    }));
}

/**
 * Persist the live broadcast.
 *
 * Two privacy rules are enforced here:
 *  1. the device's exact GPS point is never written — the stored point is
 *     jittered inside the user's configured privacy radius;
 *  2. nothing about the profile is written, so the device identity key that
 *     other clients need for E2EE can never be overwritten with a fingerprint.
 */
export async function saveActiveIntentWithSession(
  intent: UserActiveIntent,
  sourceUser: UserProfile,
  location?: { lat: number; lng: number },
): Promise<SupabaseIntentRecord | null> {
  const user = await ensureSupabaseSession();
  if (!user) return null;

  let publishedLocation: { lat: number; lng: number } | undefined;
  if (location && sourceUser.privacySetting !== 'ghost') {
    publishedLocation = jitterLocation(location, privacyRadiusMeters(sourceUser.privacySetting));
  }
  return saveActiveIntent(intent, publishedLocation);
}

/** Privacy radius (metres) for each location-privacy setting. */
export function privacyRadiusMeters(setting: UserProfile['privacySetting'] | undefined): number {
  if (setting === 'neighborhood') return 800;
  return 500;
}

/**
 * Privacy jitter: offsets a position by a random bearing and distance inside
 * `radiusMeters`. The offset is random per call (not derivable from the
 * published point), so an observer cannot recover the true position from the
 * stored/discovered coordinate.
 */
export function jitterLocation(
  location: { lat: number; lng: number },
  radiusMeters: number,
): { lat: number; lng: number } {
  const bearing = Math.random() * Math.PI * 2;
  const distance = Math.sqrt(Math.random()) * radiusMeters;
  return {
    lat: location.lat + (distance * Math.cos(bearing)) / 111_320,
    lng: location.lng + (distance * Math.sin(bearing)) / (111_320 * Math.cos(location.lat * Math.PI / 180)),
  };
}

export interface ConversationPeerKey {
  peer_user_id: string;
  peer_public_key: string | null;
  peer_display_name: string | null;
}

export interface ConversationSummary {
  id: string;
  createdAt: string | null;
}

export interface ConversationMemberRecord {
  conversationId: string;
  userId: string;
}

export interface ConversationMemberProfile {
  userId: string;
  displayName: string | null;
  neighborhood: string | null;
}

export interface MyConversations {
  summaries: ConversationSummary[];
  members: ConversationMemberRecord[];
  profiles: ConversationMemberProfile[];
}

/**
 * Load the authenticated user's conversations, their membership rows and the
 * member display names, so Messages survives a reload and stays Supabase-backed.
 *
 * Every step degrades on its own: if a table is not readable under the current
 * RLS policies the result is empty (an honest empty state), never fabricated.
 */
export async function loadMyConversations(): Promise<MyConversations | null> {
  if (!supabase) return null;
  const user = await ensureSupabaseSession();
  if (!user) return null;
  try {
    const { data: mine, error: mineError } = await supabase
      .from('conversation_members')
      .select('conversation_id,user_id')
      .eq('user_id', user.id)
      .limit(50);
    if (mineError) {
      console.warn('[GAYZE] Conversation list unavailable:', mineError.message);
      return null;
    }
    const conversationIds = Array.from(new Set((mine ?? []).map((row) => row.conversation_id as string)));
    if (!conversationIds.length) return { summaries: [], members: [], profiles: [] };

    const { data: summaries, error: summaryError } = await supabase
      .from('conversations')
      .select('id,created_at')
      .in('id', conversationIds);
    if (summaryError) {
      console.warn('[GAYZE] Conversation rows unavailable:', summaryError.message);
    }

    const { data: members, error: memberError } = await supabase
      .from('conversation_members')
      .select('conversation_id,user_id')
      .in('conversation_id', conversationIds);
    if (memberError) {
      console.warn('[GAYZE] Conversation members unavailable:', memberError.message);
    }
    const memberRows: ConversationMemberRecord[] = (members ?? []).map((row) => ({
      conversationId: row.conversation_id as string,
      userId: row.user_id as string,
    }));

    const memberIds = Array.from(new Set(memberRows.map((row) => row.userId)));
    let profiles: ConversationMemberProfile[] = [];
    if (memberIds.length) {
      const { data: profileRows, error: profileError } = await supabase
        .from('profiles')
        .select('id,display_name,neighborhood')
        .in('id', memberIds);
      if (profileError) {
        console.warn('[GAYZE] Conversation member profiles unavailable:', profileError.message);
      }
      profiles = (profileRows ?? []).map((row) => ({
        userId: row.id as string,
        displayName: (row.display_name as string) || null,
        neighborhood: (row.neighborhood as string) || null,
      }));
    }

    const summaryRows: ConversationSummary[] = summaryError
      ? conversationIds.map((id) => ({ id, createdAt: null }))
      : (summaries ?? []).map((row) => ({ id: row.id as string, createdAt: (row.created_at as string) || null }));

    return { summaries: summaryRows, members: memberRows, profiles };
  } catch (err: any) {
    console.warn('[GAYZE] Conversation load exception:', err?.message || err);
    return null;
  }
}


export interface ConversationPeerKey {
  peer_user_id: string;
  peer_public_key: string | null;
  peer_display_name: string | null;
}

export async function loadConversationPeerKey(conversationId: string): Promise<ConversationPeerKey | null> {
  if (!supabase) return null;
  try {
    const { data, error } = await supabase.rpc('get_conversation_peer_key', {
      p_conversation_id: conversationId,
    });
    if (error) {
      console.warn('[GAYZE] Supabase get_conversation_peer_key unavailable:', error.message);
      return null;
    }
    const row = Array.isArray(data) ? data[0] : data;
    return (row ?? null) as ConversationPeerKey | null;
  } catch (err: any) {
    console.warn('[GAYZE] Supabase get_conversation_peer_key exception:', err?.message || err);
    return null;
  }
}



export interface ConversationKeyEnvelope {
  conversation_id: string;
  user_id: string;
  device_id: string;
  wrapped_key: string;
  nonce: string;
  created_by_device_id: string | null;
  created_at: string;
}

export async function listConversationKeyEnvelopes(conversationId: string): Promise<ConversationKeyEnvelope[]> {
  if (!supabase) return [];
  try {
    const { data, error } = await supabase
      .from('conversation_key_envelopes')
      .select('conversation_id,user_id,device_id,wrapped_key,nonce,created_by_device_id,created_at')
      .eq('conversation_id', conversationId);
    if (error) {
      console.warn('[GAYZE] Supabase listConversationKeyEnvelopes unavailable:', error.message);
      return [];
    }
    return (data ?? []) as ConversationKeyEnvelope[];
  } catch (err: any) {
    console.warn('[GAYZE] Supabase listConversationKeyEnvelopes exception:', err?.message || err);
    return [];
  }
}

export async function saveConversationKeyEnvelope(
  envelope: Omit<ConversationKeyEnvelope, 'created_at'>,
): Promise<ConversationKeyEnvelope | null> {
  if (!supabase) return null;
  try {
    const { data, error } = await supabase
      .from('conversation_key_envelopes')
      .upsert({
        conversation_id: envelope.conversation_id,
        user_id: envelope.user_id,
        device_id: envelope.device_id,
        wrapped_key: envelope.wrapped_key,
        nonce: envelope.nonce,
        created_by_device_id: envelope.created_by_device_id,
      }, { onConflict: 'conversation_id,device_id' })
      .select('conversation_id,user_id,device_id,wrapped_key,nonce,created_by_device_id,created_at')
      .single();
    if (error) {
      console.warn('[GAYZE] Supabase saveConversationKeyEnvelope unavailable:', error.message);
      return null;
    }
    return data as ConversationKeyEnvelope;
  } catch (err: any) {
    console.warn('[GAYZE] Supabase saveConversationKeyEnvelope exception:', err?.message || err);
    return null;
  }
}

export async function loadConversationPeerDevices(conversationId: string) {
  if (!supabase) return [];
  try {
    const { data, error } = await supabase.rpc('get_conversation_peer_devices', {
      p_conversation_id: conversationId,
    });
    if (error) {
      console.warn('[GAYZE] Supabase get_conversation_peer_devices unavailable:', error.message);
      return [];
    }
    return (data ?? []) as Array<{
      user_id: string;
      device_id: string;
      public_key: string;
      device_label: string | null;
      last_seen_at: string;
    }>;
  } catch (err: any) {
    console.warn('[GAYZE] Supabase get_conversation_peer_devices exception:', err?.message || err);
    return [];
  }
}

export interface IdentityDevice {
  id: string;
  user_id: string;
  device_id: string;
  device_fingerprint: string;
  device_label: string | null;
  public_key: string;
  status: 'active' | 'revoked';
  created_at: string;
  last_seen_at: string;
  revoked_at: string | null;
}

export async function registerIdentityDevice(
  fingerprint: string,
  publicKey: string,
  deviceLabel?: string,
  signingPublicKey?: string,
  deviceId?: string,
): Promise<IdentityDevice | null> {
  if (!supabase) return null;
  try {
    const { data, error } = await supabase.rpc('register_identity_device', {
      p_fingerprint: fingerprint,
      p_public_key: publicKey,
      p_device_label: deviceLabel ?? null,
      p_signing_public_key: signingPublicKey ?? null,
      p_device_id: deviceId ?? null,
    });
    if (error) {
      console.warn('[GAYZE] Supabase register_identity_device unavailable:', error.message);
      return null;
    }
    return data as IdentityDevice;
  } catch (err: any) {
    console.warn('[GAYZE] Supabase register_identity_device exception:', err?.message || err);
    return null;
  }
}

export async function listIdentityDevices(): Promise<IdentityDevice[]> {
  if (!supabase) return [];
  try {
    const { data, error } = await supabase
      .from('identity_devices')
      .select('id,user_id,device_id,device_fingerprint,identity_fingerprint,device_label,public_key,signing_public_key,status,created_at,last_seen_at,revoked_at')
      .order('created_at', { ascending: true });
    if (error) {
      console.warn('[GAYZE] Supabase listIdentityDevices unavailable:', error.message);
      return [];
    }
    return (data ?? []) as IdentityDevice[];
  } catch (err: any) {
    console.warn('[GAYZE] Supabase listIdentityDevices exception:', err?.message || err);
    return [];
  }
}

export async function revokeIdentityDevice(deviceId: string): Promise<boolean> {
  if (!supabase) return false;
  try {
    const { data, error } = await supabase.rpc('revoke_identity_device', {
      p_device_id: deviceId,
    });
    if (error) {
      console.warn('[GAYZE] Supabase revoke_identity_device unavailable:', error.message);
      return false;
    }
    return Boolean(data);
  } catch (err: any) {
    console.warn('[GAYZE] Supabase revoke_identity_device exception:', err?.message || err);
    return false;
  }
}


export async function verifyCurrentDevice(deviceId: string, signChallenge: (challenge: string) => Promise<string>): Promise<boolean> {
  if (!supabase) return false;
  const { data: issued, error: issueError } = await supabase.functions.invoke('verify-device-signature', {
    body: { action: 'issue', device_id: deviceId },
  });
  if (issueError || !issued?.challenge_id || !issued?.challenge) throw issueError ?? new Error('Unable to issue device challenge');
  const signature = await signChallenge(issued.challenge);
  const { data: verified, error: verifyError } = await supabase.functions.invoke('verify-device-signature', {
    body: { action: 'verify', device_id: deviceId, challenge_id: issued.challenge_id, signature },
  });
  if (verifyError || !verified?.verified) throw verifyError ?? new Error('Device signature rejected');
  return true;
}

/**
 * Realtime presence tracking for truthful online status
 */
export function initPresence(
  userId: string,
  displayName: string,
  onSync: (onlineUserIds: Set<string>) => void,
): () => void {
  if (!supabase) return () => undefined;

  const channel = supabase.channel('gayze-presence', {
    config: {
      presence: { key: userId },
    },
  });

  channel
    .on('presence', { event: 'sync' }, () => {
      const state = channel.presenceState();
      const onlineIds = new Set<string>();
      for (const key of Object.keys(state)) {
        onlineIds.add(key);
      }
      onSync(onlineIds);
    })
    .subscribe(async (status) => {
      if (status === 'SUBSCRIBED') {
        await channel.track({
          user_id: userId,
          display_name: displayName,
          online_at: new Date().toISOString(),
        });
      }
    });

  const client = supabase;
  return () => {
    if (client) void client.removeChannel(channel);
  };
}

/**
 * Securely prepare a photo attachment for encrypted chat delivery
 */
export async function preparePhotoAttachment(file: File): Promise<string> {
  // Validate file size and type
  if (!file.type.startsWith('image/')) {
    throw new Error('Only image files (JPEG, PNG, WebP) are allowed.');
  }
  const MAX_SIZE_BYTES = 5 * 1024 * 1024; // 5MB
  if (file.size > MAX_SIZE_BYTES) {
    throw new Error('Image size must be less than 5MB.');
  }

  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = () => reject(new Error('Failed to read image file'));
    reader.readAsDataURL(file);
  });
}


export async function loadStories(): Promise<import('../types').SocialStory[]> {
  if (!supabase) return [];
  const user = await ensureSupabaseSession();
  if (!user) return [];

  const { data, error } = await supabase
    .from('stories')
    .select('id,user_id,photo_url,caption,location_name,intent,category,author_display_name,author_avatar_path,created_at,expires_at')
    .gt('expires_at', new Date().toISOString())
    .neq('user_id', user.id)
    .order('created_at', { ascending: false });

  if (error) {
    console.warn('[GAYZE] Story load failed:', error.message);
    return [];
  }

  return (data ?? []).map((row) => {
    return {
      id: row.id,
      peerId: row.user_id,
      peerName: row.author_display_name || 'Gayze member',
      avatarUrl: row.author_avatar_path || '',
      photoUrl: row.photo_url || '',
      caption: row.caption || '',
      locationName: row.location_name || 'Nearby',
      timestamp: new Date(row.created_at).getTime(),
      intent: row.intent as import('../types').EncounterIntent,
      category: row.category as 'social' | 'private' | 'spicy',
    };
  });
}

export async function createStoryFromIntent(intent: UserActiveIntent, photoUrl?: string): Promise<string | null> {
  if (!supabase) return null;
  const user = await ensureSupabaseSession();
  if (!user) return null;

  const category = intent.mode === 'private' ? 'private' : 'social';
  const profile = await loadSupabaseProfile(user.id);
  const { data, error } = await supabase
    .from('stories')
    .insert({
      user_id: user.id,
      photo_url: photoUrl || null,
      author_display_name: profile?.displayName || 'Gayze member',
      author_avatar_path: null,
      caption: intent.description || ('Available for ' + intent.intent.toLowerCase() + ' nearby.'),
      location_name: intent.area || 'Nearby',
      intent: intent.intent,
      category,
      created_at: new Date().toISOString(),
      expires_at: new Date(Math.min(intent.expiresAt, Date.now() + 24 * 60 * 60 * 1000)).toISOString(),
    })
    .select('id')
    .single();

  if (error) {
    console.warn('[GAYZE] Story creation failed:', error.message);
    return null;
  }
  return data?.id ?? null;
}
