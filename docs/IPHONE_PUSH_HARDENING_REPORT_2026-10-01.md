# GAYZE — iPhone Web Push hardening release report

**Date:** 1 October 2026 (Europe/London)  
**Decision: HOLD — local code gates passed; production and physical-device gates remain open.**

This is the NEW post-hardening report. It supersedes the six open code findings in `IPHONE_PUSH_RELEASE_CHECKLIST_2026-10-01.md`; that checklist and its manifest remain historical evidence, not current validation. No commit, push, deployment, migration application, production notification send or job scheduling was performed. The only Wrangler execution was a **dry run**.

**A physical iPhone has not received a notification in this investigation. Lock-screen/background/closed-PWA delivery is UNVERIFIED, not claimed fixed.**

## 1. Six blockers — implementation and regression results

PASS below means implemented and validated locally against actual source with simulated browser/auth/provider boundaries. It does not mean physical Safari or production verification.

| Blocker | Result | Implementation and evidence |
| --- | --- | --- |
| 1. Receipt only after successful display | **PASS** | SW v4 writes its successful-display receipt after `showNotification` resolves. The new receipt namespace does not trust old premature receipts. Failed display leaves no receipt; same-worker and restarted-worker retries display successfully. Queue recovery survives a rejection. |
| 2. Reliable click fallback and stable conversation | **PASS** | Sender carries conversation UUIDs for messages **and connections**. SW derives the room from that identity, prefers same-origin clients, bounds focus attempts, requests a routing ACK, falls back to URL navigation, then `openWindow`. App ACKs accepted routing and rejects expired requests. Tested focused/unfocused, no-window/cold URL, rejected/hanging focus, unready/old SPA, navigation failure, foreign URLs and login-pending destinations. This is a simulated cold launch, not a physical installed-PWA result. |
| 3. Delivery dedup distinct from visible presentation | **PASS** | Backend claims still prevent repeated application delivery attempts. Every received SW push calls `showNotification`, even with a receipt. Stable notification-ID tags replace the same OS record; replay is quiet, `renotify:false`, and does not ask for another foreground toast. Tests distinguish display API calls from simulated OS records and toast requests. Storage failure/restart does not create a no-display early return. |
| 4. Permission/readiness/persistence ordering | **PASS** | Enable invokes permission synchronously before auth/lock/SW awaits. Already-granted or denied permission is not re-requested; concurrent Enable shares a flight. Encoding checks precede permission mutation. PushManager/persistence wait for worker readiness; a 10-second readiness timeout permits retry. Strict-gesture simulation, refusal, slow activation, granted retry and persistence failure pass. Preference-save failure is no longer reported as full success. |
| 5. Apple hostname contract | **PASS** | Anchored HTTPS `*.push.apple.com` acceptance includes canonical, alternate, nested and case-normalized hosts. Userinfo, nonstandard ports, fragments, HTTP, non-provider hosts, lookalike suffixes and loopback remain rejected. Existing provider coverage and crypto tests remain green. |
| 6. Authenticated launch/resume reconciliation | **PASS** | App starts an auth-scoped lifecycle watcher for launch, visibility/pageshow, focus and online. Healthy registration is a no-op; changed endpoint/keys are persisted before prior-row deletion. Missing browser registration can recover from proven prior enrollment without prompting. Opaque `{userId,rowId}` storage is only a pointer to an RLS-owned row. Account generations, operation serialization, Web Locks, cleanup retry and sign-out invalidation prevent tested stale mutations/duplicate enrollment. Tests cover missed rotation, lost browser subscription, interrupted write/cleanup, stopped watcher, same-account re-login, different accounts, two tabs and auth-listener ordering. |

**Ownership deliberately fails closed:** legacy devices without a saved pointer, cleared storage, a pruned prior row, missing ownership proof or a VAPID key change require explicit Enable. Recovery never guesses another account's/device's ownership. Disabled master preferences do not authorize automatic creation of a replacement subscription. Local storage contains no endpoint, subscription keys, JWT, private key or message text.

