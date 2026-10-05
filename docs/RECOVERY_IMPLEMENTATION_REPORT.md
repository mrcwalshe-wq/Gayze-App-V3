# Focused chat recovery implementation and validation

> Historical first-phase report. The subsequent push implementation, additive (unapplied) notification migration, TURN investigation and final validations are documented in [RELEASE_READINESS.md](RELEASE_READINESS.md). In particular, the working-tree sender is no longer empty. This earlier report’s statements about absent inbox/sender code and unchanged service-worker/schema paths describe the first phase only.

Date: **2026-09-30**. Base: `1190d6ab220b2658678b66136f95a21810b2f306`.
Branch: `arena/01a0f3ee-gayze-app-v3`.

## 1. Decision and boundaries

**Targeted implementation is complete and locally regression-tested; production resolution is NOT certified. No deployment, push, commit, schema migration or application of `patch 1` was performed.** The checkout remains on the requested base commit with the implementation in the working tree.

- Cloudflare hosting, Supabase Realtime and Cloudflare TURN remain separate responsibilities. No coturn, alternate socket client, Vercel infrastructure, new push handler or patch migrations were introduced.
- Both existing message subscription wrappers now use one recovery implementation over the existing Supabase client/socket.
- The approved logo, icons, manifest, service worker, Cloudflare routing/headers and existing migrations are unchanged.
- **Push release blocker:** `supabase/functions/send-push/index.ts` contains one newline, both at HEAD and in the working tree. Its authentication, recipient authorization, preference enforcement, delivery, deduplication and expired-endpoint pruning cannot be audited or certified.
- **TURN release blocker:** the deployed `webrtc-ice-servers` function source is absent. The client expiry contract is implemented, but the real response TTL, server authentication and provider-secret handling still need verification.
- Real iOS Safari/PWA suspension, keyboard geometry, Wi-Fi/mobile transitions, relay-only calls and deployed message/presence/signalling policies have not been tested.

**Correction to the prior review:** `PATCH_1_REVIEW.md` incorrectly described the current push sender as authenticated and preference-aware. Those properties were implied by documentation/client/SQL contracts, not established from an implementation. The checked-in sender is empty. This report supersedes that claim and the prior review's pre-implementation status.

## 2. Root cause established from source

The chat defect is in subscription ownership and recovery, not TURN:

1. Active-room startup previously awaited key/history initialization before installing its subscription and polling. An initialization failure could prevent subsequent delivery/recovery from being installed at all.
2. The active-room and inbox subscriptions did not own a complete visibility/network/auth recovery lifecycle or reconcile persisted history after successful rejoin. Reporting an error toast did not restore delivery.
3. The old three-second polling could overlap asynchronous reads/decryption. Late work could update a newer room/account/channel, while initial history replacement could discard displayed data.
4. An SDK socket that looks open after suspension is not proof of a working channel or reconciled history. Channel joins and database catch-up need separate health checks.
5. A stalled asynchronous message consumer could hold a serialized queue across channel generations. Consumers now race cancellation and check generation/account validity before applying late results.

These are source-inspected defects covered by local regression tests. There is **no production trace identifying which lifecycle/network/auth event caused the reported incident**; no claim is made that the original device scenario has been reproduced physically.

## 3. Supabase recovery design

### Ownership and lifecycle

`realtimeRecovery.ts` manages existing SDK channels, not another transport implementation. `chatSubscriptions.ts` shares streams by client, authenticated user and conversation/inbox scope, with independent observers and teardown ownership.

- Handles `SUBSCRIBED`, `CHANNEL_ERROR`, `ERROR`, `TIMED_OUT` and `CLOSED`.
- Watches visibility, page lifecycle, online/offline, available network-change events and Supabase auth changes. Foreground recovery re-reads current browser online state, even if an `online` event was missed during suspension.
- Hidden/offline owners park their subscriptions. Visible/online owners revalidate the session, join and reconcile. A nominally joined old socket is not blindly trusted.
- Session expiry invokes the existing SDK refresh path. Missing/invalid refresh credentials lead to sign-in-required; temporary network/5xx errors remain retryable. A direct principal change invalidates the old owner before React cleanup.
- Retries coalesce with a minimum one-second attempt spacing and exponential delay from one to 30 seconds plus up to 250 ms jitter. Join/auth work is bounded at 20 seconds; reconciliation at 60 seconds; fallback reconciliation is every 30 seconds.
- SDK rejoin success cancels a pending application retry. Backoff resets after joining, not merely after a successful REST read.
- A **silent join deadline only**, not an auth/REST error, may repair the existing SDK transport. This escalation is shared and limited to once per 30 seconds across feeds. Ordinary cleanup does not disconnect the shared socket.
- Same-topic departures are serialized across remounts. Generation/abort invalidation precedes teardown, so retired callbacks cannot change replacement status/data. Cancellation also releases a queue whose old consumer never resolves.

