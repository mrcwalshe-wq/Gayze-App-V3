# GAYZE — controlled release candidate / working-tree audit

**2026-10-01 · NOT production-ready · no rollout authorized**

The outstanding recovery, notification, E2EE, profile/presence and chat work has been consolidated and checked in the existing working tree, with targeted follow-up fixes. This is a **local release candidate**, not a claim that the currently deployed app has changed or its live symptoms have been resolved.

**No commit, push, reset/revert, merge, branch switch, deployment or project database migration application was performed.** SQL was exercised only in disposable local PGlite test databases. No production/staging database was touched. No existing provider, design system, approved branding/icon or working feature was replaced with a mock. Network doubles exist only in test harnesses.

## A. Repository identity and comparison with current main

| Item | Value |
| --- | --- |
| Working branch | `arena/01a0f3ee-gayze-app-v3` |
| HEAD | `1190d6ab220b2658678b66136f95a21810b2f306` |
| Local `main`, `origin/main`, and remote `main` inspected read-only | `acb974890946ef87f72263ddbc7305a824888321` |
| Difference HEAD → main | One commit, `acb9748 Create patch 1`, adding only `patch 1` |
| Initial working-tree inventory | 52 modified/untracked files, captured before this request's edits |
| Patch 1 | Unapplied; local copy identical to main's file |
| Patch SHA-256 | `c17b00ece307a9ff5da5339271c0ec3e7fb253fc7f7d3bcbe605e8dcc5b1540b` |

Both `git diff main` and a content-aware comparison including untracked files were inspected. **Important Git trap:** tracked-only `git diff main` represents `patch 1` as a deletion because this branch does not track the local copy. The file is physically present and byte-identical to main. It was NOT deleted or applied. Untracked implementation files are additions in the content-aware comparison, not invisible omissions.

`docs/RELEASE_CANDIDATE_INVENTORY.json` records the initial statuses/hashes, final statuses/content hashes, per-file main comparison and which files changed in this request. It deliberately omits its own recursive content hash.

## B. Exact modified/untracked files and provenance

The generated table at the end lists **every non-ignored modified/untracked file**. `M` means modified relative to this branch's index; `??` means untracked. `same` means preserved byte-for-byte since this request began, `edited` means a pre-existing dirty file was updated, and `newly modified`/`new` identify this pass's additions to the dirty set.

Earlier-scope labels: **R** recovery/presence/TURN; **N** notification implementation; **C** previous chat-performance follow-up; **UI** previously clean, tracked UI; **audit/tooling** supporting documentation/scripts. Mixed files are explicitly marked.

All 52 initial files predate **this** request. Historical notification/recovery/chat scope comes from the earlier reports and source diffs; there were no inter-phase commits. Thus exact historical authorship of every individual mixed-file hunk cannot honestly be reconstructed from Git alone. Initial-to-final attribution for this request is exact and hash-backed. Existing profile/discovery/push source and migrations already in HEAD remain the base—not newly authored notification changes.

## C. Substantive changes in the candidate

### Retained earlier work

- Shared Supabase recovery ownership, SDK session validation, bounded reconnect/stall recovery, background/foreground cleanup and stale-generation guards.
- Cloudflare TURN credential validation/refresh and WebRTC ICE recovery, keeping the existing provider and signalling architecture; server-source/expiry gates remain open.
- Stable-ID message send/receipt handling, chronological merges, burn/expiry integrity, E2EE, account clearing and preserved drafts on failed sends.
- Real presence and server last-seen display, Amber Online Now, ghost/incognito protection, and profile-bootstrap privacy preservation.
- Durable recipient notification inbox/read/unread state, secure existing Web Push sender, endpoint claims/cleanup, native worker handling, safe routes and stable-ID Gayze targeting.
- Restored generic incoming toast with foreground/native correlation; no dependence on push success or decryption to alert the foreground user.
- Newest-page-first history, eight-way bounded history processing, separate live delivery lane, shared key/decrypt work, exact-request coalescing, frame batching and a 100-message initial DOM window with older-history access.
- Shared avatar signing requests, responsive chat viewport/keyboard groundwork and existing secret-in-public-build guards.