The updated `node scripts/release-candidate/iphone-push-audit.mjs` exits **0**, with **no findings**. Its lifecycle integration check is supplemented by behavioral tests, not presented as behavioral proof by itself. `npm run test:push-hardening` passes **37 tests**.

## 2. Requested feature matrix

| Feature | Result | Scope and evidence |
| --- | --- | --- |
| Map → specific Chat | **PASS** | `test:chat-intent` and interaction/RC tests; stable-ID direct opening/reopening and visible mobile conversation preserved. Routing implementation is unchanged by this pass. |
| Live peer Intent banner | **PASS** | Current **other user's** NOW/LATER and Social/Spicy, update/expiry/freshness, peer/account switching and cleanup regressions pass. Banner, composer and intent services unchanged. |
| Foreground notifications | **PASS** | Foreground toast independent of native-push setup; stable message/account dedup; no toast for the actually visible room; mobile list versus open room; quiet native record plus acknowledged app presentation. Device-specific OS banner behavior still requires testing. |
| Background Web Push | **CODE READY — local scope** | All six code blockers pass, including genuine crypto/VAPID verification. **Production verification: UNVERIFIED. Physical iPhone delivery: UNVERIFIED.** |
| E2EE | **PASS** | Existing E2EE suite plus recovery/history regressions and real AES-GCM benchmarks; encrypted persistence, identity/key behavior and chronological message equality preserved. No crypto implementation changed. |
| Presence / last seen | **PASS** | Recovery/privacy and interaction suites: incognito never tracks, visible presence leaves on background and returns on resume, stale events cannot forge recent presence. No presence or Amber-indicator redesign/change. |
| Chat performance | **PASS — local regression/benchmark scope** | Progressive/cached history, no duplicate joins, no repeated warm decryption and scroll/chronology tests pass. Not a production network or physical-iPhone latency guarantee. |
| Web Push ownership and provider cleanup | **PASS** | PGlite RLS/claim ownership; fake-provider 404/410 prune only that subscription. 401/403/429/500/timeout retain it; all preserve the durable notification. Repeated sender invocation produces only one provider attempt in the tested claim contract. |

Cloudflare hosting, Supabase Realtime and Cloudflare TURN remain separate components. No TURN provider, ICE/realtime architecture, crypto design, approved logo/icon, Map/chat design, intent design or presence design was replaced. Existing recovery and authoritative database message/inbox behavior are retained.

## 3. Final validation evidence

Final validation: **25 commands; 20 exit 0, five known baseline suites exit 1.** Commands were run independently so a malformed baseline did not skip relevant coverage.

| Command | Final result |
| --- | --- |
| `npm run test:push-hardening` | PASS — 37 tests |
| `node scripts/release-candidate/iphone-push-audit.mjs` | PASS — zero findings; provider status matrix included |
| `npm run test:notifications` | PASS — 32 tests; includes real migration/handler ownership and message/connection payload identity assertions |
| `npm run test:chat-intent` | PASS — 21 tests |
| `npm run test:rc` | PASS — 11 tests |
| `npm run test:chat` | PASS — 15 tests |
| `npm run test:recovery` | PASS — 45 tests |
| `npm run test:push-sw` | PASS — routing and narrow-fetch assertions |
| `npm run test:e2ee` | PASS — existing E2EE assertions |
| `npm run test:discovery` | PASS — modelled private-function/PGlite boundary, not live PostGIS |
| `npm run test:interaction` | PASS — actual UI interaction assertions |
| `npm run check:push-server` | PASS — Deno sender check |
| `npm run test:push-crypto` | PASS — 2 real Web Push AES128GCM round-trips and ES256 VAPID signature/audience checks, FCM and Apple |
| `npm run lint` | PASS — repository command is TypeScript checking |
| `npm run typecheck` | PASS |
| `npm run lint:recovery` | PASS — scoped ESLint including changed runtime files |
| `npm run bench:chat` | PASS — message equality and cache evidence below |
| `npm run bench:rc` | PASS — cold/warm trace evidence below |
| `npm run build` | PASS — packaging only; local public push build variables are missing |
| `npx --yes wrangler@4.145.0 deploy --dry-run --outdir .cache/push-hardening/wrangler` | PASS — 34 asset files, no new bindings, exited without deployment |

