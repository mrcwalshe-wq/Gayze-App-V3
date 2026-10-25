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