### Added/fixed during this consolidation

1. **Warm history ownership:** a fully hydrated/readable room can use a recent-50 read while the healthy global owner continues authoritative full reconciliation. Cold rooms, missing keys, account/cache changes, reconnect/offline/background states and newly discovered older rows remove eligibility. A newly discovered older message in the selected room is still decoded by the global feed; another room loses warm eligibility and receives a full read on reopening. No timestamp watermark replaces full correctness reconciliation.
2. **Decrypt cache eviction:** newest-first history plus FIFO eviction kept the oldest 512 results and discarded recent ones. The bounded cache now retains recent results. No key/plaintext persistence was added.
3. **Startup state:** REST completing before the first channel JOIN acknowledgement is still `connecting`, not a false `reconnecting`/interruption. The post-JOIN reconciliation remains to close the REST/subscription race; it is not a duplicate channel.
4. **Opt-in tracing:** record shell/message/decrypted commits, request/page work, subscription request/ACK and reconciliation completion. Counters and relative times only, bounded to 16 traces; no exported room/account IDs, message text, keys or URLs; no telemetry or persistence.
5. **Room metadata:** unchanged conversation-list polls now return the existing array/objects. Actual avatar changes/removal and cleared last-seen metadata still update; old photos no longer survive server-side removal simply because merge omitted `peerAvatar`.
6. **Non-expanding composer:** `safeHavens = []` was a new dependency each render, causing the initialization effect to reset a mode selection immediately. Haven refreshes and same-intent object refreshes could also erase a draft. Initialization now occurs for an open/target transition; late haven data only fills an unchosen default. Close/reopen still reloads saved data.
7. **Drawer/nav bounds:** the unlayered `.g-sheet` margin rule overrode the intended Tailwind margin utility, and max-height did not budget the nav gap. A targeted design-system modifier now shares one bottom-gap value between margin and height. No application-wide sheet redesign.
8. **Mobile controls/avatar fallback:** undersized 34/36 px map/drawer controls now have 44 px targets; affected 36 px close buttons are 44 px. Failed preview/detail profile images reveal an actual initial instead of an empty box. No stock portrait substitution.
9. **Notification hardening:** stored deep-link consumption now rechecks the same destination allowlist used for storage. Test-push feedback distinguishes policy/configuration/preferences and provider acceptance from device delivery.
10. **Pending SQL hardening:** partial unread index; `pg_temp` explicitly last in definer search paths; intent-linked Gayze recipient ownership validation; HTTPS dispatch-base validation; no raw dispatch exception text in warnings. Added transactional rollback, temporary-table spoofing, recipient and dispatch tests.

## D. Chat performance: trace, causes, improvements and limits

### Measured locally, not on the live site

`npm run bench:rc` runs the **real chat component, recovery, pagination, batcher, merges and AES-GCM** with 1,000 synthetic messages. Only DB/auth/channel boundaries are controlled (10 ms REST response, 20 ms JOIN ACK, 4 ms key discovery). It uses jsdom commits, **not browser paints or physical-device layout**.

Representative final run, elapsed ms from opening:

| Stage / work | Cold | Warm forced-full comparison, with corrected cache | Warm controlled-recent |
| --- | ---: | ---: | ---: |
| Conversation shell commit | 30.03 | 67.76 | 98.31 |
| First message commit | 287.43 | 67.78 | 98.32 |
| First decrypted commit | 287.46 | 67.78 | 98.32 |
| Subscription requested | 32.93 | 68.67 | 99.30 |
| First REST page | 202.85 | 229.46 | 259.22 |
| Realtime JOIN acknowledged | 204.91 | 238.40 | 268.98 |
| Chosen reconciliation complete | 972.87 | 519.58 | 286.76 |
| Message REST pages | 7 | 7 | 2 |
| Rows transferred | 1,000 | 1,000 | 100 |
| Additional decryptions | 1,000 | 488 | 0 |
| Key lookups | 1 | 0 | 0 |
| Channel joins | 1 | 1 | 1 |
| Component commits counted | 17 | 1 | 1 |

