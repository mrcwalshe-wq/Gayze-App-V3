# GAYZE — release-readiness report

> **Controlled release-candidate follow-up (2026-10-01):** See [RELEASE_CANDIDATE_REPORT.md](RELEASE_CANDIDATE_REPORT.md) for the current inventory, warm-history/cache and drawer fixes, migration hardening, latest tests and open release gates. No rollout is authorized.

> **Follow-up 2026-10-01:** [Chat audit and validation](CHAT_AUDIT_2026-10-01.md) supersedes the performance/foreground-toast descriptions and records the latest tests. This report preserves the earlier phase; its production gates remain open.

**Date:** 2026-09-30  
**Branch:** `arena/01a0f3ee-gayze-app-v3`  
**HEAD:** `1190d6ab220b2658678b66136f95a21810b2f306`

## 1. Decision

**NOT READY FOR PRODUCTION RELEASE YET.** The missing push implementation and durable inbox are now implemented and locally validated. The remaining gates require an approved database/function rollout, production configuration verification, the deployed TURN function source and real device/network tests.

**No deployment, database migration application, push, commit or branch switch occurred. Patch 1 remains unapplied.** The focused chat recovery work remains in the working tree. GitHub operations in this phase were read-only source/configuration investigation.

| Question | Answer |
| --- | --- |
| Is the checked-in push sender still empty? | **No.** The worktree contains a secure authenticated sender using the existing Web Push/VAPID stack. HEAD remains unchanged. |
| Is there a real notification record/list/unread implementation? | **Yes, in source and isolated local tests.** A new, unapplied migration creates the database inbox, source triggers, read RPCs and delivery claims; the client reads them. |
| Is the push pipeline complete? | **For new Gayze/message events, the source-to-provider/device-handler implementation is connected and locally tested. It is not deployed or production-certified.** See event limits and delivery semantics below. |
| Is production push delivery verified? | **No.** No real provider request, production key/subscription verification, OS delivery or physical notification tap was performed. |
| Can production TURN expiry be certified? | **No.** No deployed `webrtc-ice-servers` source/TTL/auth configuration was found; client contract tests pass but cannot prove server behavior. |
| Are the chat regression checks passing? | **Yes: 40/40 local tests.** Actual physical iOS suspension/network transitions remain unverified. |
| Does the whole legacy test command pass? | **No.** Five pre-existing suites retain the same baseline failures; no malformed fixture was changed to manufacture green. |

## 2. Push technology and source investigation

The actual configured technology is standards-based **Web Push (PushManager + VAPID + service worker)**, with `web-push@3.6.7` running in a Supabase Edge Function. Browser-selected Google/Mozilla/Apple/Windows push endpoints are not a new application provider. No native APNs private-key or FCM server-key integration was introduced. Cloudflare still hosts the app; Supabase still hosts database/Realtime/function responsibilities.

At HEAD the sender was one newline. Read-only branch inspection recovered an earlier sender on `feat/notification-reminder`, blob `03a7d2df0ec24851113e3de3d3944ca1dee113fd` (also present on earlier project branches). It confirmed the same VAPID/Web Push and dispatch-secret conventions, but did not contain a durable user notification inbox or per-endpoint message/Gayze delivery claims. It was inspected, not merged or copied as a wholesale solution. Patch 1's unsafe sender was not used.

Existing source was inspected before the schema addition: `submitGaze`, message INSERTs, conversation membership, notification preferences/subscriptions, the dispatch ledger, push bridge/message trigger/sweeps, client PushManager registration, service-worker click handler, app notification routing and notification UI. **The existing ledger could not meet the database-authoritative list/unread requirement**: it is service-only and has no read state/destination. That demonstrated the need for an additive inbox migration.

## 3. What is genuinely implemented

### Event → durable record

