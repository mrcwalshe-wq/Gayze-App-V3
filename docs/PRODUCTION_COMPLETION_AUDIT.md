# Production completion audit

Scope: the admin console, authentication and email, suspension enforcement, security advisors and the evidence for each. Companion files: `TEST_RESULTS.md`, `FEATURE_COMPLETION_MATRIX.md`, `ADMIN_GUIDE.md`, `AUTHENTICATION_AND_DOMAIN_SETUP.md`.

## Architecture (from source)

Vite/React/TypeScript SPA, path-based routing in `src/App.tsx` (no router): `/`, `/messages/:id`, `/notifications`, `/profile`, `/auth/*`, and now `/admin` (lazy chunk). Supabase project `qdewyupsqmtonkloqxsh` (Postgres + RLS, pg_cron, Edge Functions `send-push`, `delete-account`, `verify-device-signature`, `webrtc-ice-servers`, and now `admin-api`). Production is a Cloudflare Worker (`gayze-app-v3`, `https://gayze.co.uk`) deployed by GitHub Actions on merge to `main`; Vercel only reports preview checks. 11 auth users, 10 verified, providers `email` and `google`.

## Findings

| # | Severity | Finding | Evidence | Status |
| --- | --- | --- | --- | --- |
| 1 | High | Eight `SECURITY DEFINER` functions executable by signed-out callers (`discover_right_now`, `register_identity_device`, `verify_peer_identity`, helpers, trigger functions) | Supabase security advisor, `has_function_privilege` | **Fixed** (migration `20261025090000`); advisor re-run shows only PostGIS built-ins and the inert `gayze_pre_request` |
| 2 | Medium | No role model, owner, audit trail or suspension mechanism existed | Schema inspection | **Fixed**: `app_admins`, append-only `admin_audit_log`, `account_restrictions`, service-role-only functions |
| 3 | Medium | Suspension could not be enforced at the database | Reserved `authenticator` role blocks the PostgREST hook | **Mitigated**: auth ban + session deletion + write-guard triggers on 15 tables (active, verified in production, rolled back after). Reads and realtime continue until token expiry (3600 s). Hook **Blocked** |
| 4 | Medium | `spatial_ref_sys` has no RLS | Advisor | **Open**; PostGIS-owned table, needs privileged session |
| 5 | Low | PostGIS installed in `public`; `st_estimatedextent` anon-executable | Advisor | **Open** (extension-owned) |
| 6 | Medium | Leaked-password protection off | Advisor | **Open**, dashboard setting |
| 7 | Low | `webrtc-ice-servers` existed only in the Supabase project, has `Access-Control-Allow-Origin: *`, no per-user limit, only checks JWT validity | Function source | Source now mirrored in the repo; behaviour **unchanged**; open |
| 8 | Medium | Raw Supabase hostname appears in default email links and on Google's consent screen | Template behaviour; OAuth flow | Email: **code ready**, dashboard install needed. Consent screen: needs Supabase custom domain (**Blocked**) |
| 9 | Low | No Auth events stored (`auth.audit_log_entries` empty), so failed sign-ins are invisible | SQL count | Open; admin shows "Unavailable" |
| 10 | Medium | Raw provider errors reached the sign-in screen; expired reset links showed the reset form | Source + browser run | **Fixed** (`authMessages`, `authCallback`; browser-verified for expired link) |
| 11 | Low | Four existing suites fail on unmodified `main` (push e2e, push SW icons, filter drawer/5 km copy, profile Notifications row) | Same counts on `main` and branch | **Open**, uninvestigated |
| 12 | Info | No minimum-age statement in Terms or Community Guidelines | grep | Open (legal content decision) |
| 13 | Info | 9 tables have RLS and no policies | Advisor | Intended (service-only); four are the new admin tables |

## Deliberate decisions

* The `drop function` that triggered the Supabase confirmation prompt was **removed**. The unused three-argument `admin_list_accounts` stays (no dependents in `pg_depend`, function bodies or code; service-role only) and the sortable directory is a distinct function `admin_list_accounts_v2`, so no call can be ambiguous.
* The admin migration already recorded in production history (`20261025064430 admin_console`) was not modified.
* No owner email or UUID is embedded in source or in the frontend. Authorisation is the `app_admins` row only.
* The service-role key is read inside the Edge Function from its environment; no browser file references it (`grep` of `src` and `public` finds none).

## Remaining actions needing someone with access

1. Install the email templates, set Site URL and redirect allow-list, configure SMTP and DNS (see `AUTHENTICATION_AND_DOMAIN_SETUP.md`).
2. Add a Supabase custom auth domain if the Google consent screen must not show the project hostname.
3. Turn on leaked-password protection.
4. Optional: ask Supabase to enable `pgrst.db_pre_request = 'public.gayze_pre_request'` for read blocking.
5. Allow `gayze.co.uk` and the Supabase project host in the sandbox network policy if live smoke tests should run from this environment.
6. Sign in as the owner on `https://gayze.co.uk/admin` and exercise Dashboard, Accounts, Audit (the first real end-to-end run).