The recent path reads 50 rows per pass. It may perform a second bounded pass when the first finishes before the JOIN ACK, closing the snapshot/subscription gap. The scanner-only regression proves one pass reads exactly 50 across smaller server caps; it does not falsely promise only one request in every channel-start race.

**Interpretation:** cached messages are visible before network work in both warm cases. This benchmark does **not** show a warm shell-paint speedup; jsdom timings vary and that part was already cached. It does demonstrate less redundant network/crypto and faster completion of the chosen reconciliation. Before correcting eviction, the same harness's warm full scan decrypted all 1,000 messages again; corrected retention reduces that to 488, and bounded warm reads to zero in this fixture. No loading animation was added to conceal work.

The initial 150 ms recovery coalescing window is visible in the trace. It is retained to prevent lifecycle reconnect storms; it does not delay the already-rendered warm shell. Realtime startup remains independent of key/history hydration.

### Production diagnosis still required

The live app has not received these working-tree changes. No authenticated live conversation trace, production query plan, production row count or physical iPhone measurement was available. Therefore the exact dominant bottleneck on the reported live device is **NOT established**, and the deployed performance issue is **NOT certified fixed**.

In an approved test build containing this code:

```js
window.__GAYZE_CHAT_TRACE_ENABLED__ = true;
// Click Messages / an existing conversation, wait for history, leave and return.
console.table(window.__GAYZE_CHAT_TRACES__);
window.__GAYZE_CHAT_TRACE_ENABLED__ = false;
```

The in-memory trace is cleared by account/cache cleanup. Inspect the exported stage objects; absence of a new subscription stage on tab return can be correct because the same owner remains subscribed. DOM commit is not paint; correlate with DevTools Performance/Network and actual device observation. No diagnostics ship off-device. The integrated fixture does not certify all App-level auth/navigation races; those remain explicit real-device gates.

### Query, render and cache audit

- Existing required message columns, conversation/member scoping, descending timestamp+ID keyset order, eight-row crypto batches and small-server-cap handling are preserved.
- Cold/authoritative full sweeps remain necessary to catch late/backdated commits and old burn/expiry mutations. **The global feed still does full correctness sweeps**, and notification-list reads still paginate their history. This candidate does not eliminate all large-account backend cost or invent an unverified change-log schema.
- Warm room optimization is conditional on that owner, not a permanent skip-history flag. Legacy consumers without explicit opt-in continue full reads.
- Stable-ID merges keep chronological order and tombstones; changed ciphertext/nonce cannot inherit a different envelope's plaintext/media. Duplicate same-version results do not trigger a new message array.
- No avatar query gates message loading. Unchanged metadata no longer creates new room props on every list poll. The existing five-second metadata poll cadence was not silently changed into stale presence.
- No decrypted history/private keys are moved to service-worker cache, localStorage or a new persistent store. Existing authenticated/cross-origin/non-GET exclusions remain in the worker; only static assets/shell and bounded opaque notification receipts are cached.
- The repo lacks authoritative base `messages`/membership DDL. **No missing production history index has been proved**, so none was guessed/applied. Inspect `messages(conversation_id, created_at, id)` support, membership indexes and RLS plans using `scripts/release-candidate/preflight.sql` plus representative authenticated `EXPLAIN (ANALYZE, BUFFERS)` reads. The notification unread index is justified by the actual new unread queries and verified locally.

## E. Notifications: cause and implementation status

### Foreground cause

The earlier global callback deliberately omitted a toast and assumed OS push would alert. With unavailable/unverified push, only haptic remained. That gap is repaired in the candidate: a generic new-message toast is independent of native configuration and decryption, with account/stable-ID dedup; no extra toast for own/old/expired/burned messages or the room being viewed.

### Current native path

