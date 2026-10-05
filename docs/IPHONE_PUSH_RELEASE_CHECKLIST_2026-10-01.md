# Final iPhone push release-readiness checklist

**Date:** 2026-10-01. **Branch:** `arena/01a0f3ee-gayze-app-v3`. **HEAD:** `1190d6ab220b2658678b66136f95a21810b2f306`.

## Release decision: HOLD

**Do not claim iPhone lock-screen delivery is fixed. Do not deploy this candidate as an iPhone-notification fix yet.** No physical iPhone, authenticated provider delivery, production database inspection or private Cloudflare/Supabase configuration verification was available. No commit, push, deployment, migration application, job scheduling or production notification send was performed.

The previous Map → Chat and live peer Intent fixes remain unchanged. This pass preserves all runtime source and pending migrations. It adds audit tooling/documentation and extends an offline crypto test to Apple's endpoint. The additional audit identifies two reproduced failure paths and four platform/lifecycle risks; these are **not** the five baseline test failures.

### Evidence levels

| Requirement | Finding |
| --- | --- |
| Production variables/secrets/keys/jobs | **UNVERIFIED remotely.** Complete required configuration map below; no claim that production has no missing settings. |
| Cloudflare deployment | Publicly fetched SW is **v2**, not local v3. This release's SW behavior is not proven deployed. Private dashboard/build settings remain unverified. |
| PWA metadata and assets | **PASS locally; partial public confirmation.** Manifest content is suitable for a Home Screen app; real PNG dimensions and build copies verified. Actual live MIME/cache headers and installed-client activation unverified. |
| Specific-conversation click | Happy-path warm/cold/auth-reload/local direct-pane tests **PASS**. **FAIL in reproduced stale-window focus case**; readiness race also remains. |
| Foreground dedup | **PASS in current local tests**, including actually visible chat versus mobile list. Not verified on a physical iPhone. |
| Background dedup | Stable server claims and local receipt replay tests **PASS as implemented**, but receipt-before-display and Apple's visible-push requirement prevent iOS readiness sign-off. |
| Expired subscriptions | **PASS locally for safe 404/410 pruning and non-expiry retention.** Re-enrollment after missed endpoint rotation is not automatically repaired on launch. |
| Physical lock-screen delivery | **NOT TESTED — release proof missing.** Provider acceptance, a badge, a local test or a GET response is not delivery proof. |

## 1. What was actually checked against public production

Read-only page retrieval on this date returned:

- `https://gayze.co.uk/service-worker.js`: `SW_VERSION = 'gayze-sw-v2'`, `silent: false`, and no local v3 receipt/foreground-handshake implementation. Both chunks were inspected.
- `https://gayze.co.uk/manifest.webmanifest`: stable production ID `https://gayze.co.uk/`, `start_url: /`, `scope: /`, `display: standalone`, expected icon references.
- `https://gayze.co.uk/messages/00000000-0000-4000-8000-000000000001?notification=00000000-0000-4000-8000-000000000002`: the GAYZE sign-in shell. These are dummy identifiers; no authenticated conversation was accessed. This establishes public deep-link shell reachability, **not** post-login room authorization or correct routing on a physical device.
- `https://qdewyupsqmtonkloqxsh.supabase.co/functions/v1/send-push`: body `{"error":"Method not allowed"}`. The canonical URL returns a function-like method rejection. It does **not** prove sender version, secrets, valid dispatch authorization, VAPID configuration or delivery. The local sender's GET body differs (`POST required`), so this is not proof the local sender is deployed.

Direct sandbox HTTPS probes failed with TLS EOF for both domains. The alternate page-fetch tool obtained the content above but exposes no raw response headers or deployment identity. Therefore **live Content-Type, Cache-Control, Service-Worker-Allowed, HTTP status codes, edge-cache freshness and all regional edges remain unverified**. The TLS failures here are not evidence of a production outage.

No Cloudflare management credentials, Supabase management/service-role/database credentials or VAPID/dispatch secrets were available in the shell. GitHub's Actions-variable listing returned `403 Resource not accessible by integration`; private build configuration could not be inspected. This is an access limitation, not evidence that the live settings are absent. An authorized operator must verify them privately; do not supply secret values in chat.

The **effective local production build environment** has none of `VITE_SUPABASE_URL`, `VITE_SUPABASE_PUBLISHABLE_KEY`, `VITE_VAPID_PUBLIC_KEY`. The repository's public Supabase fallback keeps the app live, but **there is no VAPID fallback**: this locally built artifact cannot enroll for push. Do not ship it unchanged. Cloudflare's actual build environment could differ and remains unverified.