- New `gayze_notifications` records are created in the same transaction as new message/Gayze rows. Message recipients are derived from actual membership, excluding the sender; sender membership/identity and anonymous application-role writes are checked.
- Gayze uses the actual source columns already written by the client: `from_user_id`, `to_user_id`, `intent_id`. A repeated actor/recipient/intent Gayze is intentionally idempotent. No invented gaze primary-key contract is required.
- HTTP/provider failure cannot remove or roll back the notification. Notification persistence failure itself aborts the source transaction, instead of falsely claiming durable creation. This distinction is intentional.
- The existing owned HTTP bridge is retained with canonical URL normalization. Legacy intent-expiry/safety sweep events now create durable rows from database source data before asking for push.
- Connection notification creation uses an authenticated membership-checking RPC, separate from Edge Function availability.

### Secure sender → existing provider

- Shared-secret internal dispatch, verified user JWT/own-record dispatch, membership-authorized connection action and server-admin-only self-test action.
- Loads a persisted notification; ignores caller-supplied recipient, title, content and destination. No plaintext message enters a push payload.
- Enforces preferences and rechecks unread state, message membership, expiry and burn state. Invalid/missing configuration fails closed before delivery claims.
- Validates the VAPID pair, subscription P-256/auth key shape and approved HTTPS push-service endpoint. Arbitrary endpoints, ports, IPs or embedded credentials are rejected (SSRF protection).
- Removes invalid subscriptions and provider 404/410 endpoints with owner/ID/endpoint scope. Notification records and delivery claims remain intact.
- No private credential is returned to the browser or placed in a `VITE_*` setting. Provider errors are sanitized; crypto key logging prevents function startup. Build guards now also reject common public service-role/private-push-secret variables.

### Database list/unread → device/click/destination

- The existing notification modal displays the actual database inbox with persisted read state. Navigation distinguishes total notification unread from message unread. Browser-local increments/tab-wide clearing are no longer authoritative.
- The inbox uses the existing Supabase recovery owner, scoped queries, pagination, exact database counts and lifecycle catch-up. Errors retain the last display and show unavailable/reconnecting rather than inventing a successful empty inbox.
- Owner-only RPCs acknowledge a clicked notification or a viewed connected/key-ready conversation. Profile/message navigation badges and active-app PWA badging derive from database counts. Background badge values are snapshots, reconciled on foreground.
- In this phase the separate message toast was removed in favor of OS push. **Superseded on 2026-10-01:** the chat audit found the resulting foreground gap and restored an independent, deduplicated toast plus a bounded worker acknowledgement/quiet-OS-record protocol. See the follow-up report; native delivery remains unverified.
- Gayze → notification centre. Message → correct conversation. Safe same-origin click paths contain a stable notification ID and survive login/OAuth reload via session storage; account-scoped acknowledgement prevents cross-user read mutation.
- Stable selected user IDs replaced name-based Gayze recipient lookup. Two people called “Alex” no longer risk a send to the first matching name. Failed sends do not change the UI to “Gazed.”

### Duplicate/failure semantics — no misleading exactly-once claim

A unique `(notification_id, endpoint)` claim is taken before the provider call. Concurrent/replayed invocations cannot create another application-level send attempt for that endpoint. Claims survive subscription pruning and notification delivery errors.

**This deliberately favors at-most-once application attempts over retrying ambiguous delivery.** A timeout or crash after claiming can lose an OS push, and an accepted provider request whose ACK was lost cannot be safely resent without risking a duplicate. Failed/unknown/attempted claims are not automatically retried. The durable unread notification remains in the database.

A service-only drain retries missing/failed pre-claim HTTP dispatch for recent unread records. Its scheduler has **not** been installed. The worker additionally serializes push events and keeps 2,500 opaque receipt IDs across restarts; no message text, actor, endpoint or credential is cached. Provider/OS duplication, storage eviction and user-visible-only policies prevent an absolute exactly-once device guarantee.

### Event scope still not fabricated

