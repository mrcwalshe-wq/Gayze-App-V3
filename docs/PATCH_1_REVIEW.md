# Patch 1 — architecture and recovery review

> **Implementation follow-up (2026-09-30):** This is the historical, pre-implementation review. See [RECOVERY_IMPLEMENTATION_REPORT.md](RECOVERY_IMPLEMENTATION_REPORT.md) for the subsequent focused working-tree changes and validation; patch 1 remains unapplied and nothing has been deployed.
>
> **Security correction:** The earlier claim below that the current push sender was authenticated and preference-aware was not supported by implementation evidence. `supabase/functions/send-push/index.ts` is one newline at both the reviewed HEAD and in the worktree. Client/SQL/docs describe a contract, but cannot prove the absent sender implements it. Server authentication, recipient authorization, preference enforcement and end-to-end delivery remain release blockers.

**Decision: DO NOT MERGE OR DEPLOY AS-IS.**

Reviewed on 2026-09-30 against application commit `1190d6ab220b2658678b66136f95a21810b2f306`. The submitted `patch 1` is in GitHub commit `acb97489` on main. Its SHA-256 is `c17b00ece307a9ff5da5339271c0ec3e7fb253fc7f7d3bcbe605e8dcc5b1540b`.

Scope: patch applicability, chat delivery/recovery, authentication and lifecycle, the complete checked-in TURN/STUN/WebRTC configuration, Cloudflare deployment configuration, and related push integration risks. This is not certification of every unrelated UI, album or database change in this 102-file patch.

**The patch has not been applied. No application code, providers, credentials, migrations, production resources or deployment settings were changed. Chat recovery has NOT been fixed in this review.** Review evidence and a repeatable defect reproducer were added instead. The submission is not a safe base for implementing the requested fix without first reconciling it with current main.

## Blocking findings

References to proposed files below mean their contents inside `patch 1`, not installed application files. Patch line numbers identify the corresponding diff section.

### 1. P1 — the proposed manager does not manage chat

- Proposed `src/services/supabaseService.ts`, patch line 28204, still implements both `subscribeToConversationMessages` and `subscribeToAllConversationMessages` with direct `supabase.channel(...).subscribe(...)` calls.
- Neither wrapper imports or calls `acquireChannel`. The manager's only production-code importer in the patch is `albumService.ts`; it does not repair chat.
- Proposed `src/App.tsx`, patch line 10441, reports `CHANNEL_ERROR` / `TIMED_OUT` through “Live chat connection lost — retrying…” but does not initiate recovery or react to successful rejoin with a history catch-up.
- `resubscribeAll()` has no application caller. There is no app wiring to its aggregate connection status either.

**Impact:** the advertised chat recovery layer is disconnected from the affected feature. Passing isolated manager ref-count tests cannot demonstrate chat reconnect behavior.

**Required correction:** wire a tested recovery owner into both message subscriptions, with live-session validation, lifecycle recovery and history reconciliation. Keep SDK socket recovery and application channel/history recovery distinct.

### 2. P1 — channel recreation races and retained retry timers can break a recovered connection

Proposed `realtimeManager.ts:141–188`, patch line 27526:

- `removeChannel(stale)` is not awaited before acquiring the same topic again.
- Subscription callbacks have no channel-generation identity check. A delayed `CLOSED` or error from the retired channel can mark the replacement unhealthy and schedule another rebuild.
- `SUBSCRIBED` resets the attempt count but does not clear an already scheduled retry. SDK recovery can therefore succeed, then be torn down by the manager's old timer.
- The locked Supabase Realtime SDK's `channel(topic)` returns an existing same-topic channel if it is still registered. The patch's comment that every call necessarily creates a fresh channel is not valid for this installed SDK. Its fake client does not model this behavior.

**Evidence:** two isolated scenarios reproduce a healthy channel becoming `reconnecting`, and a successful subscription being torn down by a pending retry. The unawaited same-topic SDK reuse is an additional source-inspected risk.

**Required correction:** serialize teardown/recreation, guard callbacks by generation, cancel retries on success, and coordinate with SDK retries rather than allowing two independent retry loops to race.

### 3. P1 — shared-channel consumers lose messages and status updates

Proposed `realtimeManager.ts:217–274`:

- A second acquire ignores its builder, so its own message callback is never registered.
- Releasing the first consumer leaves that first consumer's row callback attached while another handle owns the channel.
- Any handle's `release()` clears **all** status listeners, including listeners belonging to other live handles.

**Evidence:** the reproducer verifies both dropped delivery to a second consumer and loss of that consumer's health updates after another handle releases.

