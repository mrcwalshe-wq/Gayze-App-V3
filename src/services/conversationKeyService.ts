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
  readConversationMemberDevices,
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
  /** Legacy direct-chat key used only to read ciphertext created before device envelopes. */
  legacyKey?: CryptoKey;
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
 * Legacy direct-chat key derivation retained strictly as a read fallback for
 * ciphertext written before the device-envelope migration.
 */
async function resolveLegacyDirectKey(room: SwarmRoom): Promise<CryptoKey | null> {
  const inlinePeer = parseJwk(room.peerKey);
  const peer = inlinePeer
    ? { peer_public_key: room.peerKey }
    : await loadConversationPeerKey(room.id);
  let peerJwk = parseJwk(peer?.peer_public_key);
  if (!peerJwk) {
    const devices = await loadConversationPeerDevices(room.id);
    const peerDevice = devices.find((device) => device.user_id === room.peerUserId) ?? devices[0];
    peerJwk = parseJwk(peerDevice?.public_key);
  }
  if (!peerJwk) return null;
  try {
    return await deriveConversationKey(room.id, peerJwk);
  } catch {
    return null;
  }
}

/**
 * All live conversations now use the same device-aware AES-256 conversation
 * key model. Direct chats retain the legacy ECDH key only as a read fallback
 * so existing ciphertext is not rewritten, re-encrypted or discarded.
 */
async function resolveDeviceAwareKey(
  room: SwarmRoom,
  currentUserId?: string,
  deps: GroupKeyDeps = defaultGroupKeyDeps,
): Promise<ConversationKeyResult> {
  const identity = await getOrCreateDeviceIdentity();
  const [envelopeRead, deviceRead] = await Promise.all([
    readWithRetry(() => deps.readEnvelopes(room.id), deps.retryDelayMs),
    readWithRetry(() => readConversationMemberDevices(room.id), deps.retryDelayMs),
  ]);

  const legacyKey = room.type === 'direct'
    ? await resolveLegacyDirectKey(room)
    : null;

  // Failed reads are never treated as an empty keyset. This is critical:
  // no key generation and no envelope writes may occur after an ambiguous read.
  if (!envelopeRead.ok || !deviceRead.ok) {
    return {
      key: null,
      status: 'unavailable',
      transient: true,
      legacyKey: legacyKey ?? undefined,
      reason: 'The conversation key could not be read right now. No encryption key was generated.',
    };
  }

  const directLegacyFallback = (): ConversationKeyResult | null => legacyKey
    ? { key: legacyKey, status: 'ready', reason: 'Using the device-local legacy direct-chat key while the new device envelope is repaired.' }
    : null;

  const envelopes = envelopeRead.envelopes;
  const devices = deviceRead.devices.filter((device) => device.status !== 'revoked');

  // Never generate or persist a conversation key until this browser's device
  // is present in the authorised device registry. Without this guard, a chat
  // hydration race can create a key and then have every envelope write rejected
  // because the database correctly requires the creator device to be registered.
  const currentDevice = devices.find((device) => device.device_id === identity.deviceId);
  if (!currentDevice) {
    return directLegacyFallback() ?? {
      key: null,
      status: 'unavailable',
      transient: true,
      legacyKey: legacyKey ?? undefined,
      reason: 'This device is still being registered for encrypted conversations. Please retry.',
    };
  }

  const mine = envelopes.find((envelope) => envelope.device_id === identity.deviceId);
  if (mine) {
    const creatorDeviceId = mine.created_by_device_id || mine.device_id;
    const creator = devices.find((device) => device.device_id === creatorDeviceId)
      ?? (creatorDeviceId === identity.deviceId
        ? { public_key: identity.publicKeyJwkString }
        : undefined);
    const creatorJwk = parseJwk(creator?.public_key);
    if (!creatorJwk) {
      return {
        key: null,
        status: 'unavailable',
        transient: true,
        legacyKey: legacyKey ?? undefined,
        reason: 'The device that created this conversation key is not currently available.',
      };
    }
    try {
      const key = await unwrapConversationKey(room.id, mine.wrapped_key, mine.nonce, creatorJwk);

      // If another authorised device was added after this key was created,
      // the current key holder can add only that device's envelope. Existing
      // envelopes are never overwritten.
      for (const device of devices) {
        if (envelopes.some((envelope) => envelope.device_id === device.device_id)) continue;
        const deviceJwk = parseJwk(device.public_key);
        if (!deviceJwk) continue;
        const wrapped = await wrapConversationKey(room.id, key, deviceJwk);
        await saveConversationKeyEnvelope({
          conversation_id: room.id,
          user_id: device.user_id,
          device_id: device.device_id,
          wrapped_key: wrapped.wrappedKeyHex,
          nonce: wrapped.nonceHex,
          created_by_device_id: identity.deviceId,
        });
      }

      return { key, status: 'ready', legacyKey: legacyKey ?? undefined };
    } catch {
      return {
        key: null,
        status: 'unavailable',
        legacyKey: legacyKey ?? undefined,
        reason: 'This device could not unlock its conversation key envelope.',
      };
    }
  }

  // An existing envelope set proves that the conversation key already exists.
  // Never create a second key merely because this device is not provisioned.
  if (envelopes.length > 0) {
    return directLegacyFallback() ?? {
      key: null,
      status: 'unavailable',
      transient: true,
      legacyKey: legacyKey ?? undefined,
      reason: 'This device has not been provisioned with the existing conversation key yet.',
    };
  }

  if (devices.length === 0) {
    return {
      key: null,
      status: 'unavailable',
      transient: true,
      legacyKey: legacyKey ?? undefined,
      reason: 'No authorised device identities are available for this conversation.',
    };
  }

  // No envelope exists at all. This is the one safe point where the first
  // authorised device creates the conversation key and wraps it for every
  // currently authorised device. Existing message ciphertext is untouched.
  try {
    const conversationKey = await deps.createKey();
    const results = await Promise.all(devices.map(async (device) => {
      const deviceJwk = parseJwk(device.public_key);
      if (!deviceJwk) return false;
      try {
        const wrapped = await wrapConversationKey(room.id, conversationKey, deviceJwk);
        const stored = await deps.saveEnvelope({
          conversation_id: room.id,
          user_id: device.user_id,
          device_id: device.device_id,
          wrapped_key: wrapped.wrappedKeyHex,
          nonce: wrapped.nonceHex,
          created_by_device_id: identity.deviceId,
        });
        return Boolean(stored);
      } catch {
        return false;
      }
    }));
    const saved = results.filter(Boolean).length;

    if (saved === 0) {
      return directLegacyFallback() ?? {
        key: null,
        status: 'unavailable',
        legacyKey: legacyKey ?? undefined,
        reason: 'The conversation key could not be provisioned to an authorised device.',
      };
    }

    return { key: conversationKey, status: 'ready', legacyKey: legacyKey ?? undefined };
  } catch {
    return {
      key: null,
      status: 'unavailable',
      legacyKey: legacyKey ?? undefined,
      reason: 'The conversation key could not be provisioned on this device.',
    };
  }
}