There are **161 TAP-counted targeted tests** in the six counted suites above, plus **2 real Web Push crypto tests**. Legacy assertion-style suites and audit assertions are additional, not inflated into that count. Tests use isolated fixtures; neither provider send nor production SQL was performed. `git diff --check` also passes.

An initial parallel `npx deno` bootstrap returned `deno: not found` for crypto. A sequential retry and the final validation both passed both crypto tests; this was not hidden as a baseline or a successful first run. Dependency installation/test setup passed with zero reported vulnerabilities. Node is 22.22.3; ZXing's existing Node >=24 engine warning remains a production-build-runtime gate.

### Five pre-existing failures — separate, not repaired

| Command | Final reproduced failure |
| --- | --- |
| `npm run test:push-sql` | Malformed `)` in `scripts/push-tests/sql.test.mjs:78` |
| `npm run test:push-e2e` | Malformed `)` in `scripts/push-tests/e2e.test.mjs:252` |
| `npm run test:inspect-script` | Literal diff/SQL text violates SELECT/WITH checks |
| `npm run test:profile-migration` | Invalid assignment/diff text at `scripts/profile-tests/migration.test.mjs:70` |
| `npm run test:profile` | Profile/nudge assertions, then undefined `.click()` at `scripts/profile-tests/profile.test.tsx:342` |

These source files were not edited by this pass. New push tests are separate from the malformed legacy push E2E suite; passing them does not make `npm test` globally green. Baseline disposition remains necessary before release approval.

### Performance measurements (synthetic, not device SLAs)

- 300 actual AES-GCM messages with simulated 4 ms key discovery: reference newest-visible **1576 ms**, optimized **23 ms**; optimized total **105 ms**. Key lookups **300 → 1**; all 300 plaintexts and chronological IDs identical. Warm last-50 processing **0.23 ms**, zero new key lookups/decryptions.
- 1,000-message JSDOM/real-crypto trace with simulated REST/ACK latency: cold first decrypted commit **436.47 ms**, complete history **4232.71 ms**, seven queries and one join. Controlled warm recent scan: first decrypted commit **131.36 ms**, one query/50 rows, **zero decryptions**, one join. Timings reflect local concurrent test load and are not portable performance promises.

## 4. Exact production configuration still required — NOT verified/set

### Cloudflare frontend and device service worker

- Existing Worker **`gayze-app-v3`**, repository root, `npm ci && npm run build`, assets **`dist`**, HTTPS **`gayze.co.uk`**. Reconcile dashboard configuration with `wrangler.toml`; preserve unrelated bindings/routes and prevent unintended automatic deployment.
- Keep `compatibility_date = "2025-09-01"`, `[assets] directory = "./dist"`, `not_found_handling = "single-page-application"`, existing observability/previews configuration. No additional push KV/D1/R2/Queue/Durable Object/service binding or Cloudflare Cron is required.
- Set **build-time public** `VITE_SUPABASE_URL`, `VITE_SUPABASE_PUBLISHABLE_KEY`, **`VITE_VAPID_PUBLIC_KEY`** for the approved production project. The public VAPID key must be the existing valid P-256 key matching sender and enrolled devices. Do not casually rotate it.
- **All three are absent in the effective local production build environment.** The local build passing is not push enrollment readiness; do not ship this artifact as configured. The actual private Cloudflare build environment is unknown, not asserted absent. Runtime variables cannot repair a missing compiled Vite key.
- Confirm `/service-worker.js` is JavaScript with scope `/`, `Service-Worker-Allowed: /` and `Cache-Control: no-cache, must-revalidate`; manifest is `application/manifest+json`; icons are real PNGs; `public/_headers` is copied and honored. Confirm no Access/challenge/cache/redirect rule breaks them.
- Confirm `/messages/<conversation UUID>?notification=<notification UUID>` serves the SPA with path/query intact. After a future approved rollout, verify **active installed-worker v4/code hash**, not merely fetching a new script. Confirm HTML and hashed assets update together.
- The previous audit's public v2/manifest/sign-in-shell/GET observations are historical only. They were not re-used as proof of current deployment, headers, secrets or device activation.

