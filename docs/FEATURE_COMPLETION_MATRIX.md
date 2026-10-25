# Feature completion matrix

Classes: **Verified** = implemented and verified by the evidence named; **Unverified** = implemented, not fully verified; **Partial**; **Failing**; **Missing**; **Blocked** = by external access or approval. A passing build or unit test is only counted as verification of the thing it actually exercises. Nothing here claims the whole app works.

## Admin console and security

| Feature | Class | Evidence / gap |
| --- | --- | --- |
| Owner-only authorisation (JWT verified server-side, role from `app_admins`) | Verified (handler + SQL tests); Unverified live | 18 handler tests incl. forged claims, non-owner, admin-not-owner. No real authenticated call to the deployed function could be made from this environment |
| Owner bootstrap | Verified | Production row and audit entry queried after the controlled call |
| `admin-api` deployed | Verified (deployment) | Version 1 ACTIVE, `verify_jwt` true. Not exercised over HTTP |
| Admin tables/functions closed to clients | Verified | Privilege queries on production; SQL tests |
| Audit log append-only | Verified | Trigger test; production trigger present |
| Rate limiting, validation, CORS | Verified (tests) | Handler tests; limiter table exists in production |
| Dashboard, accounts, reports, health, audit UI | Unverified | Rendered against a mocked API at 390/820/1280 px, no overflow or console errors; never run against the real function |
| Suspend / reinstate / end sessions | Partial | Logic and rollback tested on PGlite; write guards verified in production in a rolled-back transaction; ban + session deletion by the function not exercised live. Read blocking (pre-request hook) **Blocked** |
| Password-reset and verification resend from console | Unverified | Handler tested with fakes; email delivery unproven |
| Account delete from console | Unverified | Confirmation logic tested; storage/auth deletion path untested |
| Photo diagnostics | Unverified | SQL tested on stub storage |
| Auth events viewer | Partial | Reports "unavailable": project stores no auth audit rows |
| Call volume metric | Missing | Not recorded server-side |
| Advisor findings | Partial | Eight anon-executable functions fixed; `spatial_ref_sys`, PostGIS schema, leaked-password protection remain (see audit) |

## Authentication

| Feature | Class | Evidence / gap |
| --- | --- | --- |
| Sign in / create account / forgot / reset screens, branding, validation | Unverified | Screens screenshotted at 390 px; error wording and callback logic unit-tested (6 tests) |
| Expired / reused reset link state | Verified (browser, mocked) | Loaded the callback URL with `otp_expired`: "Forgot password" with the expiry message and a new-link button, URL cleaned |
| Token-hash email links | Blocked | Code ready; templates must be pasted in the dashboard |
| Branded emails (7 templates) | Blocked | Generated and tested; not installed; SMTP/SPF/DKIM unverified |
| Email verification flow end to end | Blocked | Needs dashboard + real inbox |
| Google OAuth | Blocked / Unverified | Pre-existing, unchanged flow; consent screen shows the Supabase hostname until a Supabase custom domain exists |
| Session expiry and sign-out notices | Unverified | Logic present, not run on device |
| Suspended-account notice | Unverified | App calls `my_account_status`, which now answers `suspended` from `account_restrictions` itself (migration `20261025121000`, applied; SQL-tested); not run on a device |
| Leaked-password protection | Blocked | Dashboard setting |

## Core product (not changed by this work except where noted; not re-verified end to end)

| Feature | Class | Evidence / gap |
| --- | --- | --- |
| Messaging persistence, E2EE, key versions | Unverified | `test:e2ee` 5/5, `test:messaging` 22/22, chat timeline 7/7. No two-account/device run in a browser. Earlier-reported gap stands |
| Scheduled messages delivery | Partial | RPCs exist; no delivery job (earlier finding) |
| Notifications in-app inbox and unread counts | Unverified | Tables and RPCs present; foreground banner/badge gap reported earlier |
| Web Push delivery | Failing / Unverified | `test:push-e2e` and `test:push-sw` fail (same on main); deliveries "accepted" by push services in production (425 rows), device receipt unproven |
| Expiry-notification scheduler | Verified (job running) | pg_cron job `gayze-expiry-notifications` has run; admin Health lists it |
| WebRTC audio/video | Unverified | TURN function deployed (source now mirrored in repo); TURN secrets presence shown in admin config; no call placed |
| Profile photos, peek | Unverified | `test:peek` 7/7; missing-file diagnostics added; no real-photo run |
| Map, discovery, filters, 5 km cap | Failing | `test:interaction` has 9 failing assertions on the 5 km copy, pills and drawer (same on main); the cap constant exists (`MAX_TRAVEL_DISTANCE_KM = 5`) |
| Intent creation, pause, expiry | Unverified | Expiry scheduler verified; lifecycle not exercised end to end here |
| Profile Notifications row | Failing | `test:profile` 3 failures (same on main) |
| PWA install, service worker updates | Unverified | `SW_VERSION gayze-sw-v24-ios-icon-20261022`; not run on device |
| Blocking, reporting, safety check-ins | Unverified | Tables and RLS present (`blocks`, `reports`, `safety_checkins` empty/near-empty in production) |
| Presence and last-seen privacy | Unverified | `hide_online_status` column honoured by the admin view; not re-tested |
| Account deletion (self) | Unverified | `delete-account` function deployed v1; not exercised |
| Obsolete "swarm" copy | Verified (user-visible) | Only internal identifiers (`SwarmRoom`, tab id `swarms`, variable names) remain; the visible tab label is "Messages" |
| Terms state a minimum age | Missing | `terms.html` and `community-guidelines.html` contain no age requirement; sign-up copy deliberately does not claim one |
