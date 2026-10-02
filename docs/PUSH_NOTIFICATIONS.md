# GAYZE — durable notifications and existing Web Push

> **Controlled release-candidate follow-up (2026-10-01):** See [RELEASE_CANDIDATE_REPORT.md](RELEASE_CANDIDATE_REPORT.md) for the current inventory, warm-history/cache and drawer fixes, migration hardening, latest tests and open release gates. No rollout is authorized.

Updated 2026-09-30. **Implementation and isolated local validation only. No migration, function or app deployment has been performed.** See [RELEASE_READINESS.md](RELEASE_READINESS.md) for results and remaining gates.

## Technology and provenance

The project uses browser **Web Push + VAPID**, the existing `web-push@3.6.7` library, Supabase Edge Functions/Postgres and the root `/service-worker.js`. Google, Mozilla, Apple and Windows push-service endpoints belong to the browser subscription. This is **not** a new FCM server-key integration or a native APNs-token integration. No provider was replaced.

At base `1190d6a`, `supabase/functions/send-push/index.ts` was one newline. Read-only investigation also recovered an earlier sender on `feat/notification-reminder` (blob `03a7d2df0ec24851113e3de3d3944ca1dee113fd`). It confirmed the same provider/library, VAPID and dispatch-secret conventions, but did not provide a durable notification inbox or per-endpoint message/Gayze delivery claims. It was inspected as reference, not merged. **Patch 1 was not used.**

## Authoritative pipeline

```text
Authenticated Gayze/message write
  → AFTER INSERT trigger (recipient derived from actual source row/memberships)
  → gayze_notifications row in the SAME database transaction
  → pg_net dispatch of { notificationId }, using Vault dispatch secret
  → send-push authenticates and loads that existing row
  → check recipient preferences, read state and message membership/lifetime
  → read recipient-owned PushManager subscriptions
  → atomic unique (notification_id, endpoint) delivery claim
  → VAPID-authenticated, aes128gcm-encrypted Web Push request
  → browser's existing push service → installed device's service worker
  → generic OS notification and same-origin URL
  → GAYZE conversation or notification inbox
  → owner-only database read acknowledgement → database unread count
```

If HTTP/provider delivery fails, **the notification row is not deleted**. If notification persistence itself fails, the source write rolls back rather than claiming a notification was durably created. HTTP dispatch is separately exception-isolated and never rolls back a successful source/notification transaction.

### Database additions (not applied)

`supabase/migrations/20261002100000_durable_notifications.sql` follows the existing base push and URL-fix migrations. The timestamp sorts after existing migration filenames; it is not evidence of any applied production migration.

Schema change is necessary: existing `notification_dispatch_log` is service-role-only, has no read state/content/destination, and cannot supply an authoritative user inbox. The new objects are namespaced to avoid guessing/reusing an unknown `notifications` table:

- `gayze_notifications`: recipient, actor, category, stable event key, safe destination, created/read/processed timestamps. Unique `(user_id, category, event_key)`. Users can **select only their own rows**, not insert/delete/edit content.
- `gayze_notification_deliveries`: service-only endpoint claims and accepted/failed/expired/invalid/unknown state. Deleting an expired subscription does not remove a claim or notification.
- Owner-only read RPC, authenticated connection-record RPC, service-only enqueue/eligibility/claim/drain RPCs, and scoped source/dispatch triggers.
- `gayze_notification_push_allowed` rechecks message membership, expiry and burn state before sending. The claim RPC rechecks this too.
- Gayze uses the current source's `from_user_id`, `to_user_id`, `intent_id` columns, not an invented gaze ID. Repeat Gayzes from the same actor to the same recipient for the same intent are intentionally one notification. Self-Gayzes do not notify.
- Message recipients come from `conversation_members`, excluding the sender; the sender must be a member. The trigger rejects sender spoofing and anonymous application-role writes.
- Legacy intent-expiry/safety sweeps still use `request_push_dispatch`, but that bridge now creates durable rows from database source data before HTTP dispatch. Connection notification creation now uses an authenticated RPC independently of Edge Function availability.