### Supabase `send-push` Edge Function

The sender remains the existing Supabase Edge Function using **`web-push@3.6.7`**, not a new Cloudflare push Worker, native APNs integration, FCM server-key integration or TURN relay.

| Setting | Required location/relationship |
| --- | --- |
| `SUPABASE_URL` | Edge platform environment; approved project, consistent with browser and Vault |
| `SUPABASE_SERVICE_ROLE_KEY` | Edge platform/server only; never frontend/Git |
| `SUPABASE_ANON_KEY` | Edge platform environment; JWT-scoped legacy connection adapter |
| `VAPID_PUBLIC_KEY` | Existing key, exactly matching `VITE_VAPID_PUBLIC_KEY` |
| `VAPID_PRIVATE_KEY` | Matching private half, Supabase Edge secret only |
| `VAPID_SUBJECT` | Real approved contact URI, e.g. approved `mailto:support@gayze.co.uk` |
| `PUSH_DISPATCH_SECRET` | Strong existing server-only secret, matching Vault; do not regenerate blindly |
| `PUSH_ALLOWED_ORIGINS` | Exact approved origin list, default `https://gayze.co.uk`; no wildcard |
| `ECE_KEYLOG` | Unset or `0`, never `1` |

Coordinate `supabase/functions/send-push/index.ts`, `handler.ts`, `supabase/functions/deno.json` and `supabase/config.toml`. `[functions.send-push] verify_jwt = false` is required for database shared-secret calls **only with the sender's internal authentication deployed together**. Never disable the gateway check on an unauthenticated legacy implementation.

Canonical repository-project endpoint: **`https://qdewyupsqmtonkloqxsh.supabase.co/functions/v1/send-push`**. Privately confirm that project is the approved production project. Database POST uses `{notificationId}` and `x-gayze-dispatch-secret`; browser requests use verified JWT plus approved Origin. Admin test authorization is server-controlled `app_metadata.role = admin`, not the UI flag. No secret values should be supplied in chat.

Vault requires exactly one valid entry for each:

- **`gayze_functions_url`**: HTTPS project base (or base plus `/functions/v1`), **not** the full `/send-push` path.
- **`gayze_push_dispatch_secret`**: exactly equal to Edge `PUSH_DISPATCH_SECRET`.

Verify outbound provider HTTPS reachability, including Apple `*.push.apple.com`. Cloudflare hosting, a Realtime connection or a TURN success does not verify this path. Existing authenticated `webrtc-ice-servers`/Cloudflare TURN configuration and credential-expiry contract are unchanged; private broker credentials and production network recovery are not certified by this push pass.

## 5. Exact migrations and jobs still required — NONE applied

No migration was added or modified by this hardening pass. Run the existing read-only `scripts/release-candidate/preflight.sql` and `push-production-preflight.sql` privately on the intended project before any authorized change; these were not run against production here.

| Order | File | Requirement |
| --- | --- | --- |
| 1 | `supabase/migrations/20260929120000_push_notifications.sql` | Verify prerequisite DDL/history; apply only if genuinely absent and compatible |
| 2 | `supabase/migrations/20261002090000_push_dispatch_url_fix.sql` | If pending, apply **before** durable notification migration |
| 3 | `supabase/migrations/20261002100000_durable_notifications.sql` | Existing unapplied candidate; verify absence/history, stage and authorize transactional application |

**Never replay the old URL-fix over the durable migration. Never blanket-apply unrelated migrations.** Check real source column types, membership/notification RLS, authenticated grants, service-role claim privileges, existing triggers/webhooks and `supabase_realtime` publication. Required capabilities: `pgcrypto`, `pg_net`, Supabase Vault and `pg_cron`. Synthetic PGlite safety/rollback tests pass; production schema compatibility remains unverified.

Inspect equivalent jobs before scheduling any; avoid duplicates. Required approved PostgreSQL job definitions (not Cloudflare schedules):