`source INSERT → authenticated sender/recipient validation → durable recipient record → owned dispatch → authenticated existing Web Push/VAPID sender → preferences + current message eligibility → owned PushManager subscription → atomic per-endpoint claim → encrypted provider request → service worker → user-visible notification → safe deep link/read acknowledgement`.

Locally verified: forced own-select RLS; service-only endpoint ledger; database unread counts/read ownership; stable user-ID targeting despite duplicate names; generic payload with opaque correlation IDs; endpoint/key validation; invalid/404/410 cleanup; preference suppression; no record deletion on provider failure; replay claims; worker restart receipts; registration ownership/rotation; foreground handshake and route/login handoff. New tests reject temp-table membership spoofing and invalid intent-recipient pairs.

**Not verified live:** real enrollment, stored production endpoint, deployed migration/function versions, configured matching VAPID pair, provider acceptance, Apple push delivery and physical notification behavior. Local process has no public VAPID build key or server/management credentials. Code/configuration contracts are verified locally; actual production configuration is not.

Worker foreground protocol deliberately retains **one silent OS record plus at most one in-app toast**, not an invisible/silent push that violates the user-visible-only model. Active-room acknowledgement omits the toast. Actual banner behavior is OS-controlled. Old/new version mixtures, acknowledgement timeout, cache eviction and worker storage failures preclude an absolute exactly-once claim. Provider acceptance is not device delivery; test feedback now says so.

At-most-once endpoint attempts avoid ambiguous duplicate retries but may lose an OS alert after an uncertain network response. Persisted notification records survive. Worker receipt-before-display can suppress a retry if `showNotification` fails. These known tradeoffs must be accepted/tested, not disguised as guaranteed delivery.

Remaining source coverage limits from the earlier implementation are unchanged: connection notification is a second authenticated RPC after mutual-match success (crash gap), and a generic interest event has no proven authoritative source contract. No invented trigger was added. New message/Gayze event handling is implemented; drain/sweep scheduling must be verified/installed by an authorized operator.

## F. Database migrations and security/rollback review

### Pending candidate change

`supabase/migrations/20261002100000_durable_notifications.sql` is the **only new/modified migration in the working tree**. No project application by this agent. Check the real migration ledger; local source cannot prove what another operator has deployed.

It depends on the existing base push migration `20260929120000_push_notifications.sql` and URL bridge fix `20261002090000_push_dispatch_url_fix.sql`, plus the actual `messages`, membership, `gazes` and `intents` contracts. The profile/discovery migrations already in main are unchanged; their production application state is unknown. Do not blindly apply all filenames or infer application from a date.

| Review area | Result / constraint |
| --- | --- |
| Own inbox reads | Forced RLS; authenticated SELECT only where `user_id = auth.uid()` |
| Direct client writes | No client INSERT/UPDATE/DELETE grants to new inbox/ledger; owned read RPC only |
| Sender/recipient | Message sender/membership checked; recipients derived from membership; Gayze sender checked; non-null intent must belong to recipient; stable IDs/FKs, no name lookup |
| Definer safety | Restricted EXECUTE grants, fixed search paths with `pg_temp` explicitly last; temporary membership spoof regression passes |
| Endpoint privacy | Delivery endpoint ledger service-only/forced RLS; existing subscription ownership retained |
| E2EE | No plaintext/decryption key added to SQL, payload, logs or receipt cache |
| Dedup | Unique recipient/category/event key; unique notification/endpoint claim; bounded native receipts |
| Indexes | Recipient chronological inbox index; pending dispatch index; new partial `(user_id,category) WHERE read_at IS NULL` index |
| Dispatch | Server secret from Vault; validated HTTPS base; generic warning text; HTTP failure cannot delete/roll back a durable record |
| Capture failure | Failure to persist the notification aborts its source transaction; tested, intentional—not a fabricated success |
| Migration safety | Prerequisites/owned bridge and trigger checks; unknown object collisions fail; transaction rollback regression verifies no half-installed inbox and intact source tables |

