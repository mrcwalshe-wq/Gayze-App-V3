import type { SwarmRoom } from '../types';
import {
  deriveConversationKey,
  createConversationKey,
  wrapConversationKey,
  unwrapConversationKey,
  getOrCreateDeviceIdentity,
} from './cryptoService';
import {
  listConversationKeyEnvelopes,
  loadConversationPeerDevices,
  loadConversationPeerKey,
  saveConversationKeyEnvelope,
} from './supabaseService';

export interface ConversationKeyResult {
  key: CryptoKey | null;
  status: 'ready' | 'unavailable';
  /** Human-readable, honest reason when a key could not be resolved. */
  reason?: string;
}

function parseJwk(value: string | null | undefined): JsonWebKey | null {
  if (!value) return null;
  try {
    const parsed = JSON.parse(value) as JsonWebKey;
    return parsed?.kty === 'EC' && parsed?.crv === 'P-256' ? parsed : null;
  } catch {
    return null;
  }
}

/**
 * Direct conversations derive their key from the two device identities (ECDH),
 * exactly as before — no key material is added to the database.
 */
async function resolveDirectKey(room: SwarmRoom): Promise<ConversationKeyResult> {
  const peer = room.peerKey
    ? { peer_public_key: room.peerKey }
    : await loadConversationPeerKey(room.id);
  const peerJwk = parseJwk(peer?.peer_public_key);
  if (!peerJwk) {
    return {
      key: null,
      status: 'unavailable',
      reason: 'This contact has not published a device key yet, so the chat cannot be encrypted.',
    };
  }
  try {
    return { key: await deriveConversationKey(room.id, peerJwk), status: 'ready' };
  } catch (error: any) {
    return {
      key: null,
      status: 'unavailable',
      reason: error?.message || 'The shared conversation key could not be derived on this device.',
    };
  }
}

/**
 * Group conversations use a random conversation key that is wrapped per member
 * device (AES-GCM over an ECDH-derived wrapping key) and stored as encrypted
 * envelopes in `conversation_key_envelopes`. Supabase never sees the key.
 *
 * If envelopes cannot be read or written under the current policies, the call
 * reports `unavailable` with a reason — it never falls back to an unencrypted
 * or fabricated chat.
 */
async function resolveGroupKey(room: SwarmRoom): Promise<ConversationKeyResult> {
  const identity = await getOrCreateDeviceIdentity();
  const devices = await loadConversationPeerDevices(room.id);
  if (!devices.length) {
    return {
      key: null,
      status: 'unavailable',
      reason: 'No member devices are registered for this conversation yet, so no group key can be provisioned.',
    };
  }

  const envelopes = await listConversationKeyEnvelopes(room.id);
  const mine = envelopes.find((envelope) => envelope.device_id === identity.deviceId);

  if (mine) {
    const creatorDeviceId = mine.created_by_device_id || mine.device_id;
    const creator = devices.find((device) => device.device_id === creatorDeviceId);
    const creatorJwk = parseJwk(creator?.public_key);
    if (!creatorJwk) {
      return {
        key: null,
        status: 'unavailable',
        reason: 'The member who created this group key is no longer registered on this conversation.',
      };
    }
    try {
      const key = await unwrapConversationKey(room.id, mine.wrapped_key, mine.nonce, creatorJwk);
      return { key, status: 'ready' };
    } catch (error: any) {
      return {
        key: null,
        status: 'unavailable',
        reason: 'This device could not unlock the group key envelope.',
      };
    }
  }

  // No envelope for this device yet: the first member to open the room
  // provisions the key for every registered member device.
  try {
    const conversationKey = await createConversationKey();
    for (const device of devices) {
      const deviceJwk = parseJwk(device.public_key);
      if (!deviceJwk) continue;
      const wrapped = await wrapConversationKey(room.id, conversationKey, deviceJwk);
      const saved = await saveConversationKeyEnvelope({
        conversation_id: room.id,
        user_id: device.user_id,
        device_id: device.device_id,
        wrapped_key: wrapped.wrappedKeyHex,
        nonce: wrapped.nonceHex,
        created_by_device_id: identity.deviceId,
      });
      if (!saved) {
        return {
          key: null,
          status: 'unavailable',
          reason: 'This device is not allowed to provision group keys for every member yet.',
        };
      }
    }
    return { key: conversationKey, status: 'ready' };
  } catch (error: any) {
    return {
      key: null,
      status: 'unavailable',
      reason: 'The group conversation key could not be provisioned on this device.',
    };
  }
}

export async function resolveConversationKey(room: SwarmRoom): Promise<ConversationKeyResult> {
  const isGroup = (room.memberIds?.length ?? 0) > 2 || room.type === 'gathering';
  return isGroup ? resolveGroupKey(room) : resolveDirectKey(room);
}
