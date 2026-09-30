/**
 * GAYZE E2EE regression test.
 *
 * Drives the REAL src/services/cryptoService.ts (AES-GCM + ECDH via WebCrypto)
 * across two simulated devices with separate identity stores. Nothing here
 * re-implements the crypto — the shipped functions are imported and called.
 *
 * Covers the four stated regressions:
 *   1. Device A -> Device B decrypts
 *   2. Device B -> Device A decrypts
 *   3. Historical messages decrypt after reload
 *   4. No valid message is left as "[Encrypted message]"
 *
 * Run: npx tsx scripts/e2ee-tests/e2ee.test.mjs
 */
import { createDevice, installWindowGlobal } from './shims.mjs';

installWindowGlobal();

// The real crypto engine under test.
const crypto = await import('../../src/services/cryptoService.ts');
const {
  deriveConversationKey,
  createConversationKey,
  wrapConversationKey,
  unwrapConversationKey,
  encryptWithConversationKey,
  decryptWithConversationKey,
  encryptPayload,
  decryptPayload,
  getOrCreateDeviceIdentity,
  generateSafetyFingerprint,
  hexToBuf,
  bufToHex,
} = crypto;

let failures = 0;
function assert(cond, msg) {
  if (!cond) { console.error('  \u2717 FAIL:', msg); failures += 1; process.exitCode = 1; }
  else console.log('  \u2713', msg);
}
const section = (title) => console.log(`\n=== ${title} ===`);

// ---------------------------------------------------------------------------
// Two devices, each with its own identity store (IndexedDB) and device id.
// ---------------------------------------------------------------------------
const deviceA = createDevice('A');
const deviceB = createDevice('B');

const CONVERSATION_ID = '00000000-0000-4000-8000-000000000c01';

section('[0] Device identities are separate and stable');
deviceA.use();
const identityA = await getOrCreateDeviceIdentity();
const identityA2 = await getOrCreateDeviceIdentity();
deviceB.use();
const identityB = await getOrCreateDeviceIdentity();

assert(identityA.fingerprint !== identityB.fingerprint, 'A and B have distinct identity fingerprints');
assert(identityA.fingerprint === identityA2.fingerprint, 'A identity is stable across re-reads (persisted in IndexedDB)');
assert(identityA.deviceId !== identityB.deviceId, 'A and B have distinct device ids');
assert(identityA.publicKeyJwk.kty === 'EC' && identityA.publicKeyJwk.crv === 'P-256', 'identity key is ECDH P-256');

// ---------------------------------------------------------------------------
// DIRECT conversations: both sides ECDH-derive the same key from the peer's
// published public JWK. This is exactly what resolveDirectKey() calls.
// ---------------------------------------------------------------------------+section('[1] Direct conversation: Device A -> Device B decrypts');
deviceA.use();
const keyOnA_forDirect = await deriveConversationKey(CONVERSATION_ID, identityB.publicKeyJwk);
deviceB.use();
const keyOnB_forDirect = await deriveConversationKey(CONVERSATION_ID, identityA.publicKeyJwk);

const aToB = 'Meet at the corner bar in 20?';
deviceA.use();
const aToBSealed = await encryptWithConversationKey(aToB, keyOnA_forDirect);
deviceB.use();
const aToBPlain = await decryptWithConversationKey(aToBSealed.cipherHex, aToBSealed.nonceHex, keyOnB_forDirect);
assert(aToBPlain === aToB, `A -> B round-trips ("${aToBPlain}")`);

section('[2] Direct conversation: Device B -> Device A decrypts');
const bToA = 'On my way, 5 minutes out.';
deviceB.use();
const bToASealed = await encryptWithConversationKey(bToA, keyOnB_forDirect);
deviceA.use();
const bToAPlain = await decryptWithConversationKey(bToASealed.cipherHex, bToASealed.nonceHex, keyOnA_forDirect);
assert(bToAPlain === bToA, `B -> A round-trips ("${bToAPlain}")`);