## 2. Runtime findings that must be resolved or explicitly dispositioned

Reproduce with `node scripts/release-candidate/iphone-push-audit.mjs` after the existing dependency setup. It is an **offline audit**, deliberately exits **1** while findings remain, and never sends to a provider. Its output is separate from the normal test suites.

| ID | Evidence | Required action before iPhone sign-off |
| --- | --- | --- |
| `display-receipt-order` — reproduced | `public/service-worker.js:231–240,280,304`: receipt is written before `showNotification`. Injected display failure followed by worker restart/replay yields **zero displayed notifications**, because the failed first receipt suppresses retry. | Do not finalize a successful-display receipt before successful display; preserve serialized processing and stable tags. Add a display-failure/replay regression test. No promise of crash-proof exactly-once display. |
| `click-fallback` — reproduced | `public/service-worker.js:343–347`: rejecting `client.focus()` aborts the click handler; audit observes rejection and **zero fallback windows**. Warm routing posts a message and returns with no SPA-ready acknowledgement. | Handle stale/failing clients and provide a safe same-origin URL fallback to the specific conversation. Confirm warm route acknowledgement or navigate when no handler is ready. Test suspended, uncontrolled/loading and signed-out windows. |
| `apple-visible-replay` — platform-policy risk | Duplicate push event returns before any display at line 280. WebKit requires a user-visible notification for push events; violating `userVisibleOnly` can revoke the subscription. Local dedup tests alone do not prove compliance. | Reconcile replay suppression with Apple's rule; consider stable-tag replacement/quiet replay without another toast, rather than a no-display early return. Test on the physical iPhone. `silent: true` changes sound; it is not a substitute for calling `showNotification`. |
| `permission-gesture` — device risk | `src/services/pushService.ts:313–317` waits for worker registration/readiness before requesting permission. A strict user-gesture simulation fails when readiness resolves after activation. Actual Safari timing was **not** tested. | Request permission in the direct user action before an unbounded readiness wait, or explicitly gate the button on an already-ready worker. Keep user consent and test a fresh/slow first install; do not rely on the worker usually being ready. |
| `apple-host-contract` — compatibility risk | Handler accepts only `web.push.apple.com`; an alternative `*.push.apple.com` endpoint is rejected and would be pruned as invalid. Apple guidance permits endpoints on any subdomain of `push.apple.com`. Canonical host test passes; actual device hostname unknown. | Review a safely anchored Apple-domain allowlist while retaining HTTPS, host/port and SSRF restrictions. Do not prune a legitimate Apple endpoint solely for a narrower-than-provider hostname assumption. |
| `rotation-on-launch` — recovery gap | App has one `resyncSubscription()` call, in `PUSH_SUBSCRIPTION_CHANGED`, and no authenticated startup/resume resync. Worker cannot notify a page when none is open. The comment promising next-launch repair is not implemented. | Implement owner-scoped recovery/re-enrollment without silently opting in another account. Merely calling resync is insufficient if both ownership checks fail because the old endpoint is lost/pruned; surface a clear re-enable action. Test rotation with all windows closed. |

These were not silently patched into the accepted runtime candidate. The six findings are actionable follow-up work, not proof of the cause of the user's particular iPhone failure. Receipt-before-display and at-most-once delivery limitations were already noted in earlier reports; this pass adds concrete failure-path evidence and iOS policy review.

Additional known limits:

- Claims are irreversible **at-most-once application attempts**, not exactly-once arrival. A claim-before-send crash or ambiguous timeout can lose an OS alert. Even known provider 429/5xx responses are not automatically resent; inbox records survive. Approve that trade-off explicitly or design a separately reviewed retry policy.
- A saved browser subscription alone does not prove `notification_preferences.push_enabled` and the category were persisted/enabled. The current Enable UI does not check the preference-save boolean before displaying success; verify saved server preferences in acceptance testing.
- Current reuse does not automatically compare an existing subscription's application-server key to a changed build key. Preserve the existing VAPID pair; rotation requires a planned re-subscription process.
- The connection-notification client-RPC crash gap and missing authoritative generic-interest trigger remain from the prior audit. No guessed migration for the unknown matching/interest schema was introduced.

## 3. Exact Cloudflare configuration