Apply only after preflight/RLS review and under a transaction in the authorized release process. Disposable PGlite proves SQL behavior, **not live pg_net/Vault/cron/Re­altime configuration or live source-table RLS**.

### Rollback considerations — no rollback executed or destructive down script supplied

Before rollout, save actual function/trigger/ACL/publication definitions privately; function/job bodies can contain credentials and must not be pasted into this report. If the new sender fails, prefer disabling outbound HTTP dispatch/drain while keeping source capture, inbox records and delivery claims intact. Keep old/new app, worker, function and SQL contracts compatible. Do not restore a legacy event-payload sender behind a new notification-ID bridge without a compatibility plan.

Do not casually drop the inbox or claim ledger: that loses user records/dedup evidence. Do not drop objects still referenced by source triggers: it can break message writes. If structural rollback is unavoidable, preserve records, atomically restore the **actual** previous owned functions/triggers/privileges and coordinate the application version. Prefer a reviewed forward correction to guessing a destructive rollback from repository history.

## G. Required production environment/configuration

| Location | Required configuration |
| --- | --- |
| Public Cloudflare/Vite build | Correct `VITE_SUPABASE_URL`, `VITE_SUPABASE_PUBLISHABLE_KEY` (supported legacy anon-key fallback if used), `VITE_VAPID_PUBLIC_KEY` matching the existing server pair |
| Supabase sender only | `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `SUPABASE_ANON_KEY` for caller-auth connection RPC, `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, valid `VAPID_SUBJECT`, `PUSH_DISPATCH_SECRET` |
| Sender origins | `PUSH_ALLOWED_ORIGINS` exact approved origins; default `https://gayze.co.uk` |
| Vault | `gayze_functions_url` valid HTTPS project/functions base; `gayze_push_dispatch_secret` matching the sender secret |
| Function config | Existing `send-push` has platform `verify_jwt=false` with mandatory handler JWT/dispatch-secret authentication; do not remove that handler boundary |
| Backend | Reviewed/applied migration, source-table RLS, publication, pg_net/Vault setup, scheduler for drain/intent/safety sweeps, eligible persisted recipient endpoints |
| Cloudflare/PWA | Existing worker/site identity, HTTPS, manifest/worker headers, same-origin SPA deep-link fallback, approved OAuth redirects; coordinated app/worker cache update |
| Crypto logging | `ECE_KEYLOG` unset or `0`; never `1` |
| TURN | Existing `webrtc-ice-servers` function contract/configuration must be recovered; actual secret variable names/TTL are unknown and not invented |

Reuse the existing VAPID pair; do not rotate it casually and orphan subscriptions. Private keys, dispatch secrets, TURN credentials, service-role/FCM/APNs secrets must not be `VITE_*`, public bundles or Git. No private values were read/displayed or changed. Management/service/VAPID/dispatch/Cloudflare credentials were absent from this process; that is **not evidence that production has no configuration**.

## H. Tests and classification

### PASS

- `npm run lint` / `npm run typecheck` — TypeScript (the repository lint alias is TypeScript).
- `npm run lint:recovery` — scoped ESLint; includes all changed production files in this pass, including the composer and new services.
- `npm run test:rc` — **11 tests**: warm ownership/fallback/caps/cache retention, trace privacy, metadata no-op/avatar clearing, drawer expansion/draft stability, routing and push feedback.
- `npm run test:chat` — **15 tests**.
- `npm run test:recovery` — **45 tests**.
- `npm run test:notifications` — **32 tests**, including actual local SQL, sender boundaries, rollback and new security regressions.
- `npm run test:push-crypto` — **1 actual offline Web Push crypto test**.
- `npm run check:push-server` — Deno/server typecheck.
- Existing `test:push-sw`, `test:e2ee`, `test:discovery`, `test:interaction` — PASS.
- `npm run bench:rc` and prior `bench:chat` workload coverage — local fixture evidence, not live speed certification.
- Production Vite build; Wrangler 4.145.0 dry run (34 assets, no deployment); `git diff --check`.

### BASELINE FAILURE — rerun, preserved, not hidden