- New Gayze and message events have database triggers and locally tested persistence/dispatch.
- Intent-expiry/safety use the existing verified-column sweep contract; actual production schedules/status contracts still need review.
- Connection records still follow the existing mutual-result client flow and subsequent authenticated RPC. A crash between the matching RPC and notification RPC remains a gap until the absent authoritative matching implementation can be updated transactionally.
- Generic `interests` notifications are not equated with `gazes`. The recipient schema and `submit_interest` function body are absent, so no speculative generic-interest trigger was added. The existing incoming-interest UI subscription remains a separate pre-existing limitation.
- Existing historical source rows are not automatically backfilled/replayed into OS notifications. The migration applies to subsequent events.

## 4. Pending schema review and production configuration

`20261002100000_durable_notifications.sql` is **new and unapplied**. Its filename sorts after existing repository migration filenames; it does not indicate a production application date.

It creates namespaced inbox/delivery objects, not a guessed replacement for an unknown existing `notifications` table. RLS is enabled/forced; authenticated users can select only their own inbox and cannot forge/edit/delete notification content or access delivery endpoints. Read RPCs are recipient-scoped. Service-only helpers are explicitly revoked from public/anon/authenticated roles. The migration refuses missing base prerequisites and unknown object/trigger collisions. Existing base migrations were not edited.

Before any approved rollout:

1. **Inspect actual base DDL/RLS and installed triggers:** messages, membership, gazes, preferences/subscriptions, intent/safety tables and matching RPC. Confirm UUID/type contracts, sender/recipient ownership, privacy/block rules, source triggers, publication and migration history. The local fixture is not evidence of production-policy equivalence.
2. Review/apply the additive migration transactionally in staging. Coordinate the new record-ID sender contract with the SQL bridge and frontend. Do not deploy just one part or replay an old bridge migration over the new one.
3. Verify Supabase function environment: `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `SUPABASE_ANON_KEY` for the compatibility connection action, existing `VAPID_PUBLIC_KEY`, matching `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT`, `PUSH_DISPATCH_SECRET`, and exact `PUSH_ALLOWED_ORIGINS` (default `https://gayze.co.uk`). Keep `ECE_KEYLOG` unset/0.
4. Verify Vault `gayze_functions_url` and `gayze_push_dispatch_secret`; the latter must match the Edge Function dispatch secret. Existing `verify_jwt = false` permits internal dispatch; the handler's mandatory authentication is therefore critical.
5. Build using public `VITE_SUPABASE_URL`, `VITE_SUPABASE_PUBLISHABLE_KEY` and **matching existing** `VITE_VAPID_PUBLIC_KEY`. Do not casually rotate the existing VAPID pair: subscriptions are bound to it.
6. Approve/schedule `gayze_drain_notifications()` (e.g. once/minute) and verify existing intent/safety cron schedules. No scheduling operation ran here.
7. Validate installed clients update to worker v3, retain root scope and use the existing Cloudflare headers/SPA fallback. Authorize the test user through server-controlled `app_metadata.role = 'admin'`; a local browser flag is not authorization.

Presence-only checks confirmed that Supabase management/service-role, VAPID, dispatch-secret and Cloudflare API-token variables are not present in this process environment. No production credential was read, stored, requested in chat or changed. GitHub Actions variable/secret metadata access was denied with HTTP 403, so those settings remain unverified, not assumed absent. Full operator instructions and delivery trade-offs: [PUSH_NOTIFICATIONS.md](PUSH_NOTIFICATIONS.md).

## 5. TURN blocker: investigated, not fabricated

No `webrtc-ice-servers` source/configuration was found in current tracked source, Supabase/Cloudflare/workflow files, available history or any of the ten branches returned by the read-only GitHub repository API. The recovered push sender is unrelated. GitHub Actions metadata was inaccessible; no Supabase/Cloudflare production management credentials were available to verify deployed function settings.

The client continues using the existing authenticated Supabase endpoint and Cloudflare TURN; STUN fallback remains Cloudflare/Google. No coturn or replacement server was introduced. Existing caller/callee ICE restart renegotiation remains intact.