| Name | Schedule | SQL command |
| --- | --- | --- |
| `gayze-notification-drain` | `* * * * *` | `select public.gayze_drain_notifications();` |
| `gayze-intent-expiry` | `*/5 * * * *` | `select public.sweep_expiring_intents();` |
| `gayze-safety-expiry` | `* * * * *` | `select public.sweep_expired_safety_checkins();` |

Use the authorized privileged owner (normally `postgres`), verify active state/run history, and monitor backlog. The candidate does not automatically install these jobs. Drain is limited to up to 100 recent unprocessed/unread records (24-hour window); it is **not** a retry of a previously claimed provider attempt.

## 6. Exact physical iPhone acceptance still required

Use a real iPhone with iOS 16.4+ and the HTTPS **installed Home Screen PWA**. Record iOS version, device, install/active-worker version, time, account IDs and redacted notification/conversation correlation IDs. Never record subscription keys or private credentials. Preserve E2EE recovery material; do not casually clear site data/reinstall.

1. After separately approved coordinated staging/release, confirm public configuration, sender version, Vault, migrations/jobs and live MIME/cache/deep-link behavior. Check installed-worker activation, not just the URL response.
2. Fresh/slow first activation: tap Enable directly. Confirm one permission request, correct account-owned subscription, saved master/category preferences, and no premature success. Test already-granted, refused, dismissed and settings-blocked states without repeated unsolicited prompts.
3. With account A sending to account B on the iPhone, send a **real new message** while B is foregrounded on another screen: one app toast, correct unread state, appropriate quiet native record; viewing that room must not duplicate the toast. Confirm message decryption.
4. Background the installed PWA, lock the iPhone, send a fresh real message, and **observe actual lock-screen/Notification Center arrival** before opening the app. Record Focus/notification settings and correlate DB/provider acceptance with arrival. Acceptance alone is not success.
5. Repeat with all PWA windows closed; record precisely whether backgrounded, closed or force-quit. Test closed and locked independently. No desktop simulation substitutes for these observations.
6. Tap notifications with an existing focused app, background/suspended app, loading/old SPA, no window/cold launch, and signed-out/login recovery. Every tap must open the correct authorized conversation, never another room or off-origin page. Cover connection notifications too.
7. Controlled duplicate provider event in staging: verify visible stable-tag replacement, no duplicate OS records/toasts as supported by that iOS version, and no silent no-display handling. Observe sound/banner behavior; do not infer it from `silent:true` alone.
8. Inject a controlled display failure in an instrumented staging worker, then retry/restart. Confirm no premature successful receipt and successful subsequent display. Restore the approved worker afterward.
9. Rotate/expire a subscription while no window is open, then launch/resume. Confirm current endpoint/key persistence and old-row cleanup with no duplicate live registration. Test recovery after network/persistence/cleanup interruption. If old ownership proof is unavailable, verify clear explicit re-enable instead of reassignment.
10. Test permission revocation, master/category preferences, VAPID mismatch handling and provider 404/410 cleanup. Confirm non-expiry failures do not remove valid subscriptions or durable notifications.
11. Sign out A and sign in B on the shared device, including interrupted sign-out, token expiry, late callbacks and multiple windows. Verify no A notification leakage or old operation revoking B's enrollment. Confirm no unsolicited permission request during recovery.
12. Switch Wi-Fi/mobile, go offline/online, background/resume and reopen chat. Verify stable message order/IDs, no duplicate subscriptions/delivery, accurate presence/last-seen privacy, Map → correct Chat and current peer Intent updates/expiry.

Until real background/closed delivery is observed and documented, **physical iPhone lock-screen delivery remains UNVERIFIED**.

## 7. Remaining release gates and limits