| Suite | Existing failure |
| --- | --- |
| `test:push-sql` | Unexpected `)` in `scripts/push-tests/sql.test.mjs:78` |
| `test:push-e2e` | Unexpected `)` in `scripts/push-tests/e2e.test.mjs:252` |
| `test:inspect-script` | Literal diff/`+` text in SQL; syntax errors |
| `test:profile-migration` | Invalid assignment/diff text at line 70 |
| `test:profile` | Existing nudge/completion failures and undefined `.click()` at line 342 |

No unrelated malformed fixture was rewritten merely to obtain green results. `npm test` remains blocked by these failures. The Node 22 / ZXing >=24 engine warning remains; workflows/dependencies were not upgraded to hide it.

### NEW FAILURE

**None outstanding in the final executed local gates.** A new test reproduced the pre-existing composer reset bug and passed after the targeted fix. An early trace-harness timeout came from its borrowed fake interval environment, not the app; it was corrected to wait for the real recovery callback, and the integrated trace now completes.

### NOT TESTABLE HERE / WITHOUT PRODUCTION OR DEVICE

- Authenticated live latency, actual production base-table RLS/index plans and migration ledger/configuration.
- Real provider/APNs delivery and iPhone permission/install/lock-screen/Focus behavior.
- Physical network transitions, iOS suspension/keyboard and relay credential expiry.
- Browser pixel/geometry verification: no installed browser binary; Playwright Chromium download failed with TLS `ECONNRESET`. jsdom verifies interactions/DOM/CSS contracts, not real viewport geometry. This is an environment limitation, not a passing visual test.

## I. Remaining physical-iPhone gates

Two real accounts/devices must verify:

1. Cold and warm long-history opening, commit-to-paint/scroll smoothness, draft/send/retry, media, chronological backfill, old late commits, burn/expiry and encrypted-key unavailability/recovery.
2. Navigate away/return/reopen repeatedly without duplicate owners or false loss; preserve Online Now, last seen, ghost/incognito and account/sign-out isolation.
3. iOS Home Screen installation, user-gesture permission, persisted endpoint/VAPID match, foreground other-room toast versus active room, background/locked/terminated delivery, Focus and offline return; correlate provider acceptance to actual OS arrival.
4. Mixed/reloaded service-worker versions, bounded replay handling, silent foreground OS record/banner behavior, taps after cold start/login and wrong-account notifications.
5. Short/tall/landscape viewports, keyboard and safe-area/nav overlap, drawer expansion, 44 px controls, Social amber/Right Now purple, indicators and failed/changed avatar presentation.
6. Wi-Fi/mobile transitions, background resumption, relay-only calling and refreshed TURN credentials.

Desktop Chromium cannot replace these checks; it is also needed for real CSS geometry before release.

## J. Remaining TURN issue

The client keeps existing Cloudflare TURN plus public STUN and the existing Supabase `webrtc-ice-servers` invocation. Nothing in this pass changed that provider/architecture. Earlier source/history/branch investigation did not locate the deployed credential function. Real source, authorization, provider-secret location/permissions, response expiry units/TTL and transports remain unverified. Client support for expiry/refresh/restart is locally tested; a 30-second fallback refresh cannot certify an unknown provider lifetime. Recover/audit the deployed function and test real authenticated/unauthorized requests and relay-only expiry/network transitions. See `TURN_CREDENTIAL_CONTRACT.md`.

## K. Work that should NOT be committed

- `patch 1`: unsafe review input, unapplied, identical to current main. Do not add/apply it wholesale; do not stage a synthetic deletion from the tracked-only comparison.
- `.cache/rc-before/` snapshots, validation logs, traces, Wrangler output, build output, node_modules, downloaded browser/tool state and `.wrangler/`. Scratch is locally excluded; not candidate source.
- Credentials, `.env` values, Vault outputs, endpoint tokens, actual user message/profile data, raw authenticated network captures or secret-bearing function/job bodies.
- Unrelated malformed fixture “fixes”, speculative base-schema/index migrations, guessed TURN functions, provider replacements or deployment/workflow changes.
- Blind `git add -A` staging without reviewing mixed App/service/UI files. The entire candidate is uncommitted intentionally; do not classify earlier dirty work as disposable.