The supported client contract was verified locally for epoch seconds/milliseconds, numeric strings, ISO, `expires_at`, `ttlSeconds` and `ttl`; early refresh; coalescing; no-TTL non-reuse; cancellation; malformed/expired responses; provider metadata stripping; restart offer/answer; candidate generations and stale-call isolation. Relay username/credential values now also have runtime string validation.

**Missing production evidence:** actual function source/version, JWT/authorization and deployed `verify_jwt`, Cloudflare credential location/permissions/key identifier, requested TTL, response expiry fields/units, provider/function caching, clock behavior, actual relay URLs/transports and real expiry/network tests. No environment variable names for that missing function have been invented.

No-TTL responses are refetched across negotiations and revalidated every 30 seconds. That is **not proof of refresh before an unknown provider expiry**. Production TURN expiry remains a release gate. Details: [TURN_CREDENTIAL_CONTRACT.md](TURN_CREDENTIAL_CONTRACT.md).

## 6. Final chat regression matrix

All 40 existing focused recovery tests were rerun successfully after the application changes. These are deterministic, real-source mocked-boundary and jsdom tests, not production device runs.

| Requested scenario | Local evidence |
| --- | --- |
| Initial connection / normal delivery | Subscription plus REST reconciliation and stable merge tests PASS |
| Navigation away / return | Shared-owner cleanup/remount, stale same-topic isolation, catch-up PASS |
| Background / foreground | Visibility/pageshow park/recreate, missed rows, missed online event PASS |
| Expired auth/session | Refresh-before-join, missing/invalid refresh, sign-out and direct account-switch invalidation PASS |
| Realtime timeout / error / closed | Status variants, SDK rejoin cancellation, bounded exponential retries PASS |
| Network interruption | Online/offline recovery, join deadline and shared transport repair PASS |
| Stale callbacks | Generation/abort isolation, stalled consumer release, stale peer/hangup guards PASS |
| Duplicate subscriptions | Shared stream ownership and independent observer/cleanup behavior PASS |
| Missed persisted messages | Full stable keyset scans, equal timestamps/server caps/backdated commits PASS |
| Duplicate messages | Stable IDs, replay/version dedup, monotonic burn merge PASS |
| Failed send / retry | Retained draft/UUID, scoped receipt, no ciphertext overwrite PASS |
| Presence recovery | Hidden park/foreground re-track and cleanup PASS |
| Incognito/ghost | Tracking disabled, matching persisted-profile gate, saved ghost profile preserved PASS |

The notification inbox additionally uses the same recovery implementation and has a real-source test for initial fetch, new records, database counts and late-callback rejection after stopping. **No claim is made that a real iPhone background/network incident was reproduced or resolved physically.**

## 7. Notification regression and security evidence

`npm run test:notifications` reports **28/28 PASS** (21 TypeScript runner cases including nested SQL/security tests and three TURN-contract tests, plus seven browser/worker/UI tests). `npm run test:push-crypto` reports **1/1 PASS**.

| Requested scenario | Verified locally |
| --- | --- |
| Gayze received / record | Actual current-client column contract → new trigger → one recipient record/dispatch; repeated/self/spoof/anonymous cases |
| Notification list / unread | Own-data RLS, immutable content, exact DB counts, owner-only read ACK, rendered list/nav counts; clicks alone do not locally fake a decrement |
| Message notification | Membership-derived recipient, correct conversation path, no ciphertext payload, expired/burned/removed-member suppression |
| Registration | Real client PushManager flow at mocked browser boundary; authenticated owner persisted, unowned endpoint revoked/replaced |
| Sender | Actual handler; verified-auth dependency boundary, secret/JWT/ownership/admin/origin/body limits, no caller-selected recipient/content |
| Duplicate prevention | Concurrent/replayed invocations → one provider call per record/endpoint; worker replay suppression across restart |
| Push failure | pg_net exception preserves source/notification; 410 prunes only the expired endpoint; malformed keys pruned; ambiguous timeout retains record and is not resent; missing config leaves pending |
| Click / deep link | Real worker warm/cold routing; Gayze centre and message conversation; off-origin rejection; login-destination preservation |
| Encryption / credentials | Real `web-push` aes128gcm encrypt/decrypt and ES256 VAPID signature/audience with ephemeral local keys; no network permission/provider request |

