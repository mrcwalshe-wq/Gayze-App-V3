import { supabase } from './supabaseClient';
import { getProfilePhotoUrl } from './profilePhotoService';

export interface DiscoverPerson {
  userId: string; displayName: string; age: number | null; bio: string; neighborhood: string;
  interests: string[]; sharedInterests: string[]; distanceKm: number | null;
  presence: 'online' | 'away' | 'offline'; hasConversation: boolean; canContact: boolean; avatarUrl: string | null;
}
export interface DiscoverFilters { interests: string[]; query: string; radiusKm: number | null; offset?: number }
export const DISCOVER_PAGE = 30;

type Row = {
  user_id: string; display_name: string; age: number | null; bio: string | null; avatar_path: string | null; neighborhood: string | null;
  interests: string[] | null; shared_interests: string[] | null; distance_km: number | null; presence: string;
  has_conversation: boolean; can_contact: boolean;
};

/** Real people ranked by shared interests. The server decides who may appear and never sends coordinates. */
export async function discoverPeople(f: DiscoverFilters, signal?: AbortSignal): Promise<DiscoverPerson[]> {
  if (!supabase) return [];
  const { data, error } = await supabase.rpc('discover_people', {
    p_interests: f.interests.length ? f.interests : null,
    p_query: f.query.trim() || null,
    p_radius_km: f.radiusKm,
    p_limit: DISCOVER_PAGE,
    p_offset: f.offset ?? 0,
  });
  if (signal?.aborted) return [];
  if (error || !Array.isArray(data)) throw new Error('discovery unavailable');
  return Promise.all((data as Row[]).map(async (r) => ({
    userId: r.user_id, displayName: r.display_name, age: r.age, bio: r.bio ?? '', neighborhood: r.neighborhood ?? '',
    interests: r.interests ?? [], sharedInterests: r.shared_interests ?? [], distanceKm: r.distance_km,
    presence: r.presence === 'online' || r.presence === 'away' ? r.presence : 'offline',
    hasConversation: r.has_conversation, canContact: r.can_contact,
    avatarUrl: await getProfilePhotoUrl(r.avatar_path).catch(() => null),
  })));
}