The only lockfile changes relative to HEAD remain the prior lint-tool additions; **zero existing locked package entries changed**. The transient Playwright install was `--no-save`, not a new project dependency.

## L. Recommended future commit grouping/order — recommendation only

After review and explicit commit authorization:

1. **Shared recovery/history/E2EE/presence/TURN client integration**, compatible Supabase wrappers/App caller changes, RAM processing/trace services and matching recovery/chat/RC tests; include necessary lint tooling.
2. **Durable notification vertical slice**: pending migration, sender/config, worker, inbox/routing/preferences/targeting/indicators, required App glue and notification/crypto tests.
3. **Independent UI regressions**: composer reset/draft retention, detail-sheet/nav constraint, mobile controls and avatar fallback with their tests.
4. **Operator/readiness documentation and reviewed inventory**: release gates, preflight/rollback/configuration and precise baseline failures.

Several files contain both 1 and 2. Use reviewed hunk staging and run typecheck/build/tests after each proposed group. If a clean dependency-complete split is not feasible, **combine 1 and 2 into one tested integration commit**, rather than manufacturing broken intermediate commits or applying the old patch. Keep tests with their implementation. Database/function/app/worker rollout order is separate from commit order and remains unauthorized.

**Release decision:** keep all rollout gates open. Obtain live plans/traces/configuration and physical-device evidence, resolve or explicitly waive baseline test blockers, and review migration ownership/rollback before declaring production readiness.

## Exact final file table

<!-- FILE_TABLE -->