The migration fails if required base objects/columns are missing or a new table/function name collides. It refuses to replace an unowned same-name message trigger/bridge. Existing base migrations are not edited. **Inspect production base DDL/RLS and migration history first; execute the additive migration transactionally only after approval.** The existing migration that adds profile fields is not automatically repaired/applied by this work.

The generic `interests` event is separate from a `gazes` row. Its recipient/source schema and `submit_interest` function body remain absent; no guessed generic-interest trigger is installed. Connection creation still relies on the existing mutual-result client flow and its subsequent authenticated notification RPC; a crash between those operations remains a gap until the authoritative matching function can be updated transactionally.

## Sender API and security

Existing `supabase/config.toml` has `verify_jwt = false` because database dispatch uses a shared secret rather than a user JWT. **The function performs its own mandatory authentication.**

| Request | Authorization |
| --- | --- |
| `{ notificationId }` with `x-gayze-dispatch-secret` | Constant-time digest comparison with server secret; loads existing notification |
| `{ notificationId }` with `Authorization: Bearer …` | `auth.getUser(token)` verification; only the verified user's own notification |
| `{ action: 'connection', conversationId }` | Verified JWT; connection RPC executed as that user, which checks two-member membership and derives recipient |
| `{ action: 'test' }` | Verified JWT **and server-controlled `app_metadata.role === 'admin'`**; self-targeted, one record per user/minute |

No HTTP-supplied recipient, message text, title or URL is trusted. Old raw `{ event: ... }` sender requests are rejected; the updated SQL bridge converts supported legacy events to records. Production rollout must coordinate this API change with the database migration, not deploy just the sender or frontend.

Additional protections:

- Bounded 8 KiB body; POST only; explicit CORS origin allowlist.
- Safe same-origin destinations generated from database rows.
- No plaintext message body in the server payload; generic Gayze/message copy protects lock-screen privacy.
- Gayze uses the existing `intent_activity` preference (labelled “Gayzes” in the UI); no speculative preference column is introduced.
- Fail-closed preference lookup; disabled push/categories do not remove notification records.
- Endpoint URL allowlist for the existing browser push services; no arbitrary URLs, IPs, credentials or custom ports (SSRF protection).
- P-256 subscription public-key and 16-byte auth-secret validation before network access. Invalid subscriptions are pruned; 404/410 subscriptions are pruned with owner/ID/endpoint scope. Other failures do not indiscriminately delete subscriptions.
- VAPID key-pair validation before delivery claims. Invalid/missing server configuration leaves records pending.
- Five-second provider timeout, five-minute provider TTL, stable notification tag/topic.
- Provider/SDK exceptions are not returned or logged with their endpoint/token contents. `ECE_KEYLOG=1` prevents startup.

### Honest delivery semantics

The unique claim is taken **before** calling the provider. Concurrent invocations cannot issue a second request to the same endpoint for that record. Claims survive failure, crash and expired-subscription deletion.

This is **at-most-once application delivery attempt**, not distributed exactly-once delivery. An accepted provider request whose response is lost cannot safely be retried without risking another alert. Therefore failed/unknown/attempted claims are not automatically resent. A crash after claiming but before sending can also lose a push attempt. In both cases the authoritative unread notification remains available.

`gayze_drain_notifications()` retries unprocessed, unread records from the last 24 hours, at most 100 per call, using the existing HTTP bridge. It can recover a missing/failed trigger-to-function dispatch or missing server configuration **before a delivery claim exists**. It does not resend claimed endpoints. Records older than 24 hours remain in the inbox without historical OS alert floods. Newly subscribing devices do not automatically receive the entire historical inbox.

The v4 worker serializes push events and keeps a bounded cache of 2,500 opaque **successful-display** notification-ID receipts across worker restarts. The receipt is written **after** `showNotification` resolves; a failed display remains retryable. It contains no message text, endpoint, actor, JWT or subscription key. The new receipt namespace does not trust the former receipt-before-display records.