**Architecture:** Cloudflare hosts the HTTPS application and static service-worker file. The service worker **runs on the device**. Supabase Postgres/pg_net and the existing Supabase **`send-push` Edge Function** dispatch Web Push using VAPID. There is no new Cloudflare push-sender Worker in this implementation. Cloudflare TURN is unrelated to notification delivery and remains unchanged.

### Existing Worker/build

- [ ] Use the existing production Worker **`gayze-app-v3`**, not a new Worker, Vercel project or replacement push service.
- [ ] Reconcile the dashboard deployment configuration with `wrangler.toml`: production predates this file. Preserve unrelated existing bindings/routes. Confirm automatic build/deploy triggers will not publish an unauthorized change.
- [ ] Repository root is the build root. Build: **`npm ci && npm run build`**. Assets output: **`dist`**.
- [ ] Future approved deployment uses the existing Wrangler flow; local validation used **Wrangler 4.145.0**. No deploy command was executed without `--dry-run`.
- [ ] Use a supported build runtime; ZXing declares Node >=24. This sandbox validated Node 22.22.3 with that engine warning, so validate the approved production runtime as a separate build gate.
- [ ] HTTPS custom domain is **`gayze.co.uk`**. Preserve its existing DNS/custom-domain binding. If `www` or `workers.dev` is used, confirm canonical redirects or explicitly approve those browser origins in sender CORS/auth settings.

Required relevant configuration already present in `wrangler.toml`:

```toml
name = "gayze-app-v3"
compatibility_date = "2025-09-01"

[assets]
directory = "./dist"
not_found_handling = "single-page-application"

[observability]
enabled = true

[previews]
```

**No additional KV, D1, R2, Durable Object, Queue, service binding, Node-compat flag or Cloudflare Cron Trigger is required by this static-hosting push design.** The dry run saying “No bindings found” is expected, not a missing push binding. Do not add Cloudflare secrets expecting the Supabase sender to read them. Actual dashboard overrides/bindings remain unverified.

### Build-time public variables — Cloudflare Build environment, not only runtime settings

| Name | Required value/relationship |
| --- | --- |
| `VITE_SUPABASE_URL` | Intended production project URL. Repository fallback and probed endpoint use `https://qdewyupsqmtonkloqxsh.supabase.co`; confirm this is the approved live project before any migration. |
| `VITE_SUPABASE_PUBLISHABLE_KEY` | That same project's browser publishable key (or supported anon key), never service role. |
| `VITE_VAPID_PUBLIC_KEY` | **Existing** uncompressed P-256 public key, base64url; must equal the sender's `VAPID_PUBLIC_KEY` and the key used by enrolled subscriptions. Nonempty is not sufficient: check valid key material. |

Set these **before building**. Changing Worker runtime variables cannot repair a public key already missing from a compiled Vite bundle. Never put VAPID private, dispatch, service-role, TURN, FCM server or APNs credentials in `VITE_*` values or Git. There is no native APNs key, Firebase server key or Apple Developer membership requirement for this standards-based Web Push design.

### Static paths and headers

- [ ] Root `/service-worker.js` serves JavaScript, not a rewritten login/index document; scope `/`; live response allows `Service-Worker-Allowed: /` and `Cache-Control: no-cache, must-revalidate`.
- [ ] `/manifest.webmanifest` serves `application/manifest+json`; `/apple-touch-icon.png` and `/icons/*.png` are real PNGs, not SPA fallbacks.
- [ ] Existing `public/_headers` is copied to `dist/_headers` and honored by the actual Cloudflare deployment. No cache rule, redirect, Access challenge or custom Worker intercepts these paths incompatibly.
- [ ] `/messages/<conversation UUID>?notification=<notification UUID>` returns the SPA shell with the path/query preserved. Root and deep-link HTML must not remain pinned to an obsolete hashed bundle after release.
- [ ] After approved deployment, confirm the installed PWA's **active** worker contains the approved v3-or-later implementation. Seeing the new script at a URL alone does not prove activation on the device.

## 4. Exact Supabase sender, secrets, endpoints and database requirements

### Edge Function environment

Deploy the existing `supabase/functions/send-push/index.ts` together with `handler.ts` and the project Deno import configuration in a later authorized release. Verify the deployment version, not just endpoint existence.

