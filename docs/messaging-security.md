# Messaging security model

This describes what the code in this repository does today (after the key-version change), and
what the server can and cannot do. It deliberately lists the weaknesses.

## Primitives (all WebCrypto; nothing hand-rolled)

| Purpose | Primitive | Where |
|---|---|---|
| Per-device identity | ECDH P-256 key pair (`generateKey`), plus an ECDSA P-256 signing pair used for device challenges | `cryptoService.getOrCreateDeviceIdentity` |
| Conversation key | Random AES-256-GCM key, one per *key version* of a conversation | `createConversationKey` |
| Message encryption | AES-256-GCM, random 96-bit nonce per message, 128-bit tag | `encryptWithConversationKey` |
| Key envelope (per device, per version) | AES-256-GCM key = `SHA-256(ECDH(sender_priv, recipient_pub) ‖ "GAYZE-CONVERSATION-ENVELOPE-v1:" ‖ conversation_id)`, random 96-bit nonce | `wrapConversationKey` / `unwrapConversationKey` |
| Identity backup | PBKDF2-SHA-256 (600 000 iterations, 16-byte salt) → AES-256-GCM over the private JWK | `createRecoveryBundle` |

Not ideal, and not changed here: the envelope key is a plain SHA-256 over the ECDH secret plus a
context string rather than HKDF (the construction is still sound for a single-purpose key), and
there is no per-message associated data binding a ciphertext to its conversation, sender or
version.

## Generation and storage

* **Device identity.** Generated in the browser on first use. The private key never leaves the
  device: it lives in IndexedDB (`gayze-crypto` / `identity`) as a `CryptoKey`; the account scope and
  device id live in `localStorage`. It is generated *extractable* so that the user can export the
  encrypted backup bundle. Page JavaScript (including an XSS) can therefore read it. The identity
  is **not** uploaded anywhere (`7878531 Keep private identity keys off Supabase`).
* **Conversation key.** Generated on the first device that opens a new conversation (after winning
  `claim_conversation_key_bootstrap` for version 1), then immediately wrapped for every active device
  of both members and discarded from the network. Held in page memory only. Since this release a
  device that has *unwrapped* its key can re-wrap it for other devices; the unwrapped key is
  extractable in memory for that reason (it was previously non-extractable, which silently made
  re-wrapping impossible, see `messaging-root-cause.md`).
* **Server stores** `identity_devices.public_key`, `conversation_key_envelopes` (wrapped key, nonce,
  creator device, creator public key, key version), `messages.ciphertext` / `nonce` / `key_version`.

## Device enrolment

1. Sign in → `getOrCreateDeviceIdentity(userId)`; a missing IndexedDB key means a **new** device id
   and a **new** key pair (never reuse an id whose private half is gone).
2. `register_identity_device` records the public keys; `verify-device-signature` (challenge /
   response signed by the device's ECDSA key) proves possession before chat hydration.
3. The new device has no envelope yet. **Any device that already holds a key version** (of the same
   user, or the peer) wraps that version for it the next time that holder opens the chat; the
   server only accepts the write from an account that already holds the version
   (`guard_conversation_key_envelope_creator`). A holder who is offline cannot help; see recovery.

## Recovery with no old session available

In order of preference, all explicit and visible:

1. **Another signed-in device** of either member opens the chat → it provisions the new device. The
   banner says so and has a *Retry* button.
2. **Identity backup bundle** (Profile → restore). The ECDH key is restored under a *new* device id;
   envelopes addressed to the old id are opened by authenticated decryption (and are re-wrapped to
   the new id). Requires the passphrase (≥ 15 characters).
3. **Start fresh secure session** (new). Needs no old session and no backup: a member's device mints
   key version *N+1* and wraps it for every active device of both members. Cost: messages sent under
   versions this device never held show *"Can't decrypt this message on this device"*. Nothing is
   deleted: any device that still holds an older key keeps reading, and gives that key to the new
   device as soon as it opens the chat, which makes the history readable again.
   The action is confirmed by the user and can only run if a member's own active device claims the
   next version (`claim_conversation_key_bootstrap`, serialised per conversation; a second concurrent
   re-key gets "busy").

There is no server-side recovery and no key escrow: **if every device and every backup is lost,
history sent under that version is unreadable by everyone, including us.**

## What the server can and cannot do

Cannot (assuming honest clients and the cryptography above):
* Read message content, attachments' content (media is inside the encrypted JSON payload), or any
  conversation key or device private key. Nothing sent to Supabase contains them; the test suite
  asserts the canary plaintext, raw conversation key and private JWK are absent from every server-bound
  payload and from `localStorage`.
* Undetectably modify a ciphertext: AES-GCM fails authentication and the message is shown as
  *"failed its integrity check"* (`MessageDecryptError: authentication_failed`), never rendered.
  RLS/grants additionally stop any client from `UPDATE`/`DELETE` of stored ciphertext.

Can:
* See metadata: who talks to whom, when, message sizes, expiry, key versions, device lists, push
  timing.
* **Substitute device public keys** (it serves `identity_devices.public_key`). A malicious or
  compromised server/database operator could enrol its own device for a user and receive envelopes
  for new key versions. Safety numbers (`generateSafetyFingerprint`) exist for out-of-band checks, but
  the app does not currently force verification, so it is trust-on-first-use against the server.
* Drop, delay, reorder or replay messages; there is no authenticated sequence number.
* Attribute a message to a different member: `sender_id` is server-asserted and ciphertexts are not
  signed. Either member can also forge messages "from" the other, because both hold the same
  symmetric key.
* Deny service (e.g. refuse to serve envelopes).

A member can also force a re-key; that cannot expose past messages but makes older ones unreadable
on devices that never held the old key.

## Access control (enforced by Postgres, tested in `scripts/messaging-tests/rls.test.mjs`)

* `conversations` / `conversation_members`: clients can only `SELECT`; creation and leaving are done
  by SECURITY DEFINER functions (`accept_interest`, `leave_conversation`). The permissive
  `member_self_all` policy that allowed self-joining any conversation is dropped.
* `messages`: `INSERT` requires `sender_id = auth.uid()` and membership; `SELECT` requires
  membership; clients cannot `UPDATE`/`DELETE`; `(sender_id, client_message_id)` and the primary key
  prevent duplicates; `key_version` must reference an existing version.
* `anon` has no privileges on any messaging table; nobody except the table owner can `TRUNCATE`.
* Envelopes and bootstrap claims are written only through guarded RPCs that check membership, the
  target device's activity, the creator device's ownership and (for non-first envelopes) that the
  caller already holds that key version.

## Known limitations

* No forward secrecy or post-compromise security: one conversation key per version protects all
  messages of that version; compromise of any member device with the key exposes that version.
* Stale/dead devices still receive envelopes while their rows are `active`.
* The XSS threat model is weak by design: identity private key and unwrapped keys are
  extractable `CryptoKey`s in page memory.