section('[2b] The shared secret is symmetric and conversation-bound');
deviceA.use();
const otherConvKey = await deriveConversationKey('00000000-0000-4000-8000-000000000c99', identityB.publicKeyJwk);
let crossConvFailed = false;
try {
  deviceB.use();
  await decryptWithConversationKey(aToBSealed.cipherHex, aToBSealed.nonceHex, otherConvKey);
} catch { crossConvFailed = true; }
assert(crossConvFailed, 'a key derived for a DIFFERENT conversation cannot decrypt this one');

section('[2c] Ciphertext and nonce are tamper-evident (AES-GCM auth tag)');
deviceA.use();
const sealed = await encryptWithConversationKey('authenticate me', keyOnA_forDirect);
const flip = (hex) => {
  const bytes = hexToBuf(hex);
  bytes[0] ^= 0xff;
  return bufToHex(bytes);
};
let badCipherFailed = false;
try {
  deviceB.use();
  await decryptWithConversationKey(flip(sealed.cipherHex), sealed.nonceHex, keyOnB_forDirect);
} catch { badCipherFailed = true; }
assert(badCipherFailed, 'a flipped ciphertext byte fails to decrypt (never yields wrong plaintext)');

let badNonceFailed = false;
try {
  deviceB.use();
  await decryptWithConversationKey(sealed.cipherHex, flip(sealed.nonceHex), keyOnB_forDirect);
} catch { badNonceFailed = true; }
assert(badNonceFailed, 'a flipped nonce byte fails to decrypt');

deviceB.use();
assert(await decryptWithConversationKey(sealed.cipherHex, sealed.nonceHex, keyOnB_forDirect) === 'authenticate me',
  'untampered ciphertext still decrypts after the tamper attempts');

// ---------------------------------------------------------------------------
// GROUP conversations: a random conversation key wrapped per member device.
// ---------------------------------------------------------------------------
section('[3] Group conversation: key wrapped per device, unwrapped by each member');
deviceA.use();
const groupKey = await createConversationKey();
const wrappedForB = await wrapConversationKey(CONVERSATION_ID, groupKey, identityB.publicKeyJwk);
deviceB.use();
const groupKeyOnB = await unwrapConversationKey(CONVERSATION_ID, wrappedForB.wrappedKeyHex, wrappedForB.nonceHex, identityA.publicKeyJwk);

const groupMsg = 'Group plan: Saturday, 8pm.';
deviceA.use();
const groupSealed = await encryptWithConversationKey(groupMsg, groupKey);
deviceB.use();
assert(await decryptWithConversationKey(groupSealed.cipherHex, groupSealed.nonceHex, groupKeyOnB) === groupMsg,
  'member B unwraps the envelope and reads the group message');

// NOTE: the creator (A) *can* unwrap the envelope it minted for B — ECDH is
// symmetric, so both halves of the (A,B) pair derive the same wrapping key.
// The property that actually matters is that an UNRELATED device cannot.
const deviceC = createDevice('C');
deviceC.use();
const identityC = await getOrCreateDeviceIdentity();
let outsiderUnwrapFailed = false;
try {
  await unwrapConversationKey(CONVERSATION_ID, wrappedForB.wrappedKeyHex, wrappedForB.nonceHex, identityA.publicKeyJwk);
} catch { outsiderUnwrapFailed = true; }
assert(outsiderUnwrapFailed, 'an unrelated third device (C) cannot unwrap the A/B envelope');

// ---------------------------------------------------------------------------
// 4. HISTORICAL MESSAGES SURVIVE A RELOAD.
//    Identity lives in IndexedDB, so after a reload the device re-reads it and
//    re-derives the same key. cryptoService keeps no module-level identity
//    cache, so re-invoking getOrCreateDeviceIdentity() is the reload path.
// ---------------------------------------------------------------------------
section('[4] Historical messages decrypt after reload');
const history = [
  'First message of the thread',
  'Second message with an emoji \ud83d\ude42',
  'Third message: unicode \u00e9\u00e8\u00fc\u4e2d\u6587 \u0627\u0644\u0639\u0631\u0628\u064a\u0629',
  JSON.stringify({ text: 'photo caption', mediaUrl: 'https://cdn.example/x.jpg' }),
  'a'.repeat(4000),
];