| Variable | Location / requirement |
| --- | --- |
| `SUPABASE_URL` | Normally platform-provided Edge Function environment; same intended project. |
| `SUPABASE_SERVICE_ROLE_KEY` | Normally platform-provided, server-only; sender needs its own inbox/claim/subscription access. Never in Cloudflare frontend builds. |
| `SUPABASE_ANON_KEY` | Normally platform-provided; used for the JWT-scoped legacy `action: connection` adapter. Verify it even though the current primary client records connections by RPC. |
| `VAPID_PUBLIC_KEY` | Existing public half; exactly matches Cloudflare build key. |
| `VAPID_PRIVATE_KEY` | Matching P-256 private half; **Supabase Edge secret only**. Server validates the pair before claiming deliveries. |
| `VAPID_SUBJECT` | Valid real contact URI, e.g. operator-approved `mailto:support@gayze.co.uk`; not a localhost contact. |
| `PUSH_DISPATCH_SECRET` | Strong random server-only secret; recommend 32–512 characters, e.g. a 64-character random hex value. Do not regenerate blindly; must exactly match Vault. |
| `PUSH_ALLOWED_ORIGINS` | Exact comma-separated approved origins; default `https://gayze.co.uk`. Explicitly include staging only when approved; no wildcard. |
| `ECE_KEYLOG` | Unset or `0`; **never `1`**. Sender refuses startup when cryptographic key logging is enabled. |

`supabase/config.toml` requires **`[functions.send-push] verify_jwt = false`** for pg_net's shared-secret requests to reach the function. This is safe only with this sender's mandatory internal authentication. Verify the actual deployed function setting and code together; never expose an unauthenticated legacy sender by changing the gateway alone.

Canonical endpoint for the repository's project: **`https://qdewyupsqmtonkloqxsh.supabase.co/functions/v1/send-push`**. The bare `/send-push` path on the project host is not the canonical route.

Database dispatch POST is `{ "notificationId": "<existing durable UUID>" }` with `x-gayze-dispatch-secret`. Browser invocations use a verified user JWT and approved Origin. The new sender intentionally rejects raw legacy `{event: ...}` HTTP requests. Test action requires server-controlled `app_metadata.role === 'admin'`; the local UI admin flag does not authorize it. An ordinary two-account message is the preferred end-to-end test.

Outbound HTTPS from the sender must reach valid subscription push services (Apple/Google/Mozilla/Windows). Do not proxy those browser-owned endpoints through a guessed Cloudflare path. Neither TURN nor a healthy Supabase Realtime socket proves this HTTP path.

### Vault — two exact names

| Vault name | Required content |
| --- | --- |
| `gayze_functions_url` | Prefer the approved canonical project base, e.g. `https://qdewyupsqmtonkloqxsh.supabase.co`, or that base plus `/functions/v1`. **Not** the full `/send-push` URL. The bridge appends the function path. |
| `gayze_push_dispatch_secret` | Exact same value as Edge `PUSH_DISPATCH_SECRET`. One nonempty record for this name. |

Confirm each name exists once, URL shape is HTTPS, project identity is correct, and cross-store secret equality holds. No values were read or configured by this audit. Update existing entries rather than creating duplicate names.

### Exact migrations

The production migration ledger was **not accessible**. Do not infer applied status from filenames or blindly run every pending migration.

| Migration | Release action |
| --- | --- |
| `supabase/migrations/20260929120000_push_notifications.sql` | **Prerequisite**: verify applied DDL/ownership/history. Apply only if actually absent and the base schema/ownership preflight passes. Supplies subscriptions/preferences, helpers, pg_net bridge, legacy trigger and expiry sweeps. |
| `supabase/migrations/20261002090000_push_dispatch_url_fix.sql` | **Prerequisite/order**: verify canonical URL normalization/history; if pending in the approved migration chain, apply before the durable migration. |
| **`supabase/migrations/20261002100000_durable_notifications.sql`** | **New candidate migration required for this release**, if absent. Apply transactionally only after staging and explicit authorization. Adds durable inbox/claims/read RPCs, new capture/dispatch bridge, message/Gayze triggers, connection RPC, drain RPC and inbox publication membership. |

**Never replay the older URL-fix migration over the durable migration**: it would overwrite `request_push_dispatch` with the old raw-event HTTP contract. Do not use an indiscriminate `db push --include-all` to pull unrelated discovery/profile changes into this operation. No new migration was added by this audit.

Before application, inspect actual types/RLS/ownership for `messages`, `conversation_members`, `gazes`, `intents`, `safety_checkins`, `push_subscriptions`, `notification_preferences`, `notification_dispatch_log`; verify UUID/event-column compatibility and absence of conflicting new names. Check existing triggers/webhooks for a second legacy dispatch path. The additive migration intentionally fails on missing prerequisites or unowned collisions; do not remove those guards for convenience.

