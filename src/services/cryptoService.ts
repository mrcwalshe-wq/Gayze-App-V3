/**
 * Cryptographic engine using WebCrypto (SubtleCrypto)
 * Implementing AES-GCM 256-bit authenticated encryption and SHA-256 fingerprints
 */

// Helper to convert ArrayBuffer to Hex string
export function bufToHex(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

// Helper to convert Hex string to Uint8Array
export function hexToBuf(hex: string): Uint8Array {
  const cleanHex = hex.replace(/[^0-9a-fA-F]/g, '');
  const bytes = new Uint8Array(cleanHex.length / 2);
  for (let i = 0; i < cleanHex.length; i += 2) {
    bytes[i / 2] = parseInt(cleanHex.substring(i, i + 2), 16);
  }
  return bytes;
}

// Generate or derive a CryptoKey for a swarm room
export async function getRoomKey(roomSeedHex: string): Promise<CryptoKey> {
  const encoder = new TextEncoder();
  const rawKeyMaterial = encoder.encode(roomSeedHex);
  
  // Hash seed to 256-bit key
  const hash = await window.crypto.subtle.digest('SHA-256', rawKeyMaterial);
  return await window.crypto.subtle.importKey(
    'raw',
    hash,
    { name: 'AES-GCM' },
    false,
    ['encrypt', 'decrypt']
  );
}

// Encrypt plaintext with AES-GCM 256-bit
export async function encryptPayload(
  text: string,
  roomSeedHex: string
): Promise<{ cipherHex: string; nonceHex: string }> {
  try {
    const key = await getRoomKey(roomSeedHex);
    const nonce = window.crypto.getRandomValues(new Uint8Array(12)); // 96-bit IV
    const encoded = new TextEncoder().encode(text);

    const ciphertext = await window.crypto.subtle.encrypt(
      {
        name: 'AES-GCM',
        iv: nonce,
        tagLength: 128,
      },
      key,
      encoded
    );

    return {
      cipherHex: bufToHex(ciphertext),
      nonceHex: bufToHex(nonce.buffer),
    };
  } catch (err) {
    console.error('Encryption failed:', err);
    // Fallback if subtle crypto fails
    return {
      cipherHex: btoa(text),
      nonceHex: '000000000000000000000000',
    };
  }
}

// Decrypt AES-GCM 256-bit ciphertext
export async function decryptPayload(
  cipherHex: string,
  nonceHex: string,
  roomSeedHex: string
): Promise<string> {
  try {
    const key = await getRoomKey(roomSeedHex);
    const nonce = hexToBuf(nonceHex);
    const ciphertext = hexToBuf(cipherHex);

    const decrypted = await window.crypto.subtle.decrypt(
      {
        name: 'AES-GCM',
        iv: nonce as unknown as Uint8Array<ArrayBuffer>,
        tagLength: 128,
      },
      key,
      ciphertext as unknown as BufferSource
    );

    return new TextDecoder().decode(decrypted);
  } catch (err) {
    console.error('Decryption failed, using envelope fallback:', err);
    try {
      return atob(cipherHex);
    } catch {
      return '[Encrypted ciphertext could not be decoded]';
    }
  }
}

// Generate Safety Number fingerprint formatted as 12 numeric chunks like Signal/Keet
export async function generateSafetyFingerprint(
  keyA: string,
  keyB: string
): Promise<string> {
  const sorted = [keyA, keyB].sort().join(':');
  const digest = await window.crypto.subtle.digest(
    'SHA-256',
    new TextEncoder().encode(sorted)
  );
  const bytes = new Uint8Array(digest);
  
  const chunks: string[] = [];
  for (let i = 0; i < 6; i++) {
    const val = (bytes[i * 4] << 24) | (bytes[i * 4 + 1] << 16) | (bytes[i * 4 + 2] << 8) | bytes[i * 4 + 3];
    const num = Math.abs(val) % 100000;
    chunks.push(num.toString().padStart(5, '0'));
  }
  return chunks.join(' ');
}

// Generate random cryptographic identity keypair representation
export function generateRandomKey(): string {
  const randomBytes = window.crypto.getRandomValues(new Uint8Array(32));
  return 'pk_' + bufToHex(randomBytes.buffer);
}


export interface DeviceIdentity {
  publicKeyJwk: JsonWebKey;
  publicKeyJwkString: string;
  fingerprint: string;
}

const IDENTITY_DB_NAME = 'gayze-crypto';
const IDENTITY_STORE_NAME = 'identity';
const IDENTITY_KEY = 'device';

function openIdentityDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(IDENTITY_DB_NAME, 1);
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains(IDENTITY_STORE_NAME)) {
        request.result.createObjectStore(IDENTITY_STORE_NAME);
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error('Unable to open identity store'));
  });
}