**Required correction:** separate shared channel bindings from per-consumer dispatch and status listeners. Remove only the releasing consumer's listeners. Reference counting alone is not event fan-out.

### 4. P1 — foreground recovery can stay parked indefinitely

Proposed `realtimeManager.ts:65–103`:

- Foreground uses cached `networkOnline`, not a fresh `navigator.onLine` reading. If an online event is missed while suspended, visibility recovery returns without trying.
- Foreground recovery excludes `connecting` channels, including a join stalled during suspension.
- There is no `pageshow`/bfcache recovery or Network Information API change hook where supported.
- No recovery deadline handles a join that never emits a terminal status.

**Evidence:** simulated missed-online and stalled-connecting sequences both remain unrecovered after visibility and pageshow events. These are deterministic lifecycle simulations, not real iOS runs.

**Required correction:** coalesced foreground/pageshow/network recovery, a fresh online hint, bounded attempt deadlines, and cleanup of watchers on disposal. Browser online status is a hint, not proof of connectivity.

### 5. P1 — the patch cannot be applied safely to current main

`git apply --check 'patch 1'` exits 1. The submission contains 102 file changes (27,618 insertions, 4,172 deletions), including older-base hunks, files now already present, deleted files no longer present, and unusable binary patch entries. Examples include `App.tsx`, `package.json`, existing profile/push files and icon binaries.

The proposed resulting WebRTC blob is `92f6990…`, **identical to the current `src/services/webrtcService.ts`**. Its apparent TURN/call changes are already in this checkout, not new fixes for the current failure.

The proposed package script replaces the test command with `vitest run`; this would omit the current `scripts/**` regression suites unless they are explicitly retained.

**Required correction:** regenerate a small diff against current main. Do not force-apply, overwrite files, or use documentation as evidence that runtime changes exist.

### 6. P1 — push migrations conflict in either application order

Proposed `20260928160000_push_subscriptions.sql`, patch line 31684, claims the existing `public.push_subscriptions` table but expects a different schema (`disabled_at`, `failure_count`, `last_seen_at`) and overwrites its ownership comment.

- Fresh filename-order application: the patch creates the table first; existing `20260929120000_push_notifications.sql` then refuses to reuse it because the `gayze-push:` ownership marker is absent.
- Existing installation: `CREATE TABLE IF NOT EXISTS` does not add missing columns; the patch's index on `disabled_at` fails.

**Evidence:** both failures reproduced using the actual submitted/current table DDL and ownership preflight in PGlite. This tests the conflict, not the entire production schema.

**Required correction:** preserve the existing push subsystem and write an explicit forward migration if any new fields are genuinely required. Do not apply the older-dated migrations to production wholesale.

### 7. P1 — replacing send-push removes authentication and changes its contract

Proposed `supabase/functions/send-push/index.ts`, patch line 29419:

- Accepts POST bodies with a message ID and then uses service-role access, without validating an incoming user JWT or the existing dispatch secret.
- The repository's function configuration has `verify_jwt = false`; therefore gateway authentication does not compensate for this omission.
- Looking up recipients server-side does not authorize the caller. A caller who knows a valid message ID could repeatedly request notifications for it; no dispatch dedupe is present in this handler.
- It expects `{ type: 'INSERT', record: ... }`, unlike the current trigger's event payload. Existing dispatches would be ignored rather than delivered.
- It does not preserve the current notification-preferences/dispatch-log flow. The new worker is also registered at `/gayze-sw.js` rather than the current `/service-worker.js`, without integration with the current routing/cache/headers contract.

**Required correction:** preserve the existing client/SQL push contracts, but recover and audit the actual deployed sender before asserting authenticated, preference-aware delivery: the checked-in sender is empty. Any deliberate webhook contract change needs a compatible migration and security/regression tests, separately from chat reconnect work.

### 8. P1 — TURN, lifecycle and idempotency claims do not match the implementation

- New `20260928140000_call_signalling.sql`, patch line 30662, introduces a **coturn REST HMAC** credential RPC backed by `app_secrets`. The running client still invokes the existing **Cloudflare TURN** Edge Function. It never calls this RPC or uses the new persisted call-signalling tables.
- Documentation says `VITE_TURN_*` was removed, credentials refresh, and pagehide no longer tears down calls. The submitted WebRTC code still reads those variables, caches ICE servers indefinitely, and unconditionally calls cleanup on pagehide.
- The new security test explicitly rejects `VITE_TURN_*`, contradicting the WebRTC code it is submitted alongside. The documented zero-match/pass claim cannot describe this submitted source.
- The new messaging migration adds nullable `client_id` with a partial unique index. The submitted sender does not send `client_id`, so this does not make ambiguous write retries idempotent.

