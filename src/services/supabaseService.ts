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

export async function saveActiveIntent(intent: UserActiveIntent, location?: { lat: number; lng: number }) {
  if (!supabase) return null;
  try {
    const { data: userData, error: userError } = await supabase.auth.getUser();
    if (userError || !userData?.user) return null;
    const point = location ? 'SRID=4326;POINT(' + location.lng + ' ' + location.lat + ')' : null;
    const { data, error } = await supabase.from('intents').insert({
      user_id: userData.user.id, mode: intent.mode, intent: intent.intent, description: intent.description,
      starts_at: new Date(intent.activatedAt).toISOString(), expires_at: new Date(intent.expiresAt).toISOString(),
      duration_label: intent.duration, travel_distance_label: intent.travelDistance, travel_willingness: intent.travelWillingness,
      can_host: intent.canHost, context: intent.context, area: intent.area, is_near_safe_haven: Boolean(intent.isNearSafeHaven),
      safe_haven_id: null, location: point, is_paused: Boolean(intent.isPaused),
    }).select('id,expires_at').single();
    if (error) {
      console.warn('[GAYZE] Supabase saveActiveIntent error:', error.message);
      return null;
    }
    return data;
  } catch (err: any) {
    console.warn('[GAYZE] Supabase saveActiveIntent exception:', err?.message || err);
    return null;
  }
}

export async function submitInterest(toUserId: string, intentId?: string) {
  if (!supabase) return { mutual: false, conversation_id: null };
  try {
    const { data, error } = await supabase.rpc('submit_interest', { p_to_user: toUserId, p_intent_id: intentId ?? null });
    if (error) {
      console.warn('[GAYZE] Supabase submit_interest unavailable:', error.message);
      return { mutual: false, conversation_id: null };
    }
    return data as { mutual: boolean; conversation_id: string | null };
  } catch (err: any) {
    console.warn('[GAYZE] Supabase submit_interest exception:', err?.message || err);
    return { mutual: false, conversation_id: null };
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
      from_user: userData.user.id,
      to_user: toUserId,
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
    const { data: sessionData, error: sessionError } = await supabase.auth.getSession();
    if (sessionError) {
      console.warn('[GAYZE] Supabase getSession info:', sessionError.message);
    }
    if (sessionData?.session?.user) return sessionData.session.user;

    const { data, error } = await supabase.auth.signInAnonymously();
    if (error) {
      // Anonymous sign-ins are disabled on this Supabase project or provider is turned off.
      // Gracefully return null so the app continues seamlessly with peer-to-peer / local mode.
      console.warn('[GAYZE] Supabase anonymous sign-in unavailable (disabled on project):', error.message);
      return null;
    }
    return data.user;
  } catch (err: any) {
    console.warn('[GAYZE] Supabase session check error:', err?.message || err);
    return null;
  }
}

export async function ensureSupabaseProfile(userId: string, sourceUser = INITIAL_USER, identityPublicKey?: string) {
  if (!supabase) return null;
  try {
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
  identityPublicKey?: string,
) {
  const user = await ensureSupabaseSession();
  if (!user) {
    return null;
  }
  // Preserve the existing device identity when this helper is used after bootstrap.
  // Passing undefined keeps the existing identity_public_key untouched via a direct
  // update of only the intent; profile synchronisation is only needed when explicitly
  // supplied by the caller.
  if (identityPublicKey) {
    await ensureSupabaseProfile(user.id, sourceUser, identityPublicKey);
  }
  return saveActiveIntent(intent, location);
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