Presence and existing call-signalling channels reuse this lifecycle owner; REST-before-join catch-up is enabled only for message streams, not presence/signalling.

### Truthful connection UI

`ChatRoomView` receives real recovery state: connecting/reconnecting, syncing, connected, offline, suspended or sign-in-required. Connected requires a successful subscription and reconciliation. Disconnects do not clear displayed message rows. Encryption-key availability has its own state and no longer controls whether subscription recovery is installed.

## 4. Message integrity and account boundaries

- PostgreSQL is authoritative. Catch-up uses stable `(created_at, id)` keyset ordering, requests pages of 200 and continues until an empty page, rather than treating a short server-capped page as the end.
- Reconciliation rescans history instead of trusting a timestamp as commit order; a delayed/backdated commit can therefore be found on a subsequent pass. No missing-row deletion is inferred from an incomplete scan.
- Inbox REST catch-up is additionally restricted through the existing `get_my_conversations` membership RPC, in batches of at most 50 conversation IDs. This is defence in depth, **not a substitute for message RLS**.
- Live and historical delivery are serialized and deduplicated by stable ID/version. Independent observers retain their own acknowledgements. Burn/expiry changes are reprocessed; stable-ID merging preserves existing plaintext and never resurrects a burned row.
- Initial old history does not create new-message alerts. Reprocessing an encrypted placeholder after delayed key availability does not repeat its alert or reset a healthy channel. Missing keys keep the row retryable on reconciliation.
- Late callbacks check channel/account ownership before enqueueing state. Already-accepted same-account rows are not discarded merely because React applies their queued update after a channel replacement.
- Sends retain one UUID with the failed draft/payload. Retrying an ambiguous write uses an INSERT with that existing primary key, followed by a receipt lookup scoped to ID, conversation and sender. It does not overwrite ciphertext with an upsert. Account identity is checked before sending and after asynchronous work.
- Failed sends retain their draft/error and do not create a falsely successful conversation preview. Confirmed receipts use database timestamps and expiry/burn metadata. Meeting-message callers catch send failures.
- Remote sign-out, invalid-session handling and direct account switching clear account-derived chat state; late old-account sends cannot populate the replacement account.

**Scale limitation:** full-history reconciliation prioritizes correctness over bandwidth. ID/version maps grow with history; large accounts incur repeated reads and can hit the 60-second reconciliation budget. The inbox also depends on the existing membership RPC returning the intended membership set. Production history-size and RPC-limit measurements remain necessary; a future bounded change cursor requires a demonstrated backend contract, not an invented migration here.

## 5. Cloudflare TURN and WebRTC — separate from chat

### Configuration and credentials

The existing authenticated Supabase `webrtc-ice-servers` endpoint remains the runtime source for Cloudflare TURN. Provider API credentials are not moved into browser configuration.

`iceCredentials.ts` validates browser ICE fields, coalesces requests and invalidates old call generations. It understands `expiresAt`/`expires_at` as epoch seconds, epoch milliseconds or ISO strings, and `ttlSeconds`/`ttl` in seconds. Credentials refresh with 20% of TTL, capped at 60 seconds, remaining. Already-expiring credentials are rejected. Requests to the endpoint have a ten-second abort deadline.

Responses without expiry metadata are not reused across negotiations and are revalidated every 30 seconds during an active call. **That fallback cannot guarantee refresh before the provider's unknown actual expiry.** A failed credential request falls back to the existing public STUN configuration without permanently caching that failure.

Vite now rejects legacy public TURN username/credential variables and credential-bearing or non-STUN `VITE_ICE_SERVERS_JSON` before bundling, without logging their values. `.env.example` documents the runtime endpoint/TTL contract. Two synthetic rejection builds passed, and the synthetic credential sentinel was absent from build logs and output.

### ICE restart and signalling

