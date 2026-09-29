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
  // Live conversations must use a real ECDH public JWK, never a display
  // fingerprint or stale demo peerKey.
  const inlinePeer = parseJwk(room.peerKey);
  const peer = inlinePeer
    ? { peer_public_key: room.peerKey }
    : await loadConversationPeerKey(room.id);
  let peerJwk = parseJwk(peer?.peer_public_key);

  // Fall back to the verified device registry if the profile RPC is briefly
  // unavailable while a newly-created conversation is hydrating.
  if (!peerJwk) {
    const devices = await loadConversationPeerDevices(room.id);
    const peerDevice = devices.find((device) => device.user_id === room.peerUserId)
      ?? devices[0];
    peerJwk = parseJwk(peerDevice?.public_key);
  }
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
async function resolveGroupKey(
  room: SwarmRoom,
  currentUserId?: string,
): Promise<ConversationKeyResult> {
  const identity = await getOrCreateDeviceIdentity();
  const devices = await loadConversationPeerDevices(room.id);

  const envelopes = await listConversationKeyEnvelopes(room.id);
  const mine = envelopes.find((envelope) => envelope.device_id === identity.deviceId);

  if (mine) {
    // Someone (possibly an earlier device of mine) already wrapped the key for
    // this device; unwrap it with the creator's public key.
    const creatorDeviceId = mine.created_by_device_id || mine.device_id;
    const creator = devices.find((device) => device.device_id === creatorDeviceId)
      // The creator may be me on another device.
      ?? (creatorDeviceId === identity.deviceId
        ? { public_key: identity.publicKeyJwkString }
        : undefined);
    const creatorJwk = parseJwk(creator?.public_key);
    if (!creatorJwk) {
      return {
        key: null,
        status: 'unavailable',
        reason: 'The device that created this group key is no longer registered on this conversation.',
      };
    }
    try {
      const key = await unwrapConversationKey(room.id, mine.wrapped_key, mine.nonce, creatorJwk);
      return { key, status: 'ready' };
    } catch {
      return {
        key: null,
        status: 'unavailable',
        reason: 'This device could not unlock the group key envelope.',
      };
    }
  }

  // Envelopes exist but none for this device. Provisioning a *new* key here
  // would silently fork the conversation key and make everyone else's messages
  // unreadable, so this device stays locked until the key holder wraps it.
  if (envelopes.length > 0) {
    return {
      key: null,
      status: 'unavailable',
      reason: 'A group key exists for this conversation, but it has not been shared with this device yet.',
    };
  }

  // Nobody has provisioned a key yet: this device creates one and wraps it for
  // every registered member device (including itself).
  try {
    const conversationKey = await createConversationKey();
    const recipients: { user_id: string; device_id: string; public_key: string }[] = [
      ...devices,
    ];
    const ownDeviceRegistered = recipients.some((device) => device.device_id === identity.deviceId);
    if (!ownDeviceRegistered && currentUserId) {
      recipients.push({
        user_id: currentUserId,
        device_id: identity.deviceId,
        public_key: identity.publicKeyJwkString,
      });
    }

    let saved = 0;
    for (const device of recipients) {
      const deviceJwk = parseJwk(device.public_key);
      if (!deviceJwk) continue;
      const wrapped = await wrapConversationKey(room.id, conversationKey, deviceJwk);
      const stored = await saveConversationKeyEnvelope({
        conversation_id: room.id,
        user_id: device.user_id,
        device_id: device.device_id,
        wrapped_key: wrapped.wrappedKeyHex,
        nonce: wrapped.nonceHex,
        created_by_device_id: identity.deviceId,
      });
      if (!stored) {
        return {
          key: null,
          status: 'unavailable',
          reason: 'This device is not allowed to provision the group key for every member yet.',
        };
      }
      saved += 1;
    }

    if (saved === 0) {
      return {
        key: null,
        status: 'unavailable',
        reason: 'No member device with a usable identity key was found for this conversation.',
      };
    }

    return { key: conversationKey, status: 'ready' };
  } catch {
    return {
      key: null,
      status: 'unavailable',
      reason: 'The group conversation key could not be provisioned on this device.',
    };
  }
}

export async function resolveConversationKey(
  room: SwarmRoom,
  currentUserId?: string,
): Promise<ConversationKeyResult> {
  const isGroup = (room.memberIds?.length ?? 0) > 2 || room.type === 'gathering';
  return isGroup ? resolveGroupKey(room, currentUserId) : resolveDirectKey(room);
}
