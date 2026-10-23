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

/**
 * Why a key could not be resolved. The UI maps these to honest, recoverable
 * states; nothing here ever degrades to plaintext or a silent drop.
 */
export type ConversationKeyCode =
  | 'ready'
  | 'read_failed'
  | 'device_pending'
  | 'no_member_devices'
  | 'key_not_shared'
  | 'cannot_unwrap'
  | 'bootstrap_busy'
  | 'provision_failed';

export interface ConversationKeyResult {
  /** Key used to ENCRYPT new messages: always the newest key version. */
  key: CryptoKey | null;
  /** Version of `key`. */
  keyVersion?: number;
  /** Every key version this device can open, for decrypting history. */
  keys?: Map<number, CryptoKey>;
  status: 'ready' | 'unavailable';
  /** Human-readable, honest reason when a key could not be resolved. */
  reason?: string;
  /** True when the failure may clear on retry (network/RLS read failure), never permanent absence. */
  transient?: boolean;
  /** Legacy direct-chat key used only to read ciphertext created before device envelopes. */
  legacyKey?: CryptoKey;
  code?: ConversationKeyCode;
  /**
   * True when this device cannot open the current key but a member may start a
   * fresh key version (explicit, user-confirmed). Older messages then stay
   * unreadable on devices that never held the older keys.
   */
  canRekey?: boolean;
  /** Envelopes a holder could not write for other devices this pass (reported, not hidden). */
  provisionFailures?: number;
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

type Envelope = ConversationKeyEnvelopeRead['envelopes'][number];
type RegisteredDevice = { user_id: string; device_id: string; public_key: string; status?: string };

const versionOf = (envelope: Envelope) => envelope.key_version ?? 1;

/**
 * Try to open one envelope. AES-GCM authenticates the wrap, so offering a
 * wrong creator key just fails; nothing is trusted merely because it parses.
 * The envelope's server-recorded creator key goes first, so envelopes stay
 * openable after the wrapping device is revoked and absent from the registry.
 */
async function openEnvelope(
  conversationId: string,
  envelope: Envelope,
  devices: RegisteredDevice[],
  identity: DeviceIdentity,
): Promise<CryptoKey | null> {
  const creatorDeviceId = envelope.created_by_device_id || envelope.device_id;
  const seen = new Set<string>();
  const candidates: JsonWebKey[] = [];
  const offer = (jwk: JsonWebKey | null) => {
    if (!jwk?.x || !jwk?.y) return;
    const id = `${jwk.x}.${jwk.y}`;
    if (seen.has(id)) return;
    seen.add(id);
    candidates.push(jwk);
  };
  offer(parseJwk(envelope.creator_public_key));
  offer(parseJwk(devices.find((device) => device.device_id === creatorDeviceId)?.public_key));
  for (const device of devices) offer(parseJwk(device.public_key));
  offer(identity.publicKeyJwk);
  for (const jwk of candidates) {
    try {
      return await unwrapConversationKey(conversationId, envelope.wrapped_key, envelope.nonce, jwk);
    } catch {
      // Wrong ECDH pair or tampered envelope: try the next candidate only.
    }
  }
  return null;
}

/**
 * Create `version` of the conversation key on this device, wrap it for every
 * authorised member device and persist the envelopes. The caller must hold the
 * claim for `version` (the server enforces it).
 */
async function mintKeyVersion(
  room: SwarmRoom,
  version: number,
  identity: DeviceIdentity,
  devices: RegisteredDevice[],
  deps: GroupKeyDeps,
  legacyKey: CryptoKey | null,
  olderKeys: Map<number, CryptoKey>,
): Promise<ConversationKeyResult> {
  const withLegacy = { legacyKey: legacyKey ?? undefined };
  const claimed = await (deps.claimBootstrap ?? claimConversationKeyBootstrap)(room.id, identity.deviceId, version);
  if (!claimed) {
    // Another authorised device is minting it. Never create a competing key;
    // the caller re-reads and finds that device's envelopes.
    return {
      key: null, status: 'unavailable', transient: true, code: 'bootstrap_busy', ...withLegacy,
      reason: 'Another authorised device is setting up this conversation. Please retry in a moment.',
    };
  }

  const creatorDevice = devices.find((device) => device.device_id === identity.deviceId);
  const creatorJwk = parseJwk(creatorDevice?.public_key);
  if (!creatorDevice || !creatorJwk) {
    return {
      key: null, status: 'unavailable', transient: true, code: 'device_pending', ...withLegacy,
      reason: 'This device could not be provisioned with the conversation key. Retrying is safe.',
    };
  }

  const conversationKey = await deps.createKey();
  const wrapFor = async (device: RegisteredDevice): Promise<boolean> => {
    const deviceJwk = parseJwk(device.public_key);
    if (!deviceJwk) return false;
    try {
      const wrapped = await wrapConversationKey(room.id, conversationKey, deviceJwk);
      return Boolean(await deps.saveEnvelope({
        conversation_id: room.id,
        user_id: device.user_id,
        device_id: device.device_id,
        wrapped_key: wrapped.wrappedKeyHex,
        nonce: wrapped.nonceHex,
        created_by_device_id: identity.deviceId,
        key_version: version,
      }));
    } catch {
      return false;
    }
  };

  // The creator's own envelope goes first: if it fails nobody gets a key that
  // this device cannot recover on a retry.
  if (!(await wrapFor(creatorDevice))) {
    return {
      key: null, status: 'unavailable', transient: true, code: 'provision_failed', ...withLegacy,
      reason: 'The conversation key was not provisioned to this device. Retrying is safe.',
    };
  }

  const others = devices.filter((device) => device.device_id !== identity.deviceId);
  const outcomes = await Promise.all(others.map(async (device) => ({ device, saved: await wrapFor(device) })));
  // Every member must be able to open the key on at least one device. A stale
  // device that cannot be provisioned must not block the chat; it is counted
  // and re-attempted by any holder on the next resolve.
  const reachable = new Set<string>([creatorDevice.user_id]);
  for (const outcome of outcomes) if (outcome.saved) reachable.add(outcome.device.user_id);
  const members = new Set(devices.map((device) => device.user_id));
  const unreachable = [...members].filter((userId) => !reachable.has(userId));
  if (unreachable.length > 0) {
    return {
      key: null, status: 'unavailable', transient: true, code: 'provision_failed', ...withLegacy,
      reason: 'The conversation key was not provisioned to every member. Retrying is safe.',
    };
  }

  const keys = new Map(olderKeys);
  keys.set(version, conversationKey);
  return {
    key: conversationKey, keyVersion: version, keys, status: 'ready', code: 'ready', ...withLegacy,
    provisionFailures: outcomes.filter((outcome) => !outcome.saved).length,
  };
}

/**
 * All live conversations use the same device-aware AES-256 conversation key
 * model, versioned so a member can start a fresh key when no device can open
 * the current one. Direct chats retain the legacy ECDH key only as a read
 * fallback so existing ciphertext is not rewritten, re-encrypted or discarded.
 */
async function resolveDeviceAwareKey(
  room: SwarmRoom,
  currentUserId?: string,
  deps: GroupKeyDeps = defaultGroupKeyDeps,
): Promise<ConversationKeyResult> {
  const identity = await (deps.getIdentity ?? getOrCreateDeviceIdentity)();

  // Legacy ECDH remains a read fallback for older ciphertext, but it must
  // never short-circuit the device-envelope path for direct chats.
  const legacyKey = room.type === 'direct'
    ? await (deps.resolveLegacyKey ?? resolveLegacyDirectKey)(room)
    : null;
  const withLegacy = { legacyKey: legacyKey ?? undefined };

  const [envelopeRead, deviceRead] = await Promise.all([
    readWithRetry(() => deps.readEnvelopes(room.id), deps.retryDelayMs),
    readWithRetry(() => (deps.readMemberDevices ?? readConversationMemberDevices)(room.id), deps.retryDelayMs),
  ]);

  // Failed reads are never treated as an empty keyset. This is critical:
  // no key generation and no envelope writes may occur after an ambiguous read.
  if (!envelopeRead.ok || !deviceRead.ok) {
    return {
      key: null, status: 'unavailable', transient: true, code: 'read_failed', ...withLegacy,
      reason: 'The conversation key could not be read right now. No encryption key was generated.',
    };
  }

  const envelopes = envelopeRead.envelopes;
  const devices = deviceRead.devices.filter((device) => device.status !== 'revoked');

  // Never generate or persist a conversation key until this browser's device
  // is present in the authorised device registry; the database correctly
  // rejects envelopes from an unregistered creator.
  const currentDevice = devices.find((device) => device.device_id === identity.deviceId);
  if (!currentDevice) {
    return {
      key: null, status: 'unavailable', transient: true, code: 'device_pending', ...withLegacy,
      reason: 'This device is still being registered for encrypted conversations. Please retry.',
    };
  }

  const byVersion = new Map<number, Envelope[]>();
  for (const envelope of envelopes) {
    const list = byVersion.get(versionOf(envelope)) ?? [];
    list.push(envelope);
    byVersion.set(versionOf(envelope), list);
  }
  const versions = [...byVersion.keys()].sort((a, b) => b - a);
  const current = versions[0] ?? 0;

  // Open every version this device can. An envelope indexed under another of
  // this account's device ids (a restored or re-enrolled identity keeps its
  // ECDH key but gets a new device id) is tried too; authenticated decryption
  // proves whether this device really holds the matching private key.
  const keys = new Map<number, CryptoKey>();
  let sawOwnEnvelope = false;
  for (const version of versions) {
    const list = byVersion.get(version)!;
    const own = [
      ...list.filter((envelope) => envelope.device_id === identity.deviceId),
      ...list.filter((envelope) => envelope.device_id !== identity.deviceId && envelope.user_id === currentDevice.user_id),
    ];
    if (own.length > 0) sawOwnEnvelope = true;
    for (const envelope of own) {
      const key = await openEnvelope(room.id, envelope, devices, identity);
      if (key) { keys.set(version, key); break; }
    }
  }

  // Any device that can open a version may provision it to the member devices
  // that lack an envelope. Existing envelopes are never overwritten.
  let provisionFailures = 0;
  for (const [version, key] of keys) {
    const have = new Set((byVersion.get(version) ?? []).map((envelope) => envelope.device_id));
    const missing = devices.filter((device) => !have.has(device.device_id) && parseJwk(device.public_key));
    const outcomes = await Promise.all(missing.map(async (device) => {
      try {
        const wrapped = await wrapConversationKey(room.id, key, parseJwk(device.public_key)!);
        return Boolean(await deps.saveEnvelope({
          conversation_id: room.id,
          user_id: device.user_id,
          device_id: device.device_id,
          wrapped_key: wrapped.wrappedKeyHex,
          nonce: wrapped.nonceHex,
          created_by_device_id: identity.deviceId,
          key_version: version,
        }));
      } catch {
        return false;
      }
    }));
    provisionFailures += outcomes.filter((saved) => !saved).length;
  }

  if (current > 0) {
    const key = keys.get(current);
    if (key) {
      return { key, keyVersion: current, keys, status: 'ready', code: 'ready', provisionFailures, ...withLegacy };
    }
    // Encrypting with an older version would strand the other member, and a
    // legacy key must never unlock the composer. Older versions stay readable.
    return {
      key: null, keys, status: 'unavailable', canRekey: true, provisionFailures, ...withLegacy,
      code: sawOwnEnvelope ? 'cannot_unwrap' : 'key_not_shared',
      reason: sawOwnEnvelope
        ? 'This device cannot unlock this chat\'s key (its private key is no longer on this device). Open the chat on another signed-in device, restore your identity backup in Profile, or start a fresh secure session.'
        : 'This device has not received this chat\'s key yet. Open the chat once on another signed-in device, restore your identity backup in Profile, or start a fresh secure session.',
    };
  }

  if (devices.length === 0) {
    return {
      key: null, status: 'unavailable', transient: true, code: 'no_member_devices', ...withLegacy,
      reason: 'No authorised device identities are available for this conversation.',
    };
  }

  // No envelope exists at all: mint version 1. The claim serialises the first
  // creator so two devices cannot generate different keys at once.
  try {
    return await mintKeyVersion(room, 1, identity, devices, deps, legacyKey, keys);
  } catch {
    return {
      key: null, status: 'unavailable', code: 'provision_failed', ...withLegacy,
      reason: 'The conversation key could not be provisioned on this device.',
    };
  }
}

/**
 * User-confirmed fresh key. Mints version current + 1 for every authorised
 * device of every member. Messages encrypted under older versions stay stored,
 * and stay readable on devices that still hold those keys; devices that never
 * held them see an explicit "can't decrypt" state for those messages.
 */
async function rekeyConversation(
  room: SwarmRoom,
  deps: GroupKeyDeps = defaultGroupKeyDeps,
): Promise<ConversationKeyResult> {
  const identity = await (deps.getIdentity ?? getOrCreateDeviceIdentity)();
  const [envelopeRead, deviceRead] = await Promise.all([
    readWithRetry(() => deps.readEnvelopes(room.id), deps.retryDelayMs),
    readWithRetry(() => (deps.readMemberDevices ?? readConversationMemberDevices)(room.id), deps.retryDelayMs),
  ]);
  if (!envelopeRead.ok || !deviceRead.ok) {
    return {
      key: null, status: 'unavailable', transient: true, code: 'read_failed',
      reason: 'The conversation key could not be read right now. Nothing was changed.',
    };
  }
  const devices = deviceRead.devices.filter((device) => device.status !== 'revoked');
  if (!devices.some((device) => device.device_id === identity.deviceId)) {
    return {
      key: null, status: 'unavailable', transient: true, code: 'device_pending',
      reason: 'This device is still being registered for encrypted conversations. Please retry.',
    };
  }
  const next = Math.max(0, ...envelopeRead.envelopes.map(versionOf)) + 1;
  const legacyKey = room.type === 'direct' ? await (deps.resolveLegacyKey ?? resolveLegacyDirectKey)(room) : null;
  const minted = await mintKeyVersion(room, next, identity, devices, deps, legacyKey, new Map());
  if (minted.status !== 'ready') return minted;
  // Re-resolve so the keyring also contains every older version this device holds.
  return resolveDeviceAwareKey(room, undefined, deps);
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

export async function rekeyConversationKey(room: SwarmRoom): Promise<ConversationKeyResult> {
  return rekeyConversation(room);
}

/** Test-only injection point for the re-key flow. */
export async function rekeyConversationKeyForTest(room: SwarmRoom, deps: GroupKeyDeps): Promise<ConversationKeyResult> {
  return rekeyConversation(room, { ...defaultGroupKeyDeps, ...deps });
}

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