- Refreshed ICE servers are installed with `setConfiguration` before restart negotiation.
- Only the original caller generates restart offers; the callee requests a restart, then answers. SDP offers/answers travel over the existing Supabase call-signalling channel, rather than calling `restartIce` without renegotiation.
- Incoming signalling is serialized. Candidates are bounded/buffered by ICE username fragment so a new ICE generation is not applied against stale remote SDP.
- Disconnects have a five-second grace; retry watchdogs are bounded to three restart attempts with 12-second retry intervals. Signalling-down calls wait for rejoin. Initial lost offer/answer negotiation also has a recovery watchdog.
- `ontrack` alone is not proof of a connected call. Retired peer callbacks cannot mutate replacement streams or start another offer.
- Media acquisition, credential loading, channel joining and delayed hangup acknowledgements check call generation. Late old work cannot tear down a replacement call.
- Temporary outbound signalling channels now have a ten-second lifetime, single-send guards, acknowledgement handling, failure cleanup and generation cancellation. Broadcast acknowledgements use a five-second timeout.
- Changing display name/privacy no longer tears down the user call-signalling effect. Teardown stops media, timers, credential cache and owned channels.

**Security boundary:** peer/target checks are defence in depth. Client filters do not authenticate a broadcast sender. These existing channels do not request private-channel authorization in client configuration; production Realtime authorization must be reviewed before security sign-off. No new channel policy was guessed or deployed.

## 6. Current push audit — not an end-to-end pass

| Stage | Established from current code / local tests | Not established |
| --- | --- | --- |
| Event and authoritative write | Messages persist in `messages`; gaze action inserts into `gazes`; mutual interest goes through the existing RPC | Complete deployed event/schema contracts |
| Server event production | Existing conditional message AFTER INSERT trigger calls `request_push_dispatch`; intent-expiry and safety sweep paths exist | Actual installed triggers/schedules; generic gaze/interest push producer |
| Connection event | Client invokes `send-push` with `{ action: 'connection', conversationId }` after an authoritative mutual result; failure does not fail interest flow | Server recipient/membership verification |
| Subscription | Browser PushManager, authenticated endpoint ownership, preferences, local revoke/sign-out cleanup and public VAPID configuration exist | Real APNs/browser delivery and deployed ownership policies |
| Database authorization | Actual checked-in push migrations passed an isolated PGlite ownership/RLS/ledger/dispatch test | Live production schema/policy equivalence |
| Server sender | Checked-in function is one newline | JWT/dispatch-secret validation, recipient selection, preferences, encryption, delivery, 404/410 pruning, abuse limits |
| Worker and click | Existing worker supports push, safe default copy, same-origin destinations and click routing; SW suite passes | Real OS foreground/background notification behavior |
| SPA destination | Existing app notification routing handles authenticated destinations; Cloudflare SPA fallback retained | Device tap with a cold start, expired login or actual membership mismatch |

The current SQL uses Vault secrets and `pg_net` to target the canonical `/functions/v1/send-push` endpoint. The isolated test executes the existing base push migration and URL-fix migration, omitting only unsupported extension-install statements and supplying mocked auth/net/Vault infrastructure. It verifies:

- Another authenticated user cannot read/steal another endpoint or insert a subscription for that user.
- Dispatch ledger uniqueness and denial of authenticated ledger reads.
- Dispatch RPC cannot be executed by the authenticated role.
- Message dispatch payload omits ciphertext and uses the canonical URL.
- A simulated dispatch exception does not roll back the originating message INSERT.

This does **not** prove live message/presence RLS or server delivery. A dispatch ledger is not a durable user-facing notification inbox or retry outbox. No independent notification-record guarantee for every requested event has been established. The current migration intentionally omits generic interest/Gayze triggers because the authoritative schema/event contract is unknown. Thus **“someone Gayzes me” push and durable notification records remain incomplete acceptance items**, not silently claimed as implemented.

The App's separate raw incoming-interest subscription also retains its existing baseline suppression and lacks the new chat history-recovery contract. It was not silently rewritten as part of the two message streams.

No private VAPID, TURN provider, Supabase service-role, FCM, APNs or OAuth credential was added to client code. The absent server functions prevent verification of their secret handling. The unsafe patch handler and conflicting migrations were not used.

## 7. Presence, profiles, branding and mobile