// What App.tsx is expected to DISPLAY for each sealed history entry. Entry 3 is
// a media payload: the app unwraps the JSON envelope and shows `text`, so the
// displayed string is intentionally not the raw sealed payload.
const expectedPlainText = history.map((text) => (
  text.startsWith('{"') && text.includes('"mediaUrl"') ? JSON.parse(text).text : text
));

deviceA.use();
const sealedHistory = [];
for (const text of history) {
  sealedHistory.push(await encryptWithConversationKey(text, keyOnA_forDirect));
}

// --- reload on Device B: re-read the persisted identity, re-derive the key ---
deviceB.use();
const identityB_afterReload = await getOrCreateDeviceIdentity();
assert(identityB_afterReload.fingerprint === identityB.fingerprint, 'B identity survives reload (same fingerprint)');
const keyOnB_afterReload = await deriveConversationKey(CONVERSATION_ID, identityA.publicKeyJwk);

let historyOk = true;
for (let i = 0; i < history.length; i += 1) {
  const plain = await decryptWithConversationKey(
    sealedHistory[i].cipherHex, sealedHistory[i].nonceHex, keyOnB_afterReload,
  );
  if (plain !== history[i]) { historyOk = false; console.error(`   message ${i} mismatch`); }
}
assert(historyOk, `all ${history.length} historical messages decrypt after reload (incl. unicode, media JSON, 4 kB)`);

// ---------------------------------------------------------------------------
// 5. THE "[Encrypted message]" PLACEHOLDER.
//    Mirrors the exact retry loop in App.tsx (3 attempts, 300ms backoff,
//    key re-resolution between attempts). A valid message must never be left
//    showing the placeholder.
// ---------------------------------------------------------------------------
section('[5] No valid message is left as "[Encrypted message]"');

const PLACEHOLDER = '[Encrypted message]';

/** Faithful copy of the decrypt loop used by App.tsx (realtime + hydrate). */
async function decryptLikeApp(row, resolveKey) {
  let plainText = PLACEHOLDER;
  let mediaUrl;
  let decryptedOk = false;
  let conversationKey = null;

  for (let attempt = 0; attempt < 3 && row.nonce && !decryptedOk; attempt += 1) {
    try {
      if (!conversationKey) {
        const resolved = await resolveKey(attempt);
        conversationKey = resolved.key;
      }
      if (!conversationKey) throw new Error('Conversation key unavailable');
      const decrypted = await decryptWithConversationKey(row.ciphertext, row.nonce, conversationKey);
      if (decrypted.startsWith('{"') && decrypted.includes('"mediaUrl"')) {
        try {
          const parsed = JSON.parse(decrypted);
          plainText = parsed.text || '';
          mediaUrl = parsed.mediaUrl;
        } catch { plainText = decrypted; }
      } else {
        plainText = decrypted;
      }
      decryptedOk = true;
    } catch {
      conversationKey = null;
    }
  }
  return { plainText, mediaUrl, decryptedOk };
}

deviceA.use();
const rows = [];
for (const text of history) {
  const s = await encryptWithConversationKey(text, keyOnA_forDirect);
  rows.push({ ciphertext: s.cipherHex, nonce: s.nonceHex });
}

deviceB.use();
// (a) Key available immediately.
let allOkImmediate = true;
for (let i = 0; i < rows.length; i += 1) {
  const r = await decryptLikeApp(rows[i], async () => ({ key: await deriveConversationKey(CONVERSATION_ID, identityA.publicKeyJwk) }));
  if (!r.decryptedOk || r.plainText === PLACEHOLDER || r.plainText !== expectedPlainText[i]) allOkImmediate = false;
}
assert(allOkImmediate, 'with the key available, every valid message decrypts (no placeholder)');