The PGlite test executes the actual existing base push/URL migrations and the new migration, removing only unsupported extension-install statements. Auth roles, source schema and pg_net/Vault are isolated test fixtures. Provider transmission and Supabase JWT verification are mocked boundaries. This proves local contracts, **not deployed policy equivalence, provider acceptance or OS delivery**.

## 8. Validation results and unchanged failures

| Command/check | Result |
| --- | --- |
| `npm run lint` | PASS — existing alias is `tsc --noEmit`, not ESLint |
| `npm run typecheck` | PASS |
| `npm run lint:recovery` | PASS — scoped actual ESLint includes notification UI/services, server and worker |
| `npm run check:push-server` | PASS — Deno 2.9.6 checks the actual Edge Function separately |
| `npm run test:recovery` | **40/40 PASS** |
| `npm run test:notifications` | **28/28 PASS** |
| `npm run test:push-crypto` | **1/1 PASS** |
| `test:push-sw`, `test:e2ee`, `test:discovery`, `test:interaction` | PASS |
| `npm run build` | PASS — Vite 8.3.1; 2,018 modules |
| `wrangler@4.145.0 deploy --dry-run` | PASS — 34 assets, 0.33 KiB generated worker, no bindings; **no deployment** |
| Public secret build-rejection checks | VAPID private, Supabase service-role and TURN credential variables each rejected; synthetic sentinel absent from logs/bundle |
| `git diff --check` | PASS |

Initial new-test harness issues (Deno env permission and decrypt helper argument) were corrected and rerun; they are not unresolved failures. Babel's parser allows forward exports in the existing Right Now component; browser TypeScript still validates actual exports. No runtime package/provider was substituted. Node 22.22.3 still emits the existing ZXing Node >=24 engine warning; build/deploy workflow Node alignment remains an operator follow-up.

The **same five legacy failures** were rerun:

- `test:push-sql`: `scripts/push-tests/sql.test.mjs:78`, unexpected `)`.
- `test:push-e2e`: `scripts/push-tests/e2e.test.mjs:252`, unexpected `)`.
- `test:inspect-script`: literal diff markers in pending SQL.
- `test:profile-migration`: `scripts/profile-tests/migration.test.mjs:70`, invalid assignment from diff text.
- `test:profile`: existing completion/nudge assertions fail, then `.click()` on undefined at line 342.

Those fixtures were not modified. New regression suites supplement, not replace, them. The aggregate legacy `npm test` remains blocked. No new failing validation was left unresolved.

## 9. Real iPhone/iOS PWA and production tests still required

- Install from Safari, user-gesture opt-in, permission denial/re-enable, subscription rotation, shared-device sign-out/account switch and existing VAPID-pair compatibility.
- Real provider acceptance and OS notifications: foreground, background, locked/suspended, offline return, Focus settings and multiple devices. Verify failure/expired endpoint behavior without deleting inbox records.
- Warm/cold notification taps, logged-out OAuth return, correct conversation membership, Gayze centre and database read/unread state after another device reads it.
- Worker update on an already-installed PWA, same-origin deep links on the Cloudflare domain, cache/manifest/header behavior and app badge reconciliation.
- Physical keyboard/input/nav/drawer safe-area geometry and accessibility. The prior Chromium download failed with TLS `ECONNRESET`; this phase used jsdom, not a physical/browser layout measurement.
- Actual chat navigation/background/network switching and real TURN relay-only calls, expiry during an active call, Wi-Fi/mobile transition and loss of signalling/SDP/ACK.
- History/inbox size, subscription fan-out and drain throughput under production-sized data. Both chat and notification catch-up currently favor full-history correctness over bandwidth.

## 10. Exact file inventory

### Changed in this blocker-resolution phase

**New files**