Verify authenticated users can manage **only their own** subscription/preferences, read **only their own** inbox, and cannot forge inbox content or delivery claims. Service-role sender privileges must exist for all operations. Review `supabase_realtime` publication for inbox catch-up; polling is fallback, not a replacement for source event capture.

Required extensions/capabilities: **pgcrypto**, **pg_net**, **Supabase Vault** (typically `supabase_vault`), and **pg_cron** for the schedules below. Base migration creates pgcrypto/pg_net; Vault configuration and cron scheduling are not automatically installed by the candidate.

### Exact scheduled jobs — in Postgres, not Cloudflare

After privately inspecting existing/equivalent jobs, use these definitions **only if missing or intentionally updating the owned job**, as the approved privileged database owner. Do not duplicate an equivalent differently named job.

```sql
select cron.schedule('gayze-notification-drain', '* * * * *',
  $$select public.gayze_drain_notifications();$$);
select cron.schedule('gayze-intent-expiry', '*/5 * * * *',
  $$select public.sweep_expiring_intents();$$);
select cron.schedule('gayze-safety-expiry', '* * * * *',
  $$select public.sweep_expired_safety_checkins();$$);
```

These statements are **operator instructions, not executed work**. Run jobs as an owner with EXECUTE privileges (normally `postgres`); authenticated/anon roles are deliberately denied. Inspect active status, command identity, execution role and successful run history. The drain processes up to 100 unprocessed/unread records younger than 24 hours per call; monitor backlog/age. It recovers missing HTTP/config dispatch **before endpoint claims**, not a provider attempt already claimed. Immediate message/Gayze dispatch is trigger-driven; cron is the recovery lane. Expiry/safety categories need their own sweep jobs.

Read-only operator checks: existing `scripts/release-candidate/preflight.sql` plus new **`scripts/release-candidate/push-production-preflight.sql`**. The latter reports extension/ledger presence, Vault booleans (never values), privileges, named cron status/history and aggregate pending/delivery counts. It was validated against isolated synthetic PGlite, **not run on production**. Private Edge/Cloudflare configuration, job privileges, duplicate webhooks and raw HTTP response diagnosis still need operator review. Do not paste pg_net bodies/headers, endpoint keys, function definitions containing credentials or Vault values into chat.

## 5. PWA, click, dedup and expired-subscription conclusions

**PWA prerequisites:** HTTPS, iOS/iPadOS 16.4+ Home Screen installation, supported Push/Notification/Service Worker APIs, direct user consent, `userVisibleOnly: true`, and a functioning active worker. Source has capability/standalone checks and installation guidance. Local icons are 180×180, 192×192, 512×512 and 512×512 maskable; public/manifest/SW/header copies match the build. Permission timing and replay policy findings above prevent an unconditional iOS-suitability PASS. `requireInteraction`, badges and sound flags are OS hints, not guarantees of lock-screen placement.

**Click path:** authoritative DB URL → generic encrypted push payload with stable notification/conversation IDs → same-origin worker path → focus/postMessage or openWindow → App route decoder → explicit chat-open request. Auth reload preserves the path/query. Owner-only read acknowledgement and conversation RLS remain required. Existing tests prove this happy path without a real iPhone; stale focus failure and lack of warm-handler acknowledgement remain unresolved.

**Dedup layers:** DB unique recipient/category/event key; atomic notification/endpoint claim before send; stable notification tag/topic; serialized SW handling plus bounded 2,500-receipt cache; account-scoped stable message-ID foreground dedup shared with the SW handshake. One focused-app toast plus a quiet OS record is possible, not a guarantee of zero OS banners. Tags are per notification ID for the new sender, so distinct messages may have distinct OS records; the old worker comment about one record per conversation is not the new payload's actual rule. Receipt eviction/storage failure, crashes, provider behavior and iOS policy mean no exactly-once-arrival claim is justified.

**Expired subscriptions:** real-handler offline status matrix checked 404, 410, 401, 403, 429, 500 and timeout. Only 404/410 are pruned as expired. Auth/rate/server errors and ambiguous timeouts retain the subscription; all cases retain the durable notice and prevent a second claimed endpoint attempt. `index.ts` scopes deletion by subscription ID **and user ID and endpoint**. Existing PGlite ownership/claim tests pass. Invalid keys/hosts are also pruned, making the Apple hostname finding important. Browser sign-out attempts endpoint revocation plus owner-scoped row deletion and records pending cleanup. No real expired Apple endpoint was exercised; closed-app rotation/re-enrollment remains a separate gap.