**Required correction:** preserve the Cloudflare provider and authenticated Edge Function contract; do not introduce an unused alternate credential architecture. Make documentation/test claims follow actual integration and observed results.

## What causes the reported chat warning?

### Established from current code

`src/App.tsx:1653–1663` emits the exact warning from the **Supabase Postgres Changes subscription** when it receives `CHANNEL_ERROR` or `TIMED_OUT`. The equivalent global stream emits a notifications-disconnected toast. Text chat uses encrypted database writes plus Supabase Realtime and REST reads; it does **not** send messages through an `RTCPeerConnection` or RTC data channel.

Consequently, the warning is evidence of a reported **Realtime channel failure**, not evidence of a TURN/ICE failure. Its underlying cause could still be suspended browser execution, transport loss, or an authorization/join failure.

There are additional application recovery gaps:

1. There is no chat-specific visibility/pageshow/network-change recovery. SDK reconnect and the active-room three-second REST poll are the existing mechanisms.
2. Initial `loadConversationMessages` is awaited **before** creating the subscription and poll, outside the key-resolution catch. If that read fails, `void hydrate()` rejects and neither recovery path starts. The proposed patch retains this failure mode.
3. A three-second async interval can overlap itself and download/decrypt the entire available history repeatedly; it is not paginated, single-flight catch-up. Supabase's server row limit can also truncate a large history.
4. Subscription success does not explicitly trigger catch-up. Rejoining Postgres Changes does not itself guarantee replay of missed database events.
5. UI rows are deduplicated by server message ID, but global unread/toast side effects are outside that dedupe decision. Duplicate delivery can still increment unread and notify twice. Asynchronous decryption can append out of chronological order.
6. An awaited decryption/key operation can finish after disposal without a second disposal check immediately before all state writes. Recovery must not let old-user/old-room work leak across an auth or navigation generation.
7. The current warning is a four-second toast (`showToast`, `App.tsx:1016`), not a persistent connection-state model. Background timer suspension or repeated failures can make it appear stuck; there is no observed production trace proving which happened here.

### Classification of the eight possibilities in the brief

| Possibility | Finding |
| --- | --- |
| Genuine network/WebRTC disconnect | Network loss can cause the Realtime error. WebRTC is not the text-chat transport; no evidence this warning originates in WebRTC. |
| Supabase Realtime/WebSocket disconnect | **Confirmed warning source:** channel error/timeout callback. Distinguishing socket transport loss from channel join/auth failure needs a runtime trace. |
| iOS/PWA lifecycle issue | Strong code-supported candidate: missing chat foreground repair and initial-hydration failure recovery. Not reproduced on a physical iPhone here. |
| Expired auth/realtime token | Not established. `autoRefreshToken` is enabled. The installed SDK handles foreground auth recovery and forwards `TOKEN_REFRESHED`, `SIGNED_IN`, and `INITIAL_SESSION` tokens to Realtime. Do not claim token propagation is absent simply because App does not call `setAuth`. Recovery still needs to await a usable session. |
| ICE/TURN failure | Separate confirmed call-reliability gaps below; not the source of text-chat status. |
| Missing reconnection/ICE restart logic | **Confirmed application-level gaps.** SDK retries exist; app-level channel/history recovery and effective call renegotiation are insufficient. |
| Cloudflare routing/proxy | No checked-in app-host proxy for the Supabase socket. Static deployment validation passed. Live DNS, firewall, dashboard routing and provider behavior remain unverified. |
| Combination | Lifecycle/network interruption plus incomplete channel/history recovery is plausible. A definitive production root cause requires correlated, sanitized logs from the failing session. |

## Complete checked-in TURN/STUN/WebRTC audit