- Presence publication waits for the matching account's persisted profile. Unknown/failed profile hydration stays untracked, avoiding a brief default-public presence leak.
- Bootstrap previously upserted default display/privacy fields over an existing profile. It now inserts defaults only for a new profile and updates only the intentional device-identity field on an existing row. A regression test confirms saved ghost privacy, name and bio survive bootstrap.
- A deployed `presence_incognito` flag returned in the existing own-profile read is honored; ghost/incognito users are not tracked. This does not create a missing backend flag or validate the live schema.
- Background/offline/sign-out teardown clears presence. Ordinary message/presence synchronization does not manufacture online status or unnecessarily flicker it.
- The existing Amber online indicator is retained. Optional membership-RPC last-seen metadata is parsed only as a finite timestamp, cleared when absent/private and masked for incognito. Missing truth is displayed as unavailable, not fabricated “recently online.”
- Chat uses a bounded flex/scroll layout, existing navigation height and safe areas. VisualViewport resize/scroll updates its height/offset and removes listeners/styles on unmount. Pending-send input is disabled and send errors remain accessible.
- No logo/icon changes, CSS/text logo reconstruction, unrelated drawer redesign or replacement brand asset was made.

The five new UI tests run in **jsdom**, covering truthful states, draft/UUID retry, expiry/burn/Amber/last-seen behavior, viewport variable lifecycle and privacy-aware presence. Existing interaction tests also pass. They do **not** measure physical drawer/input geometry, keyboard occlusion, VoiceOver or iOS safe areas. Playwright Chromium installation was attempted but CDN TLS downloads failed with `ECONNRESET`; no real-browser layout test ran.

## 8. Cloudflare compatibility

Production still builds to `dist` and uses the existing `wrangler.toml` static-assets/SPA fallback configuration. `/service-worker.js`, manifest and icons retain their existing `_headers` and cache behavior. No WebSocket/TURN proxy or hosting-provider change was made.

Final production build: Vite 8.3.1, 2,017 transformed modules, successful.
Final `wrangler@4.145.0 deploy --dry-run`: **successful**, read 34 assets, generated a 0.33 KiB worker, no bindings; explicitly exited without deployment.

Vite public variables are build-time values; runtime Worker variables do not rewrite the browser bundle. Configure public Supabase/VAPID values for the build and keep provider/service secrets in their server functions. Existing workflow Node-version mismatch (Node 22 deploy versus Node 24 build, and the ZXing Node >=24 engine warning under this Node 22.22.3 sandbox) remains a deployment follow-up, not a hidden workflow edit.

Dry-run success does not validate live DNS, custom-domain routing, deployed headers, dashboard origins, Supabase Realtime permissions, subscription delivery or TURN reachability.

## 9. Final validation results

These checks were rerun after the final application changes:

| Check | Result |
| --- | --- |
| `npm run lint` | PASS; repository alias is `tsc --noEmit`, **not ESLint** |
| `npm run typecheck` | PASS |
| `npm run lint:recovery` | PASS; actual scoped ESLint over changed application/services/Vite code |
| `npm run test:recovery` | **40/40 PASS**: 24 deterministic recovery cases, 10 real-source mocked WebRTC/persistence/profile cases, five jsdom/presence cases, one actual-migration PGlite security case |
| `npm run build` | PASS |
| `npx --yes wrangler@4.145.0 deploy --dry-run --outdir .cache/recovery-validation/cloudflare` | PASS; no deployment |
| Existing `test:push-sw`, `test:e2ee`, `test:discovery`, `test:interaction` | PASS |
| `git diff --check` | PASS |
| Synthetic public-TURN-secret rejection builds | Both rejected as expected; sentinel absent from logs/bundle |
| Physical iOS/PWA, browser layout, real ICE/network transition, deployed security/push tests | **NOT RUN / NOT VERIFIED** |

New tests cover subscription status recovery, bounded exponential retries and storms, shared ownership, old generation isolation, session/refresh behavior, late commits and server page caps, shared transport repair, stalled consumers, delayed keys, membership-scoped inbox reads, stable-ID send receipts, ICE offer/answer restart and candidate generations, transient signal teardown, late hangup protection, privacy-preserving profile bootstrap and UI/push-SQL security behavior.

ESLint uses Babel's TS parser because this repository uses TypeScript 7, outside the available typescript-eslint peer range. The existing lint alias/test commands were not replaced. The lockfile expansion is dev lint tooling; no application runtime dependency upgrade was introduced. Existing `npm run test:setup` supplies the repository's no-save jsdom/PGlite test dependencies on a fresh installation.

### Unchanged baseline failures — not repaired to manufacture green

All five were rerun and still fail as previously observed:

| Existing suite | Failure |
| --- | --- |
| `test:push-sql` | `scripts/push-tests/sql.test.mjs:78`, unexpected `)`; associated legacy fixtures also contain malformed diff-like code |
| `test:push-e2e` | `scripts/push-tests/e2e.test.mjs:252`, unexpected `)` |
| `test:inspect-script` | Pending inspection SQL includes literal diff markers and is not executable SQL |
| `test:profile-migration` | `scripts/profile-tests/migration.test.mjs:70`, invalid assignment from literal `+` diff text |
| `test:profile` | Existing completion/nudge assertions fail; line 342 calls `.click()` on an undefined nudge |

Those files were not edited. The aggregate legacy `npm test` remains blocked by these failures; the new security test supplements rather than rewrites or bypasses the legacy suites.

## 10. Exact change inventory

**Modified application/configuration files**

- `src/App.tsx`: feed/lifecycle/key wiring, stable merges/sends, account guards, presence/profile hydration and separate call-signalling effect.
- `src/components/ChatRoomView.tsx`: truthful status/last-seen, viewport layout, accessible retained-draft retry and expiry handling.
- `src/services/supabaseService.ts`: subscription adapters, presence privacy, stable-ID persistence/receipts, optional last-seen mapping and profile bootstrap preservation.
- `src/services/conversationRooms.ts`: truthful finite/cleared last-seen metadata.
- `src/services/webrtcService.ts`: runtime credential refresh, actual ICE renegotiation, recovered signalling, bounded transient channels and stale-call isolation.
- `src/types.ts`: message expiry and optional last-seen data.
- `src/index.css`: chat-only viewport/navigation/safe-area layout.
- `.env.example`, `vite.config.ts`: public STUN/runtime TURN contract and pre-bundle credential rejection.
- `package.json`, `package-lock.json`: additive scoped lint/test commands and dev-only lint tooling.

**New implementation files**

- `src/services/realtimeRecovery.ts`
- `src/services/chatSubscriptions.ts`
- `src/services/messageMerge.ts`
- `src/services/iceCredentials.ts`

**New validation/report files**

- `eslint.recovery.config.mjs`
- `scripts/recovery-tests/recovery.test.ts`
- `scripts/recovery-tests/webrtc.test.mjs`
- `scripts/recovery-tests/ui.test.mjs`
- `scripts/recovery-tests/security.test.mjs`
- `scripts/recovery-tests/load-module.mjs`
- `docs/RECOVERY_IMPLEMENTATION_REPORT.md`

The prior `docs/PATCH_1_REVIEW.md` is retained with an explicit correction/status note. The prior `scripts/review-patch-1.mjs` and untracked `patch 1` are preserved. Patch SHA-256 remains `c17b00ece307a9ff5da5339271c0ec3e7fb253fc7f7d3bcbe605e8dcc5b1540b`.

`git diff` confirms no changes under `public/`, `supabase/`, `.github/`, to `wrangler.toml`, or to `src/components/GayzeLogo.tsx`. No existing malformed test/migration was modified. Build output, installed dependencies and validation caches are not deliverable source changes.

## 11. Required release gates

1. Two staging users on physical iOS Safari and installed PWA: repeatedly leave/reopen chat, lock/unlock, background/suspend, go offline, and switch Wi-Fi/mobile. Confirm resumed delivery, correct connection UI and exactly one displayed row/alert for persisted IDs, including ambiguous send retries and same-timestamp messages.
2. Verify production message RLS, membership RPC completeness/limits and Realtime publications, presence privacy and signalling authorization. Include account switch/sign-out during pending history, decryption, media permission and signalling operations.
3. Inspect the actual Cloudflare TURN function and its authenticated response/expiry metadata. Test forced relay, UDP-blocked/TCP/TLS fallback, credentials expiring during calls, caller/callee restart and lost offer/answer/ACK under real network changes.
4. Recover/audit the actual deployed `send-push` source before claiming server security or delivery. Verify recipient ownership, preferences, dispatch authorization/dedup, endpoint 404/410 pruning, event production and durable notification-record/retry behavior. Demonstrate message/Gayze/connection/intent/safety paths rather than assuming worker support means events exist.
5. Validate real notification delivery/taps in foreground/background/cold start, login handoff, same-origin routing and service-worker updates on the Cloudflare domain.
6. Measure keyboard/nav/drawer safe-area geometry and accessibility on physical mobile devices. Benchmark large message histories and the 30-second catch-up cost before production sign-off.

**Do not deploy on the strength of local mocks or a Wrangler dry run alone.**