## 6. Manual iPhone acceptance — only after an approved coordinated release

- [ ] Record iPhone model, iOS version, app origin, frontend revision, active SW version and server deployment revision. Use a current supported iOS; minimum for this flow is 16.4.
- [ ] Visit **https://gayze.co.uk** in Safari → Share → Add to Home Screen → launch **from that icon**, not a normal Safari tab. Sign into the intended test account.
- [ ] Confirm the approved worker is active and the build has the correct public VAPID key. Test a fresh install and a previously installed v2 client updating in place. A returned script or successful build alone is insufficient.
- [ ] Tap Enable notifications in the app and grant permission. Confirm the current account owns the persisted subscription and its valid keys; privately compare the browser application-server key to the approved public key. Do not disclose the full endpoint or auth secret.
- [ ] Confirm saved master push and Messages preferences are enabled. In iPhone Settings → Notifications → Gayze, enable Allow Notifications, Lock Screen/Notification Centre/Banners as desired. Check Focus/Do Not Disturb, Scheduled Summary, connectivity and Apple Watch routing. Do not bypass a user's chosen suppression settings.
- [ ] Use another authorized account/device in an existing E2EE conversation to send a unique message **after** the receiving PWA is backgrounded and the phone locked. Message must not already be read, expired or burned. Provider TTL is 300 seconds; test within that window.
- [ ] Correlate source message → recipient durable notice → pg_net request outcome → sender authorization/config → delivery claim → provider status → actual lock-screen/Notification Centre arrival. Record IDs, times and redacted statuses, not plaintext messages or endpoint secrets. Provider acceptance is not the final check.
- [ ] Tap with the app closed, backgrounded, already open in another chat, still loading, and signed out. After login when needed, confirm the **specific conversation** opens directly; never another conversation or an unexplained list.
- [ ] Foreground another tab and the mobile room list: one appropriate toast for the new message. In the visible matching conversation: no redundant toast. Check SW/Realtime races and stale-window fallback without requiring a second tap.
- [ ] Repeat after worker restart, online/offline transition and Wi-Fi/mobile changes. Check stable-ID replay does not stack/re-alert unexpectedly while satisfying Apple's visible-push policy. Test two devices and shared-device account switching; no cross-account content or enrollment.
- [ ] Safely test subscription expiration/rotation and re-enable behavior, including all windows closed during rotation. Verify 404/410 pruning does not delete inbox records or another user's subscription. No automatic enrollment based solely on an old permission grant.
- [ ] Admin self-test may supplement, not replace, real message delivery. UI local admin flag is not server authorization. Never grant ordinary users an admin role for routine testing.

**Do not start by clearing site data or deleting/reinstalling the PWA:** local E2EE identity/key access may be affected. Verify key backup/recovery first. Prefer checking Settings and updating/reopening the existing installation. Reinstallation is a controlled last-resort test, not a notification fix.

## 7. Coordinated release order and rollback guardrails

1. Resolve/disposition the six runtime/platform findings with regression tests; review the additional delivery-policy/UI caveats. Obtain private configuration/DDL/job evidence. Preserve the existing VAPID pair.
2. Validate the complete stack and the approved build runtime in staging. Confirm production project and migration ledger; take the operator's normal database/config backups. Review old queued raw-event requests, webhooks and running sender version.
3. After explicit authorization, use a coordinated maintenance/cutover plan for DB bridge, sender API and client. Avoid stranding old raw-event pg_net requests against the new ID-only sender; drain/quiesce or provide an explicitly reviewed compatibility strategy. Do not assume arbitrary sender-first or migration-first mixed versions are safe.
4. Apply only the approved pending migrations in order, transactionally; verify objects/privileges and migration history. Deploy the corresponding `send-push` function and settings; validate auth/secret matching and pending-notice recovery before enabling/reconciling jobs.
5. Build the Cloudflare frontend with the correct **public** environment and deploy the approved artifact to the existing Worker. Verify live paths/headers, SW update and installed-client activation. Then perform the physical acceptance matrix above and observe backlog/provider statuses.
6. Roll back as a **coordinated compatible stack**, not by replaying the old bridge over durable capture. Retain durable inbox and claim records; deleting claims to force resend can cause duplicate alerts. No destructive rollback SQL is authorized here. VAPID rotation is not a rollback tool.