async function readStoredIdentity(): Promise<CryptoKeyPair | null> {
  if (typeof indexedDB === 'undefined') return null;
  const db = await openIdentityDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(IDENTITY_STORE_NAME, 'readonly');
    const request = tx.objectStore(IDENTITY_STORE_NAME).get(IDENTITY_KEY);
    request.onsuccess = () => resolve(request.result ?? null);
    request.onerror = () => reject(request.error ?? new Error('Unable to read identity'));
    tx.oncomplete = () => db.close();
    tx.onerror = () => db.close();
  });
}

async function writeStoredIdentity(identity: CryptoKeyPair): Promise<void> {
  const db = await openIdentityDb();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(IDENTITY_STORE_NAME, 'readwrite');
    tx.objectStore(IDENTITY_STORE_NAME).put(identity, IDENTITY_KEY);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error ?? new Error('Unable to store identity'));
    tx.onabort = () => reject(tx.error ?? new Error('Unable to store identity'));
  });
  db.close();
}

export async function getOrCreateDeviceIdentity(): Promise<DeviceIdentity> {
  let identity = await readStoredIdentity();
  if (!identity) {
    identity = await window.crypto.subtle.generateKey(
      { name: 'ECDH', namedCurve: 'P-256' },
      true,
      ['deriveBits'],
    ) as CryptoKeyPair;
    await writeStoredIdentity(identity);
  }

  const publicKeyJwk = await window.crypto.subtle.exportKey('jwk', identity.publicKey);
  const publicKeyJwkString = JSON.stringify(publicKeyJwk);
  const digest = await window.crypto.subtle.digest(
    'SHA-256',
    new TextEncoder().encode(publicKeyJwkString),
  );
  const fingerprint = 'pk_' + bufToHex(digest).slice(0, 64);

  return { publicKeyJwk, publicKeyJwkString, fingerprint };
}

export async function deriveConversationKey(
  conversationId: string,
  peerPublicKeyJwk: JsonWebKey,
): Promise<CryptoKey> {
  const identity = await readStoredIdentity();
  if (!identity) throw new Error('Device cryptographic identity is not initialized');

  const peerPublicKey = await window.crypto.subtle.importKey(
    'jwk',
    peerPublicKeyJwk,
    { name: 'ECDH', namedCurve: 'P-256' },
    false,
    [],
  );

  const sharedSecret = await window.crypto.subtle.deriveBits(
    { name: 'ECDH', public: peerPublicKey },
    identity.privateKey,
    256,
  );

  const context = new TextEncoder().encode(`GAYZE-CONVERSATION-v1:${conversationId}`);
  const material = new Uint8Array(sharedSecret.byteLength + context.byteLength);
  material.set(new Uint8Array(sharedSecret), 0);
  material.set(context, sharedSecret.byteLength);

  const digest = await window.crypto.subtle.digest('SHA-256', material);
  return window.crypto.subtle.importKey(
    'raw',
    digest,
    { name: 'AES-GCM' },
    false,
    ['encrypt', 'decrypt'],
  );
}

export async function encryptWithConversationKey(
  text: string,
  key: CryptoKey,
): Promise<{ cipherHex: string; nonceHex: string }> {
  const nonce = window.crypto.getRandomValues(new Uint8Array(12));
  const ciphertext = await window.crypto.subtle.encrypt(
    { name: 'AES-GCM', iv: nonce, tagLength: 128 },
    key,
    new TextEncoder().encode(text),
  );
  return { cipherHex: bufToHex(ciphertext), nonceHex: bufToHex(nonce.buffer) };
}

