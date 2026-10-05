import type { SwarmRoom } from '../types';
import {
  deriveConversationKey,
  createConversationKey,
  wrapConversationKey,
  unwrapConversationKey,
  getOrCreateDeviceIdentity,
} from './cryptoService';
import {
  loadConversationPeerDevices,
  loadConversationPeerKey,
  readConversationKeyEnvelopes,
  readConversationPeerDevices,
  saveConversationKeyEnvelope,
} from './supabaseService';
import type { ConversationKeyEnvelopeRead } from './supabaseService';

export interface ConversationKeyResult {
  key: CryptoKey | null;
  status: 'ready' | 'unavailable';
  /** Human-readable, honest reason when a key could not be resolved. */
  reason?: string;
  /** True when the failure may clear on retry (network/RLS read failure), never permanent absence. */
  transient?: boolean;
}

/** Injectable for tests; production uses the Supabase-backed implementations. */
export interface GroupKeyDeps {
  readEnvelopes: (conversationId: string) => Promise<ConversationKeyEnvelopeRead>;
  readDevices: (conversationId: string) => Promise<{ ok: boolean; devices: Array<{ user_id: string; device_id: string; public_key: string }> }>;
  saveEnvelope: typeof saveConversationKeyEnvelope;
  createKey: typeof createConversationKey;
  retryDelayMs: number;
}

const defaultGroupKeyDeps: GroupKeyDeps = {
  readEnvelopes: readConversationKeyEnvelopes,
  readDevices: readConversationPeerDevices,
  saveEnvelope: saveConversationKeyEnvelope,
  createKey: createConversationKey,
  retryDelayMs: 250,
};

const READ_ATTEMPTS = 3;

async function readWithRetry<T extends { ok: boolean }>(read: () => Promise<T>, delayMs: number): Promise<T> {
  let result = await read();
  for (let attempt = 1; !result.ok && attempt < READ_ATTEMPTS; attempt++) {
    await new Promise((resolve) => setTimeout(resolve, delayMs * attempt));
    result = await read();
  }
  return result;
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
  deps: GroupKeyDeps = defaultGroupKeyDeps,
): Promise<ConversationKeyResult> {
  const identity = await getOrCreateDeviceIdentity();
  const envelopeRead = await readWithRetry(() => deps.readEnvelopes(room.id), deps.retryDelayMs);
  const deviceRead = await readWithRetry(() => deps.readDevices(room.id), deps.retryDelayMs);
  // A failed read is NOT proof that no key exists. Never provision (or
  // overwrite) key material from an unreadable state: report it as transient.
  if (!envelopeRead.ok || !deviceRead.ok) {
    return {
      key: null,
      status: 'unavailable',
      transient: true,
      reason: 'The group key could not be read right now. Retrying will not change any existing key.',
    };
  }
  const envelopes = envelopeRead.envelopes;
  const devices = deviceRead.devices;
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
        transient: true,
        reason: 'The device that created this group key is not currently available on this conversation.',
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
      transient: true,
      reason: 'A group key exists for this conversation, but it has not been shared with this device yet.',
    };
  }

  // Nobody has provisioned a key yet: this device creates one and wraps it for
  // every registered member device (including itself).
  try {
    const conversationKey = await deps.createKey();
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
      const stored = await deps.saveEnvelope({
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

export const resolveGroupKeyForTest = resolveGroupKey;

export async function resolveConversationKey(
  room: SwarmRoom,
  currentUserId?: string,
): Promise<ConversationKeyResult> {
  const isGroup = (room.memberIds?.length ?? 0) > 2 || room.type === 'gathering';
  return isGroup ? resolveGroupKey(room, currentUserId) : resolveDirectKey(room);
}