| Area | Current implementation and assessment |
| --- | --- |
| Provider and transport separation | App shell: Cloudflare Worker static assets. Text rows/presence/call signalling: Supabase. Call media: WebRTC, direct or relayed via ICE. Cloudflare STUN is not Cloudflare hosting or a TURN credential service. |
| Configuration precedence | `getIceServers()` first accepts a non-empty `VITE_ICE_SERVERS_JSON` array. Otherwise uses default STUN servers plus a legacy TURN entry only when URL, username and credential are all set. `loadIceServers()` uses configured TURN in preference to the Edge Function. |
| STUN list | `stun:stun.cloudflare.com:3478`; `stun:stun.l.google.com:19302`; `stun:stun1.l.google.com:19302`; `stun:stun2.l.google.com:19302`; `stun:stun3.l.google.com:19302`. |
| Dynamic TURN | Authenticated client invocation of `webrtc-ice-servers`, expected to return `{ iceServers: RTCIceServer[] }`. Code describes Cloudflare TURN. **Function implementation is absent from this repo and patch**; its actual URLs, TTL, authorization checks, rate limits and secret storage cannot be verified here. |
| Credential lifetime | `resolvedIceServers` caches indefinitely and is not cleared by cleanup/sign-out. No expiry/refresh mechanism. A failed fetch also permanently caches STUN fallback for that service instance. New relay allocations/restarts can therefore reuse expired credentials, or never retry a temporarily unavailable provider. Existing allocations need not fail at the instant credentials expire. |
| Secret exposure | Runtime short-lived ICE credentials necessarily reach the browser to authenticate to TURN; provider API keys/shared secrets must not. Legacy `VITE_TURN_CREDENTIAL` and credentials inside `VITE_ICE_SERVERS_JSON` are bundled if configured. No actual TURN secret was found or printed; production variable values are unknown. Do not use those paths for static secrets. The Supabase publishable browser key is not a service-role secret. |
| Peer setup | `RTCPeerConnection` with resolved ICE servers and `iceCandidatePoolSize: 4`. No forced relay policy. Local tracks attached; remote tracks observed. No RTC data channel for chat. |
| Gathering | Trickle candidates broadcast through Supabase; candidates received before remote SDP are buffered. No `icegatheringstatechange` / candidate-error diagnostics, explicit end-of-candidates signalling, or generation-aware candidate queues for a restart. |
| Connection state | `disconnected` immediately becomes failed in the call UI; no grace period. `ontrack` also marks connected, although arrival of track metadata alone is not a connectivity check. |
| ICE restart | `restartIce()` called when ICE fails, but no `negotiationneeded` handler sends a new SDP offer. Offer creation happens on call-accept. Callee-originated offers are ignored by the caller's role-gated handler. This is not a complete restart protocol. |
| Signalling recovery | Call channel waits at most ten seconds for initial subscription, then the settled callback ignores subsequent status transitions. No app-level signalling recovery, replay or repair of an active call. A failure before `this.callChannel = channel` can leave the locally created channel outside normal cleanup. |
| Teardown / iOS | Both `beforeunload` and `pagehide` unconditionally cleanup media/peer resources. No persisted-page recovery, foreground call repair, or network-change path. Not every iOS background action fires pagehide; this code is specifically destructive when that event does fire. Uninterrupted background calling cannot be guaranteed by a browser PWA. |
| Development vs production | Same ICE resolver used in both. Vite variables are build-time browser config. No documented TURN envs in `.env.example`; production build secrets/dashboard config are not checked in. Missing Supabase envs fall back to the production project, including in development: do not mistake local mocked validation for isolated staging access. |
| Cloudflare routing | The checked-in Worker has static assets only, no bindings or socket relay. Supabase requests go directly to the configured Supabase origin. The service worker deliberately bypasses cross-origin requests. TURN must use provider-specific endpoints, not an assumption that the application's HTTP proxy carries TURN UDP/TCP traffic. |

## Safe implementation plan for the follow-up recovery patch

1. Rebase/regenerate only the recovery work against current main. Preserve the current push/profile/UI code and regression commands.
2. Introduce one tested channel-recovery owner for the two message streams. Handle generation guards, serialized removal, per-consumer dispatch, cancellation, jittered retries, offline parking and bounded join timeouts.
3. Coalesce `visibilitychange`, persisted `pageshow`, online and supported network-change signals. Re-read online status; obtain a usable session before reconnecting. Defer async auth work out of auth callbacks to avoid lock re-entry. Dispose old-user work on sign-out/account changes.
4. Join and then reconcile history, buffering/deduplicating concurrent events. Recover initial load failures too. Use bounded, non-overlapping reads with stable `(created_at, id)` pagination/watermarks and a scoped fallback poll.
5. Deduplicate state **and notification side effects** by server message ID; maintain stable order and expiry/burn semantics. Do not auto-retry ambiguous sends until a stable client idempotency key is sent and enforced by a verified backend contract.
6. Derive chat health from actual join and synchronization outcomes. Distinguish reconnecting, offline, session-required and history-sync failure. Never clear the warning as a substitute for doing recovery.
7. Separately repair calling without changing provider: obtain the deployed `webrtc-ice-servers` contract, honor its credential expiry, retry transient credential failure, and use refreshed ICE configuration during a bounded, role-safe offer/answer restart. Handle grace periods and call-channel recovery before renegotiating.
8. Stage migrations only after inspecting the real schema/RLS. No wholesale application of the submitted alternate signalling/push migrations.