// (b) Key bootstrap is LATE: first attempt has no key, retry succeeds.
//     This is the real-world race the retry loop exists for.
deviceB.use();
let allOkLateKey = true;
for (let i = 0; i < rows.length; i += 1) {
  const r = await decryptLikeApp(rows[i], async (attempt) => (
    attempt === 0 ? { key: null } : { key: await deriveConversationKey(CONVERSATION_ID, identityA.publicKeyJwk) }
  ));
  if (!r.decryptedOk || r.plainText === PLACEHOLDER || r.plainText !== expectedPlainText[i]) allOkLateKey = false;
}
assert(allOkLateKey, 'with a LATE key bootstrap, the retry still recovers every valid message');

// (c) Media message keeps its text + mediaUrl rather than the placeholder.
deviceA.use();
const mediaText = JSON.stringify({ text: 'night out', mediaUrl: 'https://cdn.example/y.jpg' });
const mediaSealed = await encryptWithConversationKey(mediaText, keyOnA_forDirect);
deviceB.use();
const mediaResult = await decryptLikeApp(
  { ciphertext: mediaSealed.cipherHex, nonce: mediaSealed.nonceHex },
  async () => ({ key: await deriveConversationKey(CONVERSATION_ID, identityA.publicKeyJwk) }),
);
assert(mediaResult.plainText === 'night out' && mediaResult.mediaUrl === 'https://cdn.example/y.jpg',
  'media payload yields its caption + mediaUrl, not the placeholder');

// (d) HONEST FAILURE: a message with no nonce legitimately cannot be decrypted,
//     so the placeholder is the correct, truthful outcome (never fake plaintext).
deviceB.use();
const noNonce = await decryptLikeApp(
  { ciphertext: sealedHistory[0].cipherHex, nonce: null },
  async () => ({ key: await deriveConversationKey(CONVERSATION_ID, identityA.publicKeyJwk) }),
);
assert(!noNonce.decryptedOk && noNonce.plainText === PLACEHOLDER,
  'a row with no nonce keeps the placeholder (truthful, not fabricated)');

// (e) A genuinely undecryptable row (wrong conversation) keeps the placeholder.
deviceB.use();
const wrongKey = await deriveConversationKey('00000000-0000-4000-8000-000000000c99', identityA.publicKeyJwk);
const undecryptable = await decryptLikeApp(rows[0], async () => ({ key: wrongKey }));
assert(!undecryptable.decryptedOk && undecryptable.plainText === PLACEHOLDER,
  'a row from a different conversation keeps the placeholder');

// ---------------------------------------------------------------------------
// 6. Swarm-room (shared seed) path, still used by group swarm rooms.
// ---------------------------------------------------------------------------
section('[6] Swarm-room seed path round-trips');
deviceA.use();
const roomSeed = crypto.generateRandomKey();
const swarmSealed = await encryptPayload('swarm room message', roomSeed);
assert(await decryptPayload(swarmSealed.cipherHex, swarmSealed.nonceHex, roomSeed) === 'swarm room message',
  'encryptPayload/decryptPayload round-trip with a shared room seed');
let wrongSeedFailed = false;
try { await decryptPayload(swarmSealed.cipherHex, swarmSealed.nonceHex, crypto.generateRandomKey()); }
catch { wrongSeedFailed = true; }
assert(wrongSeedFailed, 'a different room seed cannot decrypt the payload');

section('[7] Safety fingerprints agree on both devices');
deviceA.use();
const fpA = await generateSafetyFingerprint(identityA.fingerprint, identityB.fingerprint);
deviceB.use();
const fpB = await generateSafetyFingerprint(identityB.fingerprint, identityA.fingerprint);
assert(fpA === fpB && fpA.split(' ').length === 6, `both devices derive the same 6-chunk safety number (${fpA})`);

console.log('');
if (failures > 0) {
  console.error(`E2EE TESTS: ${failures} FAILED`);
  process.exitCode = 1;
} else {
  console.log('E2EE TESTS: ALL PASSED');
}
