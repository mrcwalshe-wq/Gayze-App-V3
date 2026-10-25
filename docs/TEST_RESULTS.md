# Test results

Branch `feat/production-completion`, final run on commit `575bae5` plus docs (run started 2026-10-25T13:15Z, Node 22, Linux sandbox). Commands are the repository's own npm scripts. "main" means the unmodified `origin/main` (`1d88cf2`) checked out in a separate worktree and run with the same commands.

## Static checks and build

| Command | Result |
| --- | --- |
| `npx tsc --noEmit` (`npm run lint` / `typecheck` are the same command) | exit 0 |
| `npm run build` | success (`✓ built in 2.65s`); `AdminConsole` is a separate lazy chunk |

## Suites added or extended by this change

| Command | Tests | Result |
| --- | --- | --- |
| `npm run test:admin` (SQL on PGlite with the real migrations: `scripts/admin-tests/sql.test.mjs`; handler: `scripts/admin-tests/handler.test.ts`) | 12 + 18 | **12/12 and 18/18 pass** |
| `npm run test:auth` | 6 | **6/6 pass** |
| `npm run test:email` | 3 | **3/3 pass** |

What they cover: unauthenticated (401), signed-in non-owner (403 + denied audit, no RPC reached), forged body/header role and identity claims, admin-but-not-owner, owner reads, request validation (methods, JSON, unknown/prototype action names, pagination bounds, UUIDs, enums, control characters, 8 KB body cap), hostile search text passed only as a bound parameter, CORS and preflight, rate limits (reads, writes, denied probes), re-authentication window, suspend/reinstate ordering and rollback on failure, session revocation, password reset using the server-side email (body email ignored), delete confirmation, report updates, generic errors with no database text, fail-closed lookups, audit-write failure surfaced, RPC allow-list. SQL: anon/authenticated cannot execute any `admin_*` function or read `app_admins`, `admin_audit_log`, `account_restrictions`, `admin_rate_window`; owner bootstrap rules (zero/duplicate match, unverified, banned, no identity, second owner, unique-owner index) and its audit row; append-only audit log; suspension write guards for direct writes and a `SECURITY DEFINER` function, reinstatement without resurrecting paused intents or deleted push subscriptions; legacy and v2 directory functions coexist without ambiguity; hook enable and rollback statements; LIKE wildcards treated literally; pagination clamps.

## Existing suites

| Command | Branch result | main result |
| --- | --- | --- |
| `test:push-sql` | pass | not rerun (unchanged code) |
| `test:push-e2e` | **fail**: `TypeError: Cannot convert undefined or null to object` (1) | **fail**, same error (1) |
| `test:push-sw` | **fail**: 8 `icon` assertions (message, connection, gaze, interest, intent, intent_expiring, safety, test) | **fail**, 8 failures |
| `test:e2ee` | 5/5 pass | not rerun |
| `test:messaging` | 22/22 pass | not rerun |
| `test:icons` | 7/7 pass | not rerun |
| `test:discovery`, `test:inspect-script`, `test:profile-migration` | pass | not rerun |
| `test:interaction` | **fail**: 9 assertions (5 km ceiling copy, "< 1 km"/"< 3 km" pills, Private filter, drawer close/overlay, bottom action bar) | **fail**, 9 failures |
| `test:profile` | **fail**: 3 Notifications-row assertions + `TypeError ... 'click'` | **fail**, 4 failures |
| `test:timeline` | 7/7 pass | passes on earlier main |
| `test:peek` | 7/7 pass | n/a (added earlier) |

The four failing suites fail with the **same failure counts on unmodified `main`**, so this change did not introduce them. They are real, unfixed defects in either the tests or the app (for example the 5 km filter copy and Notifications row the tests expect); they have not been investigated here and should not be treated as "known good".

## Production checks actually run

| Check | Evidence |
| --- | --- |
| `admin_enforcement` and `suspension_write_guards` migrations applied | `apply_migration` returned success; function and table privileges queried afterwards: no `admin_*` function executable by `anon`/`authenticated`; the four admin tables have RLS on, no policies, no `anon`/`authenticated` select or insert |
| Suspension write guard, production | Transaction that suspended a real member, simulated their JWT claims, attempted a profile update and an intent insert (both refused with `PT403`), updated another member's profile (allowed) and updated as service role (allowed), then raised to roll back. Afterwards `account_restrictions` = 0 rows |
| Pre-request hook function, production | Same rolled-back pattern: active member, other member, anon, no claims, reinstated member all pass; suspended member refused with `PT403` |
| Hook enablement | **Failed**: `"authenticator" is a reserved role, only superusers can modify it`; the database-level alternative returned `permission denied to set parameter "pgrst.db_pre_request"` |
| `admin-api` deployment | Edge Function `admin-api` version 1, status ACTIVE, `verify_jwt: true` |
| Owner bootstrap | Pre-check: exactly 1 matching auth user, email verified, not banned, not deleted, identity `google`, 0 existing admins. After: one `app_admins` row (`role = owner`, `granted_by` null) and one `owner.bootstrap` audit row |
| Security advisors | Re-run after the migrations: `anon` can no longer execute any of the eight application functions. Remaining: `spatial_ref_sys` RLS (PostGIS-owned), PostGIS in `public`, `st_estimatedextent` (PostGIS), `gayze_pre_request` executable by `anon` (inert while the hook is off), leaked-password protection off (dashboard setting) |

## Not run, and why

