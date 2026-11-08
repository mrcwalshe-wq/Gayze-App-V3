import type { Pulse } from '../types';
import type { RightNowDiscoveryRow } from './supabaseService';
import { activitySummary, cleanActivities, cleanConnections, legacyActivityFor } from './intentModel';
import { intentDisplayLabel } from './intentLabels';

export const DISCOVERY_JITTER_METERS = 300;

/** The activities of a discovery row; older databases or rows without them fall back to the old intent word. */
const rowActivities = (row: RightNowDiscoveryRow): string[] => {
  const have = cleanActivities(row.activities ?? []);
  return have.length ? have : legacyActivityFor(row.intent);
};
const categoryForActivity = (id?: string): Pulse['activityCategory'] =>
  id === 'coffee' ? 'coffee' : id === 'drinks' ? 'drinks' : id === 'walks' ? 'walk' : id === 'fitness' ? 'active' : id === 'culture' || id === 'music' ? 'culture' : 'chill';

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
      title: activitySummary(rowActivities(row)) || intentDisplayLabel(row.intent),
      description: row.description || `Up for ${(activitySummary(rowActivities(row)) || intentDisplayLabel(row.intent)).toLowerCase()} nearby.`,
      activities: rowActivities(row),
      connections: cleanConnections(row.connections ?? []),
      activityCategory: categoryForActivity(rowActivities(row)[0]),
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