## Validation actually performed

All build/test results below are for the **current application**, not a successfully applied patch. It is impossible to certify the full proposed build while the diff does not apply.

| Command/check | Result |
| --- | --- |
| `git apply --check 'patch 1'` | **FAIL**, non-applicable patch and binary entries. Nothing applied. |
| `npm ci` | PASS; Node 22 warns `@zxing/library` declares Node >=24. No credentials required. |
| `npm run lint` | PASS. Repository defines lint as `tsc --noEmit`; there is no separate ESLint run. |
| `npm run typecheck` | PASS. |
| `npm run build` | PASS. |
| `npx --yes wrangler@4 deploy --dry-run --outdir .cache/patch-review/cloudflare-dry-run` | PASS with Wrangler 4.145.0; 34 assets read, no bindings, no deployment. |
| `npm run test:setup` | PASS; temporary no-save test dependencies installed. Package/lock files unchanged. |
| `npm test` | **FAIL**, syntax error in existing `scripts/push-tests/sql.test.mjs:78`; chain stops there. |
| `npm run test:push-e2e` | **FAIL**, existing syntax error at `scripts/push-tests/e2e.test.mjs:252`. |
| `npm run test:push-sw` | PASS. |
| `npm run test:e2ee` | PASS. |
| `npm run test:discovery` | PASS (modelled database, not live project). |
| `npm run test:inspect-script` | **FAIL**, existing `supabase/pending/inspect_discover_right_now.sql` contains diff syntax, not executable SQL. |
| `npm run test:interaction` | PASS. |
| `npm run test:profile-migration` | **FAIL**, existing malformed code at `scripts/profile-tests/migration.test.mjs:70`. |
| `npm run test:profile` | **FAIL**, attempts `.click()` on undefined at `scripts/profile-tests/profile.test.tsx:342`. |
| `node scripts/review-patch-1.mjs` | **8 defect scenarios reproduced**: six manager behaviors and two SQL order conflicts. This is evidence of defects, not eight successful recovery acceptance tests. |

Cloudflare configuration review: `wrangler.toml` serves `dist` with SPA fallback, and `_headers` covers the current worker/manifest/assets. No proxy implementation or origin restriction was added. GitHub deploy uses Node 22 while the build workflow uses Node 24; align them with dependency requirements in a separate deployment change. The deploy workflow does not explicitly supply Vite environment values; public Supabase fallback currently makes that omission non-fatal. Runtime Worker variables do not rewrite a built Vite bundle. The dry run does not verify dashboard secrets, custom-domain DNS, deployed headers, Supabase policies, or the live TURN service.

## Remaining acceptance work — not claimed as verified

Use two authenticated staging users and real Safari plus an installed iOS PWA. Do not record JWTs, TURN credentials, SDP, candidate addresses, message contents or provider secrets in diagnostic logs.

- Leave chat for another screen and return; background/lock for short and token-expiry-length intervals; exercise bfcache restoration.
- Send while the recipient is away, then verify history fills once, in order, with no duplicate unread/notifications and no lost sends.
- Airplane mode; Wi-Fi/mobile transition; dropped heartbeat; failed initial history read; delayed old-channel close; simultaneous lifecycle triggers.
- Refresh token during recovery; expired refresh token; sign-out during decryption/catch-up; account switch; rapid navigation/StrictMode mount cycles. Old channels and timers must not survive disposal.
- Verify only real subscription + reconciliation success returns chat to healthy. Unrecoverable authentication must offer sign-in, not retry forever or pretend connected.
- For calls separately: force relay, exercise TURN expiry and temporary credential-function failure, interrupt signalling, verify a fresh restart offer/answer/candidate generation and remote-media recovery. Inspect provider-side expiry/auth behavior without exposing credentials.
- Run the full repaired baseline suite plus new recovery acceptance tests. None of the current passing suites is an end-to-end chat reconnect test.

## Files changed by this review

- `patch 1`: fetched unchanged from the user's new GitHub commit so it is available in this session (no patch content edits).
- `docs/PATCH_1_REVIEW.md`: findings, architecture audit, validation results and safe correction plan.
- `scripts/review-patch-1.mjs`: extracts the proposed manager directly from the patch and reproduces defects without applying it; uses isolated browser/Supabase mocks and PGlite for two specific DDL conflicts. Intentionally **not** part of `npm test`, because its assertions confirm submitted bugs rather than desired application behavior.

No production fix is represented as completed. No deployment, migration, commit or push was performed.