* **Live HTTP smoke tests against `gayze.co.uk` and the Supabase API from this environment**: the sandbox network policy denies `gayze.co.uk` and `qdewyupsqmtonkloqxsh.supabase.co` (proxy 403). Anything needing a real request, including an authenticated owner call to `admin-api`, is recorded in `PRODUCTION_COMPLETION_AUDIT.md` as unverified. The environment owner can allow those hosts under the environment's network settings.
* **Owner flow, reauth and suspension through the deployed function with a real session**: the owner signs in with Google; no credential for that account is available here.
* **Two-account messaging, calls, push on iOS, installed-PWA behaviour, Google OAuth, email delivery**: need devices, real inboxes and dashboard settings.

## Release verification, 2026-10-26 (branch `verify/release-audit`, base `25a8a02`)

Commands run from the repository root; results as printed.

| Command | Result |
| --- | --- |
| `npx tsc --noEmit -p .` / `npm run build` | pass / pass |
| `npm run test:admin` | handler 21/21 (incl. insights, broadcast.send), insights text and CSV 2/2, SQL 12/12 |
| `npm run test:notices` (new) | 7/7: host cannot leave; join requests (ask, accept, decline, withdraw, rejoin); capacity and full notice once; legacy toggle cannot admit; table closed to direct writes; notices read/mark own only; broadcast targeting; insights definitions; k-suppression |
| `npm run test:push-e2e` | **ALL PASSED** (77 checks). Was failing on `main` |
| `npm run test:push-sw` | pass |
| `npm run test:push-sql` | pass |
| `test:auth` 6/6, `test:email` 3/3, `test:e2ee` 5/5, `test:messaging` 22/22, `test:timeline` 7/7, `test:peek` 7/7, `test:icons` 7/7, `test:discovery`, `test:inspect-script`, `test:profile-migration` | pass |
| `npm run test:profile` | **3 failures, identical on `main` (`25a8a02`, run in a separate worktree)**: permanent Notifications row |
| `npm run test:interaction` | **9 failures, identical on `main`**: filter drawer / 5 km copy / pills |

### Push E2E: root causes found (not weakened)
1. The scenario asserted a client-to-edge "connection" call that production replaced with RPC -> `gayze_notifications` -> trigger -> `pg_net` -> `send-push`. The harness now loads the durable-notification migrations and bridges recorded `pg_net` calls to the real edge handler.
2. A database rebuilt from the repository sent the wrong secret to `send-push` (production authenticates with `gayze_push_dispatch_runtime_secret`; the repository migration never recorded that). Fixed by migrations `20261025130000` and `20261026130000` (identical to what production already runs).
3. The test hook returned `undefined`, so `send-push`'s `__webpush?.() ?? webpush.sendNotification()` ran the real sender as well and every push was counted twice. The mock now returns a truthy value.
4. Several assertions had lost their dispatch / reset lines and could never pass; restored.
5. Real defect found by the test: `sendTestNotification()` replaced the server's honest reason ("Notifications are switched off in your settings.") with a generic "No provider accepted" message. Fixed in `pushService.ts`.
6. A hung browser `unsubscribe()` could hold the registration lock forever; capped at 8 s (kept). Verified a sign-out cleanup and a re-subscribe still proceed after a hang.

What this does not prove: a real phone receiving a push. See the production section.

## Production checks run during this verification (read-only unless stated)

| Check | Evidence |
| --- | --- |
| Frontend serves current main | Production HTML references `index-BcuHkzmP.css`, identical to the local build of `25a8a02`; GitHub run 433 (`25a8a02`) succeeded. The JS filename differs from a local build (`index-DaqaGnF_.js` vs `index-DUABEKmj.js`); CI bakes build-time env into the bundle. Run 432 (`e0f7491`, PR #199) was *cancelled* by the next push; the code is in run 433. |
| Edge functions | `admin-api` v2 and `send-push` v22 ACTIVE; deployed `handler.ts` read back and compared with the repository. `verify_jwt` true / false as designed. |
| Platform gate | Unauthenticated GET to `/functions/v1/admin-api` -> `401 UNAUTHORIZED_NO_AUTH_HEADER`. |
| Live admin API, owner | `admin_audit_log` holds real `success` rows for `reports.list`, `diagnostics.*`, `audit.list`, `metrics` from the owner session (v1). The new v2 actions (`insights`, `broadcast.*`) have **not** been called from a signed-in owner session (this sandbox cannot sign in). |
| Live admin API, non-admin | `admin_audit_log`: `admin.access` / `denied` / `not_an_admin` at 18:55:08 from a signed-in non-admin (second test account). |
| Production logs | 24 h postgres errors are only my own rolled-back test markers and a type error fixed in the same hour; no 5xx; no function errors. |
| Gathering regression (rolled back) | Guest join -> exactly one host notice; host toggle stays attending; other member sees 0 notices. |
| Gathering regression (real use) | A second real account joined two gatherings at 18:55; host notices were created and `push_processed_at` set within ~1 s (push service accepted); the host marked one read at 19:53. |
| Controlled push to the owner | One labelled notice, audience = owner only (broadcast `cb324fb4-...`): `send-push` returned `{"delivered":23}`. All 23 stored iOS endpoints were accepted by the push service; **device receipt not verified by me**. |
| Insights reconciliation | New query vs independent raw queries: sign-up days sum 11 = 11; activity 395 = 181 intents + 160 messages + 54 Gayzes/interests; active members 10 = 10. |

Findings from the production checks are in `PRODUCTION_COMPLETION_AUDIT.md`.

## Not run, and why (this release)
- Signed-in owner session against `admin-api` v2 (no credentials or network egress in the sandbox).
- Real-device push receipt, call audio/video, PWA install/update, iOS Safari rendering.
- Browser print-to-PDF output of the report builder (CSS written and previewed in Chromium only).
