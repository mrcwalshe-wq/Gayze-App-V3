import type { SwarmRoom } from '../types';

export const isConversationId = (id: string) => /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(id);

/** Display names, public-key prefixes and historical intent IDs are not identity. */
export function findDirectRoom(rooms: SwarmRoom[], peerId: string, conversationId?: string) {
  return rooms.find((room) => room.type === 'direct' && room.peerUserId === peerId
    && (!conversationId || room.id === conversationId));
}

type Target = { kind: 'existing'; room: SwarmRoom } | { kind: 'matched'; conversationId: string }
  | { kind: 'pending' } | { kind: 'cancelled' };

/** Reuse membership-authorized rooms before requesting a new mutual match. */
export async function resolveLiveDirectChat(options: {
  peerId: string;
  rooms: SwarmRoom[];
  current(): boolean;
  loadRooms(): Promise<SwarmRoom[] | null>;
  submitInterest(): Promise<{ mutual: boolean; sent: boolean; conversation_id?: string | null }>;
}): Promise<Target> {
  const { peerId, current } = options;
  if (!current()) return { kind: 'cancelled' };
  if (!isConversationId(peerId)) throw new Error('A valid peer identity is required');
  let room = findDirectRoom(options.rooms, peerId);
  if (room && isConversationId(room.id)) return { kind: 'existing', room };
  const loaded = await options.loadRooms();
  if (!current()) return { kind: 'cancelled' };
  if (!loaded) throw new Error('Conversation list unavailable');
  room = findDirectRoom(loaded, peerId);
  if (room && isConversationId(room.id)) return { kind: 'existing', room };
  const result = await options.submitInterest();
  if (!current()) return { kind: 'cancelled' };
  if (result.mutual && result.conversation_id && isConversationId(result.conversation_id)) {
    return { kind: 'matched', conversationId: result.conversation_id };
  }
  if (result.sent && !result.mutual) return { kind: 'pending' };
  throw new Error('No authorized conversation was returned');
}