Current runtime-source checks still pass, but that does not clear these release gates. Committing for review, authorizing a push that may trigger CI, applying a migration and deploying are distinct approvals; none has been inferred from this audit request.

## 8. Exact files changed by this pass

| Path | Change |
| --- | --- |
| `scripts/notification-tests/crypto.deno.ts` | Extended existing offline real Web Push crypto/signature/audience test to both Google and Apple endpoint origins; ephemeral generated test keys only. |
| `scripts/release-candidate/iphone-push-audit.mjs` | New offline failure-path/compatibility audit and provider-status pruning matrix; exit 1 explicitly reports release findings. |
| `scripts/release-candidate/push-production-preflight.sql` | New read-only operator metadata/config/job checks; no secret values or live execution. |
| `docs/IPHONE_PUSH_RELEASE_CHECKLIST_2026-10-01.md` | This checklist and findings. |
| `docs/IPHONE_PUSH_RELEASE_MANIFEST_2026-10-01.json` | Exact cumulative file inventory, hashes and proposed commit path grouping. |

**No application, service-worker, sender, migration, Cloudflare configuration, package or lockfile changed in this pass.** Only the crypto test differs among the 70 files in the preceding candidate inventory. Scratch evidence/dependency/build output is excluded; `/.cache/` was added only to local `.git/info/exclude`, not a tracked ignore change. Patch 1 is unchanged and remains unapplied/excluded from proposed commits.

## 9. Validation — three separate buckets

### Candidate regression checks: PASS

- `npm run lint`, `typecheck`, `lint:recovery`, `build` and `git diff --check`.
- `test:notifications` **32**, `test:chat-intent` **21**, `test:rc` **11**, `test:chat` **15**, `test:recovery` **45**: **124 passing targeted tests**.
- `test:push-sw`, `test:e2ee`, `test:discovery`, `test:interaction`, `check:push-server` pass.
- `test:push-crypto`: **2 pass**, real AES128GCM encryption/decryption and ES256 VAPID signature/audience validation, Google and Apple origins. No provider contacted.
- `npx --yes wrangler@4.145.0 deploy --dry-run --outdir .cache/iphone-readiness/cloudflare`: PASS, 34 assets, expected no runtime bindings; **not a deployment**.
- New read-only SQL parsed/executed on isolated PGlite with optional schemas absent and with synthetic ledger/Vault/cron metadata. Not proof of production permissions or cron execution.
- Install audit: zero vulnerabilities; existing ZXing Node >=24 warning under Node 22 remains.

### Additional release audit: HOLD / exit 1

`node scripts/release-candidate/iphone-push-audit.mjs` reports exactly the six findings in §2. Safe expiry-status handling passes within that audit. The audit's failure-path evidence is not relabeled as a baseline failure or hidden by green happy-path tests. Log/results scratch directory: `.cache/iphone-readiness/`.

### Five known baseline failures: unchanged and separate

- `test:push-sql`: malformed `)` at line 78.
- `test:push-e2e`: malformed `)` at line 252.
- `test:inspect-script`: literal diff text violates SELECT/WITH checks.
- `test:profile-migration`: invalid assignment/diff text at line 70.
- `test:profile`: existing profile/nudge assertions, then undefined `.click()` at line 342.

All were rerun independently. No unrelated fixture was edited to obtain green results. These failures do not explain or excuse the six additional push audit findings.

## 10. Exact proposed commits — NOT created

Because App/recovery/chat/notification work shares dependencies and files, use two dependency-complete commits rather than pretending the large shared App diff is independent vertical slices. **Complete the push hardening/disposition first and regenerate the manifest if files change.** Do not create an empty “iPhone fixed” commit or promise a hash for a commit that does not exist.

1. **`fix: consolidate recovery, encrypted chat and durable Web Push candidate`** — all runtime/config/dependency files and executable tests/checks in the commit-1 list below. Includes existing Map/direct-chat/Intent work and all required recovery/notification dependencies. Audit tools are not release approval.
2. **`docs: record release evidence and iPhone push deployment gates`** — documentation, inventories and the patch-review utility in the commit-2 list below. Previous inventories remain labeled historical; latest manifest is the grouping source of truth.