- `supabase/functions/send-push/handler.ts` — authenticated portable sender, ownership/preferences/claims, safe payloads and provider outcomes.
- `supabase/migrations/20261002100000_durable_notifications.sql` — unapplied additive inbox/delivery/RPC/trigger/dispatch migration.
- `src/services/notificationInbox.ts` — recovered database list/counts/read API.
- `scripts/notification-tests/pipeline.test.ts` — actual migrations + sender/security/provider-boundary tests.
- `scripts/notification-tests/client.test.mjs` — real worker/UI/registration/routing/inbox/Gayze-ID tests.
- `scripts/notification-tests/turn-contract.test.ts` — documented expiry/validation contract tests.
- `scripts/notification-tests/crypto.deno.ts` — real Web Push cryptographic round-trip/signature test.
- `docs/TURN_CREDENTIAL_CONTRACT.md` — investigation, verified client contract and missing server evidence.
- `docs/RELEASE_READINESS.md` — this report.

**Modified files**

- `supabase/functions/send-push/index.ts` — formerly empty; actual Supabase/Web Push adapters, runtime secret/key validation and server entry point.
- `supabase/functions/deno.json` — existing Supabase dependency pinned to the locally checked version; same Web Push library retained.
- `src/App.tsx` — DB inbox/unread wiring, read/click/account guards, login handoff and stable-ID Gayze routing.
- `src/components/NotificationsModal.tsx` — actual inbox/read/unread list beside existing preferences.
- `src/components/Navbar.tsx` — database notification unread indicator separate from message unread.
- `src/components/DiscoverView.tsx`, `src/components/RightNowView.tsx` — stable selected recipient IDs, one confirmed Gayze send path; no unrelated redesign.
- `src/services/notificationRouting.ts` — safe login destination preservation.
- `src/services/pushService.ts` — connection record RPC independent of push HTTP availability.
- `src/services/iceCredentials.ts` — stricter malformed runtime relay-credential rejection; provider unchanged.
- `public/service-worker.js` — Gayze copy/destination, notification ID, serialized/bounded replay protection, worker version v3.
- `vite.config.ts` — private push/service credential build guards in addition to TURN protection.
- `.env.example` — public/server configuration boundary and rollout references; no credential values added.
- `package.json` — additive notification/server/crypto validation commands and expanded lint scope.
- `eslint.recovery.config.mjs` — added affected notification/server/worker/Gayze files to actual lint coverage.
- `scripts/recovery-tests/load-module.mjs` — optional synthetic public environment injection for registration tests.
- `docs/PUSH_NOTIFICATIONS.md` — current architecture, security, delivery trade-offs and exact operator configuration.
- `docs/RECOVERY_IMPLEMENTATION_REPORT.md` — historical-phase notice pointing to this current report.

### Prior focused-recovery work preserved in the cumulative working tree

The earlier report details these files: `src/services/realtimeRecovery.ts`, `chatSubscriptions.ts`, `messageMerge.ts`, `iceCredentials.ts`, `supabaseService.ts`, `conversationRooms.ts`, `webrtcService.ts`; `src/components/ChatRoomView.tsx`; `src/App.tsx`; `src/types.ts`; `src/index.css`; `.env.example`; `vite.config.ts`; `package.json`/`package-lock.json`; `eslint.recovery.config.mjs`; and `scripts/recovery-tests/{recovery.test.ts,webrtc.test.mjs,ui.test.mjs,security.test.mjs,load-module.mjs}`. Package-lock's prior lint tooling changes remain; no existing locked runtime package was upgraded by this phase.

The prior review/reproducer `docs/PATCH_1_REVIEW.md` and `scripts/review-patch-1.mjs` remain. No prior malformed test, existing migration, Cloudflare workflow/routing/header file, approved logo or icon was changed in this phase. Build output/dependencies/validation caches are not source deliverables.

Patch SHA-256 is unchanged:

`c17b00ece307a9ff5da5339271c0ec3e7fb253fc7f7d3bcbe605e8dcc5b1540b`

**No commit. No push. No deployment. Patch 1 unapplied. Production gates above remain explicit.**