Backend delivery claims and device presentation are different mechanisms. **Every received push still calls `showNotification`**, including a replay with a receipt. The stable notification-ID tag replaces the same OS record; replay is quiet (`silent: true`, `renotify: false`) and does not initiate a second foreground toast handshake. Existing OS tag evidence also helps after receipt-storage failure. Bounded/evicted state and OS behavior prevent an absolute exactly-once guarantee; `silent` is not a promise that no system banner appears.

Clicks prefer the stable conversation UUID carried for both message and connection notifications. Existing same-origin windows are focused and asked to acknowledge routing; failing/unready pages fall back to bounded URL navigation and then `openWindow`. Cold URLs and signed-out pending paths retain the room and notification IDs. Actual installed-PWA launch behavior remains a physical-device release gate.

The Enable action requests permission synchronously before any auth, worker-readiness or lock await. Already-granted/denied permission is not repeatedly requested; concurrent Enable calls share a flight. Subscription and persistence wait for an active service worker, with a retryable readiness timeout. VAPID key encoding is checked before enrollment/permission mutation. Server preference-write failure is not reported as full notification success.

Authenticated launch, visibility/pageshow, focus and online events reconcile the browser's current subscription. Mutations are serialized, with Web Locks coordinating tabs where available, and guarded against stale accounts/generations. An opaque local `{userId,rowId}` pointer must resolve to a row under the current user's RLS before it can authorize automatic recovery of a lost/rotated endpoint; it is not authority by itself. Healthy reconciliation is a no-op; replacement persistence precedes old-row cleanup, with interrupted cleanup retried without revoking a successful replacement. Missing ownership proof, pruned old rows, changed VAPID keys or disabled preferences require explicit Enable rather than silently claiming another account's endpoint. Recovery does not prompt for permission. Sign-out/opt-out invalidates pending work and prevents automatic re-enrollment.

Apple endpoints accept HTTPS subdomains of `push.apple.com`, including nested subdomains, while retaining scheme, userinfo, port, fragment and provider-host protections. This does not establish that a physical iPhone accepted or displayed a notification.

## Client list, unread state and destinations

- `notificationInbox.ts` uses the existing Supabase recovery owner, membership/session guards, RLS-scoped pagination and exact database unread counts. It catches up after lifecycle/network changes; failed reads retain the previous display and show unavailable/reconnecting.
- The notification modal now contains the actual database list, independently of push opt-in/preferences. No browser-local increment is the source of truth.
- Navigation exposes notification unread state separately from message unread state. The PWA badge is refreshed from database unread count while the app is active. Background payload badge counts are snapshots and may be stale until foreground reconciliation.
- Viewing a connected, key-ready conversation acknowledges that conversation's message notifications through the owner-scoped RPC. Merely switching tabs does not clear all messages. Clicking a list entry acknowledges that record, then routes.
- Message → `/messages/<conversation-id>?notification=<notification-id>`.
- Gayze → `/notifications?notification=<notification-id>`, the existing notification-centre destination.
- Same-origin destinations survive an OAuth/login reload using session storage. Cross-origin/auth-callback destinations are rejected; read acknowledgements remain account-scoped.
- Worker push still creates a user-visible OS notification, including foreground delivery (important for user-visible-only Web Push/iOS). The focused app may acknowledge a canonical message ID within a bounded MessageChannel handshake: in that case the OS record is `silent: true`, and account-scoped dedup allows at most one in-app toast (none when viewing that room). Background, old or unresponsive clients fall back to normal OS presentation. Actual OS banner behavior remains device-dependent.
- The app's generic incoming-message toast now works independently of native push configuration/permission and before decryption finishes. Both paths use DB-derived message/conversation/recipient IDs, not plaintext. `PUSH_RECEIVED` acknowledges an already-presented native alert so foreground catch-up does not repeat its toast. Mixed old/new deployed versions lack full correlation; bounded receipts/timeouts are not an exactly-once guarantee. See [the focused chat audit](CHAT_AUDIT_2026-10-01.md) for implementation, tests and deployment/device limits.
- Discover/Right Now Gayzes use selected stable user IDs, not display-name matching; only confirmed successful sends change to “Gazed.”