- Obtain explicit release approval only after private production configuration, schema/job preflight, coordinated sender/frontend compatibility and physical iPhone gates are satisfied. HOLD is not lifted by this report.
- Keep the five baseline suite failures visible and separately dispositioned. `npm test` is not globally green.
- Backend claims still provide **at-most-once application attempts**, not exactly-once arrival. A claim-before-send crash or ambiguous timeout can lose an OS alert; known 429/5xx responses are not automatically resent. Durable inbox records survive. Any retry-policy redesign is separate reviewed work.
- Generic-interest capture and the connection second-RPC crash gap remain previously documented limits; no speculative schema/provider replacement was introduced.
- Bounded receipt storage, eviction, dismissed native records and OS policy mean best-effort presentation dedup, not absolute exactly-once display. Native `showNotification` replacement/gesture/closed-app behavior still needs the physical checks above.
- Future coordinated rollback must preserve durable notification records, subscription ownership, keys and database contracts. Do not overwrite the durable dispatch bridge with the older raw-event version or destructively roll back tables to remove an OS-delivery symptom.

## 8. Exact change/provenance inventory

Branch remains **`arena/01a0f3ee-gayze-app-v3`**, HEAD **`1190d6ab220b2658678b66136f95a21810b2f306`**. No reset, branch switch, commit or push. All 74 starting dirty paths still exist. `patch 1` remains untouched/unapplied and excluded from release, SHA-256 **`c17b00ece307a9ff5da5339271c0ec3e7fb253fc7f7d3bcbe605e8dcc5b1540b`**.

The accompanying **`IPHONE_PUSH_HARDENING_MANIFEST_2026-10-01.json`** contains exact current-pass and cumulative paths, current/prior hashes, Git status, validation outcomes, audit/benchmark evidence and proposed commit groups. Its own hash is null to avoid recursive self-hashing. Prior reports/manifests are explicitly historical.

**Final cumulative worktree: 80 files (24 tracked modified, 56 untracked).** Excluding untouched `patch 1`: 79 proposed paths (65 runtime/config/tests; 14 documentation/provenance). This pass changes/adds **18 paths** relative to its starting snapshot:

```text
docs/IPHONE_PUSH_HARDENING_MANIFEST_2026-10-01.json
docs/IPHONE_PUSH_HARDENING_REPORT_2026-10-01.md
docs/PUSH_NOTIFICATIONS.md
package.json
public/service-worker.js
scripts/chat-tests/client.test.mjs
scripts/notification-tests/client.test.mjs
scripts/notification-tests/pipeline.test.ts
scripts/push-hardening-tests/subscription.test.mjs
scripts/push-hardening-tests/worker.test.mjs
scripts/push-hardening-tests/workerFixture.mjs
scripts/push-tests/sw.test.mjs
scripts/release-candidate/iphone-push-audit.mjs
src/App.tsx
src/components/NotificationsModal.tsx
src/services/notificationRouting.ts
src/services/pushService.ts
supabase/functions/send-push/handler.ts
```

Incremental rationale: six runtime files implement worker display/routing, sender host/identity, authenticated enrollment/recovery, App wiring, message typing and modal feedback; `package.json` exposes the new regression command. Regression fixtures/assertions cover changed contracts without editing the five baseline suites. The push guide and new report/manifest document the resulting behavior and remaining gates. Existing migration candidates, dependency lockfile, TURN/ICE, E2EE, presence, Map routing and Intent implementations retain their starting hashes.

Proposed commits **only**, dependent on later explicit authorization:

1. `fix: consolidate recovery, encrypted chat and hardened Web Push candidate` — dependency-complete cumulative runtime/config/test group, including preserved Map/Intent work. Do not cherry-pick only shared App hunks and omit required modules.
2. `docs: record push hardening evidence and remaining iPhone release gates` — documentation/provenance group. Prior reports remain historical, this report is current.

Exact proposed paths are in the new manifest. No commits were made; neither subject claims a verified iPhone fix. Raw command logs are local scratch under `.cache/push-hardening/` (not release files); durable outcomes are embedded in this report and manifest.

Platform references: [WebKit — Meet Web Push](https://webkit.org/blog/12945/meet-web-push/) (user-visible notifications, direct permission gesture and Apple subdomains) and [WebKit — Web Push for iOS/iPadOS](https://webkit.org/blog/13878/web-push-for-web-apps-on-ios-and-ipados/) (iOS 16.4+ Home Screen apps and Focus). These describe platform contracts, not evidence of this deployment's delivery.
