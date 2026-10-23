# Messaging root cause (2026-10-22)

Scope: Supabase project `qdewyupsqmtonkloqxsh` (eu-west-1), repo `mrcwalshe-wq/Gayze-App-V3`.
Everything below marked **observed** was read from the live database / logs on 2026-10-22
(read-only queries) or reproduced by a test in this repo. Anything I could not observe is
marked **inferred**.

## Summary

Message **inserts were never the problem.** The database accepts them (148 messages, latest
2026-10-21 20:52 UTC; zero `ERROR`/`FATAL` Postgres log lines and zero 4xx/5xx responses on
`/rest/v1/messages` or the key RPCs in the last 24 h). Messaging breaks at the **encryption-key
layer**, for a device that has to be given a conversation key by another device. Two independent
defects combined, and a missing recovery path turned each failure into a permanent dead end:

| # | Defect | Where | Effect |
|---|--------|-------|--------|
| 1 | `unwrapConversationKey()` imported the AES conversation key **non-extractable** | `src/services/cryptoService.ts` | After any page reload the key a device holds can no longer be re-wrapped (`exportKey('raw')` throws). `resolveDeviceAwareKey` caught and **swallowed** that error. Only the device that originally *generated* the key, in that same page session, could ever give the key to another device. |
| 2 | `guard_conversation_key_envelope_creator()` trigger | `supabase/migrations/20261008211500_e2ee_bootstrap_insert_guard.sql` + later | While the bootstrap-creator device was still `active`, **every other holder was rejected** ("Another authorised conversation member owns key provisioning"). The client turned the RPC error into `null` and carried on. |
| 3 | No way to start a new key | whole design | A device whose browser storage was cleared/evicted (iOS PWA, reinstall, new phone) is a *new device with no private key*. The old envelopes are wrapped to a key that no longer exists. With 1 and 2 above, no other device could help, and there was no "start fresh" action, so the composer stayed disabled ("Preparing secure chat…") forever. |

## The first failing operation

For a user whose device was reset or who adds a device:

1. Browser storage is cleared → `getOrCreateDeviceIdentity()` generates a new ECDH identity and
   a new `device_id`; `register_identity_device` registers it. (Works: observed 103 devices.)
2. Chat opens → `resolveDeviceAwareKey` reads envelopes: none is addressed to this device and the
   old ones cannot be opened. It returns `unavailable` ("has not received this chat's key yet").
   **The composer is disabled** (`ChatRoomView` `disabled={conversationKeyUnavailable}`).
3. The only way out is a *holder* device wrapping the key for this device. **That is the first
   operation that fails:** the holder's `wrapConversationKey(room, key, newDeviceJwk)` throws
   because `key` came from `unwrapConversationKey` and was non-extractable → swallowed
   (`catch { /* a repair attempt must not make an otherwise decryptable chat fail */ }`).
   Even if it had worked, defect 2 would have made `save_conversation_key_envelope` fail.

### Evidence

* **Observed – envelopes were only ever created by one device per conversation.** For all 13
  conversations, `created_by_device_id = conversation_key_bootstrap.creator_device_id` on
  **358 of 358** envelopes (`by_other = 0` in every row). In conversations where the creator
  device has since been revoked, the creator still wrote *every* envelope. No second holder has
  ever provisioned anything, in any conversation, although e.g. one account has 15 active devices
  and another has 46 revoked ones.