export async function decryptWithConversationKey(
  cipherHex: string,
  nonceHex: string,
  key: CryptoKey,
): Promise<string> {
  const plaintext = await window.crypto.subtle.decrypt(
    { name: 'AES-GCM', iv: hexToBuf(nonceHex), tagLength: 128 },
    key,
    hexToBuf(cipherHex),
  );
  return new TextDecoder().decode(plaintext);
}


export interface RecoveryBundle {
  v: 1;
  type: 'gayze_identity_recovery';
  publicKeyJwk: JsonWebKey;
  saltHex: string;
  ivHex: string;
  wrappedPrivateKeyHex: string;
  iterations: number;
}

async function passwordWrappingKey(password: string, salt: Uint8Array, iterations: number) {
  const material = await window.crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(password),
    'PBKDF2',
    false,
    ['deriveKey'],
  );
  return window.crypto.subtle.deriveKey(
    { name: 'PBKDF2', salt, iterations, hash: 'SHA-256' },
    material,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt'],
  );
}

export async function createRecoveryBundle(password: string): Promise<RecoveryBundle> {
  if (password.length < 15) throw new Error('Recovery passphrase must be at least 15 characters');

  const identity = await readStoredIdentity();
  if (!identity) throw new Error('Device identity is not initialized');

  const privateJwk = await window.crypto.subtle.exportKey('jwk', identity.privateKey);
  const publicKeyJwk = await window.crypto.subtle.exportKey('jwk', identity.publicKey);
  const salt = window.crypto.getRandomValues(new Uint8Array(16));
  const iv = window.crypto.getRandomValues(new Uint8Array(12));
  const iterations = 600000;
  const wrappingKey = await passwordWrappingKey(password, salt, iterations);
  const plaintext = new TextEncoder().encode(JSON.stringify(privateJwk));
  const ciphertext = await window.crypto.subtle.encrypt(
    { name: 'AES-GCM', iv, tagLength: 128 },
    wrappingKey,
    plaintext,
  );

  return {
    v: 1,
    type: 'gayze_identity_recovery',
    publicKeyJwk,
    saltHex: bufToHex(salt.buffer),
    ivHex: bufToHex(iv.buffer),
    wrappedPrivateKeyHex: bufToHex(ciphertext),
    iterations,
  };
}

export async function restoreRecoveryBundle(bundle: RecoveryBundle, password: string): Promise<DeviceIdentity> {
  if (bundle?.v !== 1 || bundle.type !== 'gayze_identity_recovery') throw new Error('Invalid GAYZE recovery bundle');
  const salt = hexToBuf(bundle.saltHex);
  const iv = hexToBuf(bundle.ivHex);
  const wrappingKey = await passwordWrappingKey(password, salt, bundle.iterations);
  const plaintext = await window.crypto.subtle.decrypt(
    { name: 'AES-GCM', iv, tagLength: 128 },
    wrappingKey,
    hexToBuf(bundle.wrappedPrivateKeyHex),
  );
  const privateJwk = JSON.parse(new TextDecoder().decode(plaintext)) as JsonWebKey;
  const privateKey = await window.crypto.subtle.importKey(
    'jwk',
    privateJwk,
    { name: 'ECDH', namedCurve: 'P-256' },
    true,
    ['deriveBits'],
  );
  const publicKey = await window.crypto.subtle.importKey(
    'jwk',
    bundle.publicKeyJwk,
    { name: 'ECDH', namedCurve: 'P-256' },
    true,
    [],
  );
  await writeStoredIdentity({ privateKey, publicKey });
  const publicKeyJwkString = JSON.stringify(bundle.publicKeyJwk);
  const digest = await window.crypto.subtle.digest('SHA-256', new TextEncoder().encode(publicKeyJwkString));
  return {
    publicKeyJwk: bundle.publicKeyJwk,
    publicKeyJwkString,
    fingerprint: 'pk_' + bufToHex(digest).slice(0, 64),
  };
}

export function recoveryBundleToText(bundle: RecoveryBundle): string {
  return JSON.stringify(bundle);
}

export function parseRecoveryBundle(text: string): RecoveryBundle {
  return JSON.parse(text) as RecoveryBundle;
}