| Status | File | Earlier scope | This request | Content Δ main |
| --- | --- | --- | --- | --- |
| `M` | `.env.example` | R / N | same | modified: +18/−2 |
| `??` | `docs/CHAT_AUDIT_2026-10-01.md` | C | edited | added: +175/−0 |
| `??` | `docs/PATCH_1_REVIEW.md` | R audit | same | added: +215/−0 |
| `M` | `docs/PUSH_NOTIFICATIONS.md` | N | edited | modified: +97/−249 |
| `??` | `docs/RECOVERY_IMPLEMENTATION_REPORT.md` | R | same | added: +222/−0 |
| `??` | `docs/RELEASE_CANDIDATE_INVENTORY.json` | RC | new | added: +1081/−0 |
| `??` | `docs/RELEASE_CANDIDATE_REPORT.md` | RC | new | added: +328/−0 |
| `??` | `docs/RELEASE_READINESS.md` | R / N | edited | added: +234/−0 |
| `??` | `docs/TURN_CREDENTIAL_CONTRACT.md` | R / N audit | same | added: +63/−0 |
| `??` | `eslint.recovery.config.mjs` | R / N / C tooling | edited | added: +32/−0 |
| `M` | `package-lock.json` | R lint tooling | same | modified: +1554/−0 |
| `M` | `package.json` | R / N / C tooling | edited | modified: +13/−1 |
| `??` | `patch 1` | pre-existing review input | same | identical (unapplied) |
| `M` | `public/service-worker.js` | N / C | same | modified: +50/−5 |
| `??` | `scripts/chat-tests/benchmark.ts` | C | same | added: +49/−0 |
| `??` | `scripts/chat-tests/client.test.mjs` | C | same | added: +96/−0 |
| `??` | `scripts/chat-tests/fixtures.ts` | C | same | added: +34/−0 |
| `??` | `scripts/chat-tests/processing.test.ts` | C | same | added: +129/−0 |
| `??` | `scripts/notification-tests/client.test.mjs` | N | same | added: +149/−0 |
| `??` | `scripts/notification-tests/crypto.deno.ts` | N | same | added: +30/−0 |
| `??` | `scripts/notification-tests/pipeline.test.ts` | N | edited | added: +252/−0 |
| `??` | `scripts/notification-tests/turn-contract.test.ts` | N | same | added: +30/−0 |
| `??` | `scripts/recovery-tests/load-module.mjs` | R | same | added: +26/−0 |
| `??` | `scripts/recovery-tests/recovery.test.ts` | R | edited | added: +397/−0 |
| `??` | `scripts/recovery-tests/security.test.mjs` | R | same | added: +65/−0 |
| `??` | `scripts/recovery-tests/ui.test.mjs` | R | same | added: +116/−0 |
| `??` | `scripts/recovery-tests/webrtc.test.mjs` | R | same | added: +185/−0 |
| `??` | `scripts/release-candidate/history.test.ts` | RC | new | added: +74/−0 |
| `??` | `scripts/release-candidate/preflight.sql` | RC | new | added: +60/−0 |
| `??` | `scripts/release-candidate/trace-chat.mjs` | RC | new | added: +64/−0 |
| `??` | `scripts/release-candidate/traceHarness.ts` | RC | new | added: +8/−0 |
| `??` | `scripts/release-candidate/ui.test.mjs` | RC | new | added: +81/−0 |
| `??` | `scripts/review-patch-1.mjs` | R audit | same | added: +184/−0 |
| `M` | `src/App.tsx` | R / N / C (mixed) | edited | modified: +383/−208 |
| `M` | `src/components/ChatRoomView.tsx` | R / C | edited | modified: +99/−25 |
| `M` | `src/components/DiscoverView.tsx` | N targeting | same | modified: +9/−5 |
| `M` | `src/components/Navbar.tsx` | N indicators | same | modified: +6/−4 |
| `M` | `src/components/NotificationsModal.tsx` | N | edited | modified: +23/−3 |
| `M` | `src/components/RightNowView.tsx` | N targeting | edited | modified: +29/−33 |
| `M` | `src/components/SetIntentSheet.tsx` | UI (tracked base) | newly modified | modified: +18/−4 |
| `M` | `src/index.css` | R chat layout | edited | modified: +33/−0 |
| `??` | `src/services/chatHistoryOwnership.ts` | RC | new | added: +19/−0 |
| `??` | `src/services/chatMessageProcessing.ts` | C | edited | added: +94/−0 |
| `??` | `src/services/chatSubscriptions.ts` | R / C | edited | added: +215/−0 |
| `??` | `src/services/chatTrace.ts` | RC | new | added: +24/−0 |
| `M` | `src/services/conversationRooms.ts` | R / C | edited | modified: +18/−3 |
| `??` | `src/services/iceCredentials.ts` | R | same | added: +54/−0 |
| `??` | `src/services/messageAlerts.ts` | C / N | same | added: +21/−0 |
| `??` | `src/services/messageMerge.ts` | R / C | same | added: +29/−0 |
| `??` | `src/services/notificationInbox.ts` | N | same | added: +58/−0 |
| `M` | `src/services/notificationRouting.ts` | N | edited | modified: +22/−0 |
| `M` | `src/services/profilePhotoService.ts` | C | same | modified: +10/−0 |
| `M` | `src/services/pushService.ts` | N | edited | modified: +14/−8 |
| `??` | `src/services/realtimeRecovery.ts` | R / C | edited | added: +294/−0 |
| `M` | `src/services/supabaseService.ts` | R / N integration | edited | modified: +70/−89 |
| `M` | `src/services/webrtcService.ts` | R | same | modified: +334/−339 |
| `M` | `src/types.ts` | R presence | same | modified: +2/−0 |
| `M` | `supabase/functions/deno.json` | N | same | modified: +1/−1 |
| `??` | `supabase/functions/send-push/handler.ts` | N | same | added: +154/−0 |
| `M` | `supabase/functions/send-push/index.ts` | N | same | modified: +64/−0 |
| `??` | `supabase/migrations/20261002100000_durable_notifications.sql` | N | edited | added: +277/−0 |
| `M` | `vite.config.ts` | R secret guards | same | modified: +19/−2 |

<!-- END_FILE_TABLE -->