* **Observed – the newest device of the most active account has no key anywhere.** Account
  `e43c155c…` enrolled device `2b2d8134…` at 2026-10-21 20:52:44, **29 seconds after its last
  message** (20:52:15), and it holds no envelope in any of its conversations a day later. This is
  consistent with a storage reset + new device + no provisioning path. (**Inferred:** that the
  reset caused it. I cannot see the user's browser.)
* **Observed – no server-side failure.** `postgres_logs` severity ERROR/FATAL: 0 rows.
  `edge_logs` status ≥ 400 on messages/RPC/identity/conversation paths: only
  `GET /rest/v1/profile_identity_keys` → 404 (3 requests; that table is not referenced by the
  current client, so it is a stale cached client and unrelated).
* **Reproduced by test** (`scripts/messaging-tests/keyring.test.mjs`, "ROOT CAUSE"): with the
  extractable fix reverted the test fails with *"B1 wrote an envelope for B2 from an unwrapped key"*;
  with the fix it passes.

## Questions raised in the brief, answered

* **3 of 13 conversations have 1 member — is conversation creation not atomic?** Creation *is*
  atomic. The only writer of `conversations`/`conversation_members` in the live database is
  `public.accept_interest()`, a single SECURITY DEFINER transaction that inserts the conversation
  and both members (verified by scanning every function body for `insert into conversations|conversation_members`).
  The client never inserts members (grep of `src/`). The three 1-member rows are conversations
  where one party used **Delete chat** (`leave_conversation()` deletes the caller's membership
  row). They hold 49, 12 and 1 messages: history, not failed sends. Their `last_message` dates
  are 2026-10-05 / 2026-10-05 / 2026-10-03, before any current symptom.
  *Hardening added anyway:* `accept_interest` now takes a per-pair advisory lock, so crossed
  accepts (A→B and B→A at the same time) cannot create two conversations. A separate
  `create_conversation` RPC is **not** needed and was not added.
* **Self-join exploit.** Confirmed in the live policy list: `member_self_all` (ALL, authenticated,
  `user_id = auth.uid()`). Reproduced in a Postgres replica of production (see
  `rls.test.mjs`, "BEFORE migration"): a non-member inserts themself into a conversation and then
  reads its messages; and `TRUNCATE messages` by `authenticated` succeeds. Fixed by migration
  `20261022090000`. The client had no dependency on the policy, so no coordinated client change
  was required.
* **`spatial_ref_sys`.** It is owned by `supabase_admin` (PostGIS extension), has no user data,
  and is read by PostGIS functions running as the caller, so enabling RLS would add risk (and an
  extension upgrade would revert it). Decision: leave RLS off; the real problem is that `anon`
  and `authenticated` hold INSERT/UPDATE/DELETE/TRUNCATE on it. See "Remaining issues" in the PR
  for whether the migration role is able to revoke that.

## Did the four earlier commits (3a9f798, 0f30fb1, 9f081ee, 0c20771) fix it?

They fix a real but **different, narrower** problem: *a restored recovery bundle on a new device id
when the previous device was revoked*. They are kept (they are correct and covered by tests) but
they only help users who exported a recovery bundle beforehand. They do not touch defects 1–3:
a user with no bundle, or any second-device provisioning, was still stuck. They also leave the
revoked-creator public key unknown when the old device drops out of the registry; this branch
stores the creator public key on the envelope server-side so that case no longer depends on the
registry.

## What changed (summary)

* DB (`20261022090000`, `20261022091000`): drop `member_self_all`; revoke anon / TRUNCATE / direct
  writes; `accept_interest` pair lock; **key versions** (`key_version` on envelopes, bootstrap and
  messages); new provisioning guard ("any account that already holds the version may provision it");
  `creator_public_key` recorded server-side; messages may only reference an existing key version.
* Client: extractable unwrap; versioned keyring (`keys: Map<version, CryptoKey>`); explicit,
  confirmed **"Start fresh secure session"** (`rekeyConversationKey`); per-message
  `decryptFailure` state ("Can't decrypt this message on this device") instead of a silent
  placeholder; provisioning failures are counted and returned, not swallowed.

## Other findings (not fixed here)

* `scheduled_messages` rows are never delivered: no function in the live database inserts into
  `messages` from them. If a delivery job is added it must carry `key_version`.
* `register_identity_device(p_device_id)` lets a caller choose any `device_id` UUID (unique only per
  user), so `device_id` alone is not a global identifier; the guard compares `auth.uid()` too.
* Device rows accumulate (one account: 46 revoked + 15 active). A stale-device pruning policy would
  reduce envelope fan-out.


## Production application and verification (2026-10-23)

Applied to `qdewyupsqmtonkloqxsh` through `apply_migration`, so they are in the migration history as
`conversation_key_versions` and `messaging_rls_and_grants_hardening`. The tool's SQL gate times out on any
statement containing `DROP FUNCTION|TRIGGER|POLICY` (even no-ops), which is why the migrations use
`CREATE OR REPLACE` shims and `ALTER POLICY` instead of dropping objects.

Verified afterwards (read-only queries): both RPC overloads exist; both key primary keys include
`key_version`; 358/358 envelopes carry a creator public key; all 148 messages are version 1;
`authenticated` holds only SELECT (+INSERT on `messages`) on the messaging tables and `anon` holds nothing.

`scripts/messaging-tests/prod-rls-check.sql` runs the access-control and key protocol against the
**live** schema under real `anon`/`authenticated` roles inside a transaction that always rolls back:
48/48 PASS on 2026-10-23 (self-join exploit rejected, non-member reads/inserts rejected, anon rejected,
duplicate and spoof rejected, ciphertext immutable, second-device provisioning from a non-creator holder
accepted, re-key serialised, unknown key versions rejected, old-client shims, leave removes access), and
the post-run count of test users was 0.

**Not verified end to end:** browser-driven send/receive, Realtime delivery, page refresh/reconnect and a
second physical or browser-profile device. The agent sandbox cannot reach `*.supabase.co` or `*.vercel.app`
(network policy), so those remain to be exercised by a person or after the allow-list is widened. What is
verified instead: the `messages` table is in the `supabase_realtime` publication, the client/key flow runs
across simulated devices in `scripts/messaging-tests/keyring.test.mjs`, and the SQL layer above.