## Exact production configuration still required

**Do not deploy as part of this task. These are operator requirements for a later approved release.**

1. Review actual `messages`, `conversation_members`, `gazes`, `intents`, `safety_checkins`, push tables and matching RPC DDL/RLS. Confirm source-column types, caller ownership, message membership and block/privacy rules. The local fixture is not the production schema. Review existing notification triggers/webhooks for duplicate legacy dispatch paths.
2. Confirm existing base push and canonical URL migrations are applied. Review/apply the new durable-notification migration transactionally in staging first. Verify its tables/RPC grants and publication membership. Coordinate sender/migration/frontend compatibility; do not replay old migrations out of order over the new bridge.
3. Supabase Edge Function secrets/environment:
   - `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`; `SUPABASE_ANON_KEY` for legacy authenticated connection action (normally platform-provided).
   - **Existing** `VAPID_PUBLIC_KEY` and matching `VAPID_PRIVATE_KEY`; `VAPID_SUBJECT` (`mailto:` or HTTPS contact).
   - `PUSH_DISPATCH_SECRET`: sufficiently random server-only value.
   - `PUSH_ALLOWED_ORIGINS`: comma-separated exact approved origins; default `https://gayze.co.uk`. Add a staging origin explicitly if needed, not `*`.
   - Keep `ECE_KEYLOG` unset or `0`. Do not enable cryptographic debug logs.
4. Vault secrets:
   - `gayze_functions_url`: existing project URL (the owned bridge normalizes `/functions/v1/send-push`).
   - `gayze_push_dispatch_secret`: exactly matches `PUSH_DISPATCH_SECRET`.
5. Build-time public client variables:
   - `VITE_SUPABASE_URL`, `VITE_SUPABASE_PUBLISHABLE_KEY` for the intended project.
   - `VITE_VAPID_PUBLIC_KEY` matching the **existing** server public key. Do not rotate/recreate the production pair casually: subscriptions are bound to it.
   - No service role, VAPID private key, dispatch secret or TURN private credential in any `VITE_*` value. Build guards reject common private-key variables.
6. Approve a scheduler for `select public.gayze_drain_notifications()` (e.g. once/minute via existing Supabase pg_cron). Confirm the existing expiry/safety schedules too. Scheduling is **not** automatically installed or executed by this work.
7. Confirm HTTPS/root SW scope, existing Cloudflare `_headers`/SPA fallback and SW v3 update on installed clients. No Cloudflare/Vercel hosting change is needed.
8. For the test-push button, assign the operator role through trusted Supabase administration. The local UI admin flag is not server authorization.

No production VAPID pair, Vault value, deployment setting or device subscription was accessed or changed. Do not send private credentials in chat.

## Validation

- `npm run test:notifications`: actual checked-in migrations in isolated PGlite, real handler with mocked verified-auth/provider boundaries, ownership/unread/duplicates/failures, real-source browser/worker/UI registration/deep-link tests, and documented TURN contract tests.
- `npm run check:push-server`: actual Deno typecheck (separate from browser TypeScript).
- `npm run test:push-hardening`: real-source worker/enrollment regressions for display receipts, visible tagged replay, routing fallbacks, direct permission, Apple host validation, authenticated recovery, interrupted cleanup and account/tab concurrency.
- `npm run test:push-crypto`: real Web Push library encrypt/decrypt round-trip and ES256 VAPID signature/audience validation with generated test keys; no network permission/provider request.
- Existing `test:push-sw`, encryption and recovery suites remain intact.

Provider acceptance on a real subscription, APNs/OS delivery, physical iOS foreground/background behavior, Focus settings, permission gestures and lock-screen/cold-start taps require staging credentials and devices. **A passing local test is not evidence of production delivery.**

Current local hardening evidence and remaining release gates: [iPhone push hardening report](IPHONE_PUSH_HARDENING_REPORT_2026-10-01.md). **Release remains HOLD; no physical iPhone lock-screen delivery has been verified.**
