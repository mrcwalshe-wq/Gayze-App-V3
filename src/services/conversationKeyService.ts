import type { SwarmRoom } from '../types';
import type { DeviceIdentity } from './cryptoService';
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
  claimConversationKeyBootstrap,
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
  readDevices: (conversationId: string) => Promise<{ ok: boolean; devices: Array<{ user_id: string; device_id: string; public_key: string; status?: string }> }>;
  /** Full member-device read used by direct-chat bootstrap; injectable for regression tests. */
  readMemberDevices?: (conversationId: string) => Promise<{ ok: boolean; devices: Array<{ user_id: string; device_id: string; public_key: string; status?: string }> }>;
  getIdentity?: () => Promise<DeviceIdentity>;
  resolveLegacyKey?: (room: SwarmRoom) => Promise<CryptoKey | null>;
  claimBootstrap?: typeof claimConversationKeyBootstrap;
  saveEnvelope: typeof saveConversationKeyEnvelope;
  createKey: typeof createConversationKey;
  retryDelayMs: number;
}

const defaultGroupKeyDeps: GroupKeyDeps = {
  readEnvelopes: readConversationKeyEnvelopes,
  readDevices: readConversationPeerDevices,
  readMemberDevices: readConversationMemberDevices,
  getIdentity: getOrCreateDeviceIdentity,
  resolveLegacyKey: resolveLegacyDirectKey,
  claimBootstrap: claimConversationKeyBootstrap,
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
  const identity = await (deps.getIdentity ?? getOrCreateDeviceIdentity)();

  // Legacy ECDH remains a read fallback for older ciphertext, but it must
  // never short-circuit the device-envelope path for direct chats. Previously
  // every direct chat returned here, which meant conversation_key_envelopes
  // stayed empty forever and multi-device recipients could not decrypt.
  const legacyKey = room.type === 'direct'
    ? await (deps.resolveLegacyKey ?? resolveLegacyDirectKey)(room)
    : null;

  const [envelopeRead, deviceRead] = await Promise.all([
    readWithRetry(() => deps.readEnvelopes(room.id), deps.retryDelayMs),
    readWithRetry(() => (deps.readMemberDevices ?? readConversationMemberDevices)(room.id), deps.retryDelayMs),
  ]);

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

  // Legacy keys are read-only compatibility candidates. Never return one as
  // the active key: sends use result.key, so doing so would continue writing
  // legacy ciphertext and bypass device-envelope provisioning indefinitely.
  const legacyReadFallback = (reason: string): ConversationKeyResult => ({
    key: null,
    status: 'unavailable',
    transient: true,
    legacyKey: legacyKey ?? undefined,
    reason,
  });

  const envelopes = envelopeRead.envelopes;
  const devices = deviceRead.devices.filter((device) => device.status !== 'revoked');

  // Never generate or persist a conversation key until this browser's device
  // is present in the authorised device registry. Without this guard, a chat
  // hydration race can create a key and then have every envelope write rejected
  // because the database correctly requires the creator device to be registered.
  const currentDevice = devices.find((device) => device.device_id === identity.deviceId);
  if (!currentDevice) {
    return legacyReadFallback('This device is still being registered for encrypted conversations. Please retry.');
  }

  // iOS/PWA storage can lose the local device-id entry while retaining the
  // IndexedDB ECDH identity. In that case registration creates a fresh device
  // id for the same keypair; the old envelope is still cryptographically valid
  // but is indexed by the previous id. Recover it only when the old registered
  // device's public key exactly matches this device's public key and belongs to
  // the same account. Never adopt another device's envelope by user id alone.
  const samePublicIdentity = (device: { public_key: string }) => {
    const jwk = parseJwk(device.public_key);
    return Boolean(
      jwk?.x && jwk?.y
      && jwk.x === identity.publicKeyJwk.x
      && jwk.y === identity.publicKeyJwk.y,
    );
  };
  // A restored recovery identity keeps its ECDH private key but receives a new
  // physical-device ID. The previous device may already be revoked and is
  // therefore intentionally absent from `devices`. Consider old envelopes
  // belonging to this account, but accept one only if authenticated decryption
  // proves this device has the matching private identity.
  const ownEnvelopeCandidates = [
    ...envelopes.filter((envelope) => envelope.device_id === identity.deviceId),
    ...envelopes.filter((envelope) =>
      envelope.device_id !== identity.deviceId && envelope.user_id === currentDevice.user_id),
  ];
  let mine: typeof envelopes[number] | undefined;
  let key: CryptoKey | null = null;

  for (const envelope of ownEnvelopeCandidates) {
    const creatorDeviceId = envelope.created_by_device_id || envelope.device_id;
    const creator = devices.find((device) => device.device_id === creatorDeviceId);
    const creatorJwk = parseJwk(creator?.public_key);
    // A creator can have been revoked too. Trying this device's own public key
    // is safe: AES-GCM authentication rejects it unless it is the matching key.
    const creatorCandidates = [
      ...(creatorJwk ? [{ jwk: creatorJwk }] : []),
      ...devices
        .filter((device) => device.device_id !== creatorDeviceId)
        .map((device) => ({ jwk: parseJwk(device.public_key) }))
        .filter((candidate): candidate is { jwk: JsonWebKey } => Boolean(candidate.jwk)),
      { jwk: identity.publicKeyJwk },
    ];
    for (const candidate of creatorCandidates) {
      try {
        key = await unwrapConversationKey(room.id, envelope.wrapped_key, envelope.nonce, candidate.jwk);
        if (key) break;
      } catch {
        // Wrong ECDH pair or tampered envelope: try another authorised key
        // candidate or the next account-owned envelope, never bypass auth.
      }
    }
    if (key) {
      mine = envelope;
      break;
    }
  }

  if (ownEnvelopeCandidates.length > 0 && (!mine || !key)) {
    return {
      key: null,
      status: 'unavailable',
      legacyKey: legacyKey ?? undefined,
      reason: 'This device could not unlock its conversation key envelope. Retry, or restore the original identity on this device.',
    };
  }

  if (mine && key) {
    // If another authorised device was added after this key was created,
    // the current key holder can add only that device's envelope. Existing
    // envelopes are never overwritten.
    for (const device of devices) {
      if (envelopes.some((envelope) => envelope.device_id === device.device_id)) continue;
      const deviceJwk = parseJwk(device.public_key);
      if (!deviceJwk) continue;
      try {
        let envelope;
        if (samePublicIdentity(device)) {
          envelope = { ...mine, user_id: device.user_id, device_id: device.device_id };
        } else {
          const wrapped = await wrapConversationKey(room.id, key, deviceJwk);
          envelope = {
            conversation_id: room.id,
            user_id: device.user_id,
            device_id: device.device_id,
            wrapped_key: wrapped.wrappedKeyHex,
            nonce: wrapped.nonceHex,
            created_by_device_id: identity.deviceId,
          };
        }
        await deps.saveEnvelope(envelope);
      } catch {
        // A repair attempt must not make an otherwise decryptable chat fail.
        // The missing device can be provisioned on a later successful retry.
      }
    }

    return { key, status: 'ready', legacyKey: legacyKey ?? undefined };
  }

  // An existing envelope set proves that the conversation key already exists.
  // Never create a second key merely because this device is not provisioned.
  if (envelopes.length > 0) {
    // The envelope key is authoritative for new sends. A legacy key may still
    // decrypt historical rows, but must never unlock the composer on a device
    // that has not received its envelope.
    return legacyReadFallback('This device (for example the Home Screen app, which has separate storage from Safari) has not received this chat\'s key yet. Open the chat once on your other signed-in device, or restore your identity backup in Profile, then retry.');
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

  // No envelope exists at all. Serialize the first-key creator so two
  // devices cannot generate different conversation keys at the same time.
  // Existing legacy ciphertext remains readable through legacyKey.
  try {
    const claimed = await (deps.claimBootstrap ?? claimConversationKeyBootstrap)(room.id, identity.deviceId);
    if (!claimed) {
      // Another authorised device is creating the key. Give it a short window,
      // then re-read the envelopes rather than creating a competing key.
      await new Promise((resolve) => setTimeout(resolve, deps.retryDelayMs * 2));
      const retryRead = await readWithRetry(() => deps.readEnvelopes(room.id), deps.retryDelayMs);
      if (retryRead.ok && retryRead.envelopes.length > 0) {
        const mineAfterClaim = retryRead.envelopes.find((envelope) => envelope.device_id === identity.deviceId);
        if (mineAfterClaim) {
          const creatorDeviceId = mineAfterClaim.created_by_device_id || mineAfterClaim.device_id;
          const creator = devices.find((device) => device.device_id === creatorDeviceId)
            ?? (creatorDeviceId === identity.deviceId ? { public_key: identity.publicKeyJwkString } : undefined);
          const creatorJwk = parseJwk(creator?.public_key);
          if (creatorJwk) {
            try {
              const key = await unwrapConversationKey(room.id, mineAfterClaim.wrapped_key, mineAfterClaim.nonce, creatorJwk);
              return { key, status: 'ready', legacyKey: legacyKey ?? undefined };
            } catch { /* fall through to retry state */ }
          }
        }
      }
      return {
        key: null,
        status: 'unavailable',
        transient: true,
        legacyKey: legacyKey ?? undefined,
        reason: 'Another authorised device is setting up this conversation. Please retry in a moment.',
      };
    }

    const conversationKey = await deps.createKey();
    const creatorDevice = devices.find((device) => device.device_id === identity.deviceId);
    const creatorJwk = parseJwk(creatorDevice?.public_key);
    if (!creatorDevice || !creatorJwk) {
      return {
        key: null,
        status: 'unavailable',
        transient: true,
        legacyKey: legacyKey ?? undefined,
        reason: 'This device could not be provisioned with the conversation key. Retrying is safe.',
      };
    }

    // Persist the creator's envelope first. If it fails, no other device gets
    // an envelope for a key that this device cannot recover on a later retry.
    let ownEnvelopeSaved = false;
    try {
      const wrapped = await wrapConversationKey(room.id, conversationKey, creatorJwk);
      ownEnvelopeSaved = Boolean(await deps.saveEnvelope({
        conversation_id: room.id,
        user_id: creatorDevice.user_id,
        device_id: creatorDevice.device_id,
        wrapped_key: wrapped.wrappedKeyHex,
        nonce: wrapped.nonceHex,
        created_by_device_id: identity.deviceId,
      }));
    } catch {
      ownEnvelopeSaved = false;
    }
    if (!ownEnvelopeSaved) {
      return {
        key: null,
        status: 'unavailable',
        transient: true,
        legacyKey: legacyKey ?? undefined,
        reason: 'The conversation key was not provisioned to this device. Retrying is safe.',
      };
    }

    const recipientResults = await Promise.all(devices
      .filter((device) => device.device_id !== identity.deviceId)
      .map(async (device) => {
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

    // Do not advertise a usable key until every authorised device can recover it.
    if (recipientResults.some((saved) => !saved)) {
      return {
        key: null,
        status: 'unavailable',
        transient: true,
        legacyKey: legacyKey ?? undefined,
        reason: 'The conversation key was not provisioned to every authorised device. Retrying is safe.',
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

/** Test-only injection point for exercising direct-chat bootstrap without a live account or database writes. */
export async function resolveConversationKeyForTest(
  room: SwarmRoom,
  currentUserId: string,
  deps: GroupKeyDeps,
): Promise<ConversationKeyResult> {
  return resolveDeviceAwareKey(room, currentUserId, { ...defaultGroupKeyDeps, ...deps });
}
