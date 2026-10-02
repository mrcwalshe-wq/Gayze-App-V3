import type { SwarmRoom } from '../types';
import type { MyConversations } from './supabaseService';

/**
 * Map backend conversation rows onto the app's room model.
 *
 * Nothing here is invented: names come from `profiles`, membership comes from
 * `conversation_members`, and a room is only labelled "group" when the backend
 * actually reports more than two members.
 */
export function buildRoomsFromSupabase(
  result: MyConversations,
  currentUserId: string,
): SwarmRoom[] {
  const nameByUser = new Map(
    result.profiles.map((profile) => [profile.userId, profile.displayName || 'Gayze member']),
  );
  const avatarByUser = new Map(
    result.profiles.map((profile) => [profile.userId, profile.avatarPath]),
  );

  const lastSeenByUser = new Map(result.profiles.map((profile) => {
    const time = profile.lastSeenAt ? Date.parse(profile.lastSeenAt) : NaN;
    return [profile.userId, Number.isFinite(time) ? time : undefined];
  }));

  return result.summaries.map((summary) => {
    const memberIds = result.members
      .filter((member) => member.conversationId === summary.id)
      .map((member) => member.userId);

    const memberNames: Record<string, string> = {};
    for (const id of memberIds) {
      memberNames[id] = id === currentUserId ? 'You' : (nameByUser.get(id) || 'Gayze member');
    }

    const others = memberIds.filter((id) => id !== currentUserId);
    const parsedTimestamp = summary.createdAt ? Date.parse(summary.createdAt) : NaN;
    const lastTimestamp = Number.isFinite(parsedTimestamp) ? parsedTimestamp : Date.now();

    // One other member = direct message. Anything else is a real group.
    if (memberIds.length <= 2 && others.length === 1) {
      const peerName = memberNames[others[0]];
      return {
        id: summary.id,
        name: peerName,
        type: 'direct' as const,
        peerUserId: others[0],
        peerName,
        peerLastSeenAt: lastSeenByUser.get(others[0]) || undefined,
        peerAvatar: avatarByUser.get(others[0]) || 'user',
        safetyNumber: '',
        swarmSecretKeyHex: '',
        lastMessage: '',
        lastTimestamp,
        ephemeralTtlSeconds: 0,
        memberIds,
        memberNames,
      };
    }

    return {
      id: summary.id,
      name: `Group · ${memberIds.length}`,
      type: 'gathering' as const,
      safetyNumber: '',
      swarmSecretKeyHex: '',
      lastMessage: '',
      lastTimestamp,
      ephemeralTtlSeconds: 0,
      memberIds,
      memberNames,
    };
  });
}

/**
 * Merge backend conversations with rooms already opened in this session.
 * Local-only metadata (last message preview, safety fingerprint, verification
 * state, auto-delete choice) is preserved; backend membership always wins.
 */
export function mergeBackendRooms(
  existing: SwarmRoom[],
  loaded: SwarmRoom[],
  currentUserId: string,
): SwarmRoom[] {
  const byId = new Map(existing.map((room) => [room.id, room]));
  for (const room of loaded) {
    const local = byId.get(room.id);
    if (!local) {
      byId.set(room.id, room);
      continue;
    }
    const candidate: SwarmRoom = {
      ...local,
      name: room.name,
      type: room.type,
      peerUserId: room.peerUserId ?? local.peerUserId,
      peerName: room.peerName ?? local.peerName,
      // An updated/removed server avatar must not leave the previous photo.
      peerAvatar: room.peerAvatar,
      // A newly hidden/absent server value must clear stale presence metadata.
      peerLastSeenAt: room.peerLastSeenAt,
      memberIds: room.memberIds?.length ? room.memberIds : local.memberIds,
      memberNames: room.memberNames && Object.keys(room.memberNames).length
        ? room.memberNames
        : local.memberNames,
    };
    // Polling identical metadata must not invalidate every row/avatar effect.
    const unchanged = Object.keys(candidate).every((key) =>
      JSON.stringify(candidate[key as keyof SwarmRoom]) === JSON.stringify(local[key as keyof SwarmRoom]));
    byId.set(room.id, unchanged ? local : candidate);
  }

  const result = Array.from(byId.values())
    .filter((room) => Boolean(room.id))
    // A backend room must include the authenticated user; anything else is a
    // stale placeholder and is dropped rather than shown.
    .filter((room) => !room.memberIds?.length || room.memberIds.includes(currentUserId))
    .sort((a, b) => b.lastTimestamp - a.lastTimestamp);
  return result.length === existing.length && result.every((room, index) => room === existing[index]) ? existing : result;
}