Both future commits must remain on `arena/01a0f3ee-gayze-app-v3`. No commit or push has been made. Exclude **`patch 1`**, `.cache/`, build/dist, node_modules, `.env*` other than the placeholder `.env.example`, credentials and private deployment evidence. Only after explicit permission may any push be considered; confirm it will not trigger an unapproved deployment.

Final cumulative worktree: **74 files** (23 modified, 51 untracked). **73 files** are assigned below; `patch 1` is excluded. No staging was performed.

### Commit 1 exact paths (61)

```text
.env.example
eslint.recovery.config.mjs
package-lock.json
package.json
public/service-worker.js
scripts/chat-intent-tests/fixtures.mjs
scripts/chat-intent-tests/service.test.mjs
scripts/chat-intent-tests/ui.test.mjs
scripts/chat-tests/benchmark.ts
scripts/chat-tests/client.test.mjs
scripts/chat-tests/fixtures.ts
scripts/chat-tests/processing.test.ts
scripts/notification-tests/client.test.mjs
scripts/notification-tests/crypto.deno.ts
scripts/notification-tests/pipeline.test.ts
scripts/notification-tests/turn-contract.test.ts
scripts/recovery-tests/load-module.mjs
scripts/recovery-tests/recovery.test.ts
scripts/recovery-tests/security.test.mjs
scripts/recovery-tests/ui.test.mjs
scripts/recovery-tests/webrtc.test.mjs
scripts/release-candidate/history.test.ts
scripts/release-candidate/iphone-push-audit.mjs
scripts/release-candidate/preflight.sql
scripts/release-candidate/push-production-preflight.sql
scripts/release-candidate/trace-chat.mjs
scripts/release-candidate/traceHarness.ts
scripts/release-candidate/ui.test.mjs
src/App.tsx
src/components/ChatRoomView.tsx
src/components/DiscoverView.tsx
src/components/Navbar.tsx
src/components/NotificationsModal.tsx
src/components/PeerIntentBanner.tsx
src/components/RightNowView.tsx
src/components/SetIntentSheet.tsx
src/index.css
src/services/chatHistoryOwnership.ts
src/services/chatMessageProcessing.ts
src/services/chatSubscriptions.ts
src/services/chatTrace.ts
src/services/conversationRooms.ts
src/services/directChatRouting.ts
src/services/iceCredentials.ts
src/services/intentTiming.ts
src/services/messageAlerts.ts
src/services/messageMerge.ts
src/services/notificationInbox.ts
src/services/notificationRouting.ts
src/services/peerIntent.ts
src/services/profilePhotoService.ts
src/services/pushService.ts
src/services/realtimeRecovery.ts
src/services/supabaseService.ts
src/services/webrtcService.ts
src/types.ts
supabase/functions/deno.json
supabase/functions/send-push/handler.ts
supabase/functions/send-push/index.ts
supabase/migrations/20261002100000_durable_notifications.sql
vite.config.ts
```

### Commit 2 exact paths (12)

```text
docs/CHAT_AUDIT_2026-10-01.md
docs/CHAT_INTENT_FOLLOWUP_2026-10-01.md
docs/IPHONE_PUSH_RELEASE_CHECKLIST_2026-10-01.md
docs/IPHONE_PUSH_RELEASE_MANIFEST_2026-10-01.json
docs/PATCH_1_REVIEW.md
docs/PUSH_NOTIFICATIONS.md
docs/RECOVERY_IMPLEMENTATION_REPORT.md
docs/RELEASE_CANDIDATE_INVENTORY.json
docs/RELEASE_CANDIDATE_REPORT.md
docs/RELEASE_READINESS.md
docs/TURN_CREDENTIAL_CONTRACT.md
scripts/review-patch-1.mjs
```

## Sources for platform constraints

- [WebKit: Web Push for Web Apps on iOS and iPadOS](https://webkit.org/blog/13878/web-push-for-web-apps-on-ios-and-ipados/) and [Safari 16.4 features](https://webkit.org/blog/13966/webkit-features-in-safari-16-4/): Home Screen/iOS 16.4+, standard push APIs and Focus/notification behavior.
- [WebKit: Meet Web Push](https://webkit.org/blog/12945/meet-web-push/): user gesture, `userVisibleOnly`, user-visible notifications, subscription revocation for violations, Apple endpoint subdomains and no Apple Developer membership requirement.
- Repository implementation and executed isolated tests are the source for app-specific behavior. Public fetches are explicitly limited to content evidence; no private production configuration or physical device result is inferred from them.