async function resolveGroupKey(
  room: SwarmRoom,
  currentUserId?: string,
  deps: GroupKeyDeps = defaultGroupKeyDeps,
): Promise<ConversationKeyResult> {
  const identity = await getOrCreateDeviceIdentity();
  const envelopeRead = await readWithRetry(() => deps.readEnvelopes(room.id), deps.retryDelayMs);
  const deviceRead = await readWithRetry(() => deps.readDevices(room.id), deps.retryDelayMs);
  if (!envelopeRead.ok || !deviceRead.ok) {
    return { key: null, status: 'unavailable', transient: true, reason: 'The group key could not be read right now. Retrying will not change any existing key.' };
  }
  const envelopes = envelopeRead.envelopes;
  const devices = deviceRead.devices;
  const mine = envelopes.find((envelope) => envelope.device_id === identity.deviceId);

  if (mine) {
    const creatorDeviceId = mine.created_by_device_id || mine.device_id;
    const creator = devices.find((device) => device.device_id === creatorDeviceId)
      ?? (creatorDeviceId === identity.deviceId ? { public_key: identity.publicKeyJwkString } : undefined);
    const creatorJwk = parseJwk(creator?.public_key);
    if (!creatorJwk) return { key: null, status: 'unavailable', transient: true, reason: 'The device that created this group key is not currently available on this conversation.' };
    try {
      const key = await unwrapConversationKey(room.id, mine.wrapped_key, mine.nonce, creatorJwk);
      return { key, status: 'ready' };
    } catch {
      return { key: null, status: 'unavailable', reason: 'This device could not unlock the group key envelope.' };
    }
  }

  if (envelopes.length > 0) {
    return { key: null, status: 'unavailable', transient: true, reason: 'A group key exists for this conversation, but it has not been shared with this device yet.' };
  }

  try {
    const conversationKey = await deps.createKey();
    const recipients = [...devices];
    if (!recipients.some((device) => device.device_id === identity.deviceId) && currentUserId) {
      recipients.push({ user_id: currentUserId, device_id: identity.deviceId, public_key: identity.publicKeyJwkString });
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
      if (!stored) return { key: null, status: 'unavailable', reason: 'This device is not allowed to provision the group key for every member yet.' };
      saved += 1;
    }
    if (saved === 0) return { key: null, status: 'unavailable', reason: 'No member device with a usable identity key was found for this conversation.' };
    return { key: conversationKey, status: 'ready' };
  } catch {
    return { key: null, status: 'unavailable', reason: 'The group conversation key could not be provisioned on this device.' };
  }
}

export const resolveGroupKeyForTest = resolveGroupKey;

export async function resolveConversationKey(
  room: SwarmRoom,
  currentUserId?: string,
): Promise<ConversationKeyResult> {
  return resolveDeviceAwareKey(room, currentUserId);
}
