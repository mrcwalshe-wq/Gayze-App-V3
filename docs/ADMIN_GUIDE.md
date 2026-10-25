# GAYZE owner console: administrator guide

The console lives at **`/admin`**. It is owner-only. There is exactly one owner and no
API to create more administrators.

## How access is enforced

| Layer | Control |
| --- | --- |
| Edge Function gateway | `verify_jwt = true`: a Supabase-issued JWT is required. This alone proves nothing (every member and the public anon key hold one). |
| Edge Function handler (`supabase/functions/admin-api`) | Verifies the bearer token again with `supabase.auth.getUser`, reads the caller's role from `public.app_admins` with the service role, and **denies unless the role is `owner`**. Nothing in the request body, headers, email address or JWT claims is trusted as identity or role. |
| Database | `app_admins`, `admin_audit_log`, `account_restrictions` and `admin_rate_window` have RLS enabled, no policies, and all privileges revoked from `anon`/`authenticated`. Every `admin_*` function is executable by `service_role` only, so calling `/rest/v1/rpc/admin_*` directly is refused. |
| Browser | `/admin` is only a view. A non-owner sees a plain "Page not found" and no data; the link is not shown anywhere in the app. |

Sensitive actions (suspend, reinstate, end sessions, password reset, resend verification, delete) additionally require a **real sign-in within the last 15 minutes**, read from the JWT's `amr` timestamp (a refreshed token does not count). The console prompts "Sign in again" (Google, `prompt=login`) when needed.

CSRF is not applicable: calls authenticate with an `Authorization: Bearer` header, never cookies. CORS allows only `https://gayze.co.uk`, `https://www.gayze.co.uk` and origins listed in the optional `ADMIN_ALLOWED_ORIGINS` secret.

Rate limits (per owner, per minute, in `admin_rate_window`): 120 reads, 20 writes, 10 denied probes. The limiter fails closed.

## Bootstrapping the owner (one time)

The initial grant is a controlled database operation. There is no endpoint for it and the
owner's email/UUID appears nowhere in source code.

1. Apply the migrations in order (see *Deployment order* below).
2. In a privileged database session (Supabase SQL editor, or the deployment tooling) run:

   ```sql
   select public.admin_bootstrap_owner('<owner email>');
   ```

   The function refuses unless **exactly one** auth account matches, its email is verified, it is not
   deleted or banned, it has at least one identity, and **no owner exists yet**. It inserts the
   `owner` row and writes an `owner.bootstrap` audit entry (actor `null`, `db_session_user`, timestamp).
3. Verify:

   ```sql
   select user_id, role, created_at from public.app_admins;
   select id, created_at, action, outcome, metadata from public.admin_audit_log order by id desc limit 3;
   ```
4. Sign in to GAYZE as that account and open `/admin`.

To transfer ownership: delete the `app_admins` row in a privileged session, then run the bootstrap for the new account. That is deliberately not possible from the console.

## Modules

* **Dashboard**: live counts straight from the database. Anything unavailable says "Unavailable"; nothing is estimated. "Active" means `profiles.last_seen_at` inside the window, so members hiding online status are undercounted. Call volume is not recorded server-side and is not shown.
* **Accounts**: search (email, display name, handle, exact user ID), sort, pagination (max 100/page), and a detail view with providers, verification, profile completeness, counts and reports. Passwords, tokens, keys, message content and precise location are never returned.
* **Account actions** (all confirmed and audited):
  * *Suspend* (reason required): bans the auth user (no sign-in, no token refresh), writes `account_restrictions`, pauses live intents, deletes push subscriptions, deletes all sessions. From that moment `gayze_pre_request()` makes PostgREST refuse every REST/RPC call carrying that user's token. The app shows "This account has been suspended" and signs the device out.
  * *Reinstate*: unbans and removes the restriction. Paused intents stay paused and push subscriptions are not recreated; the member re-enables them.
  * *End sessions*, *Send password reset*, *Resend verification* (email is looked up server-side; the browser never supplies an address). Delivery is **not** confirmed by these actions.
  * *Delete account*: type the account's email to confirm. Removes storage files, the auth user and the profile. Reports and audit entries are kept.
  * Administrator accounts and your own account cannot be targeted.
* **Reports**: list, filter, change status (`open`, `reviewing`, `resolved`, `dismissed`). Only what the reporter wrote is shown. Message content is end-to-end encrypted and unavailable to administrators.
* **Health**: failed push deliveries, scheduled jobs and recent failures, authentication events (reports "Unavailable" when the project stores none, which is currently the case), admin API errors, and configuration status (set / not set; values never shown).
* **Audit log**: searchable, paginated, append-only (a trigger rejects `UPDATE` and `DELETE`). Records actor, action, target, outcome (`success`, `denied`, `error`, `reauth_required`) and non-sensitive metadata. Search text and suspension reasons are not duplicated into metadata.

## Known limits (stated plainly)

* After suspension, a device that already holds an access token (default lifetime: 1 hour) is refused by the REST/RPC API immediately, but realtime sockets, Storage and Edge Functions that only check a JWT's signature (for example `webrtc-ice-servers`) can keep working until that token expires. Sessions are deleted so it cannot be renewed.
* `gayze_pre_request` adds one primary-key lookup per API request.
* Auth events are not observable because `auth.audit_log_entries` is empty on this project.

## API contract

`POST {SUPABASE_URL}/functions/v1/admin-api` with `Authorization: Bearer <access token>` and a JSON body `{ "action": "...", ...params }`.

Success: `200 {"ok": true, "data": ..., "auditRecorded": true}`. Failure: `{"ok": false, "error": {"code", "message"}}` with `400 invalid_request`, `401 unauthenticated`, `403 forbidden | reauth_required | origin_not_allowed`, `404 not_found`, `405`, `409 target_is_self | target_is_admin | already_suspended | not_suspended | already_verified | confirmation_mismatch`, `413`, `429 rate_limited`, `500 internal`.

Actions: `whoami`, `metrics`, `accounts.list|detail|photoProblems|suspend|reinstate|revokeSessions|sendPasswordReset|resendVerification|delete`, `reports.list|update`, `audit.list`, `diagnostics.deliveries|jobs|auth|config`.

## Deployment order

1. `20261025090000_security_advisor_hardening.sql`
2. `20261025100000_admin_console.sql`
3. `20261025110000_admin_enforcement.sql`
4. Deploy the `admin-api` Edge Function.
5. Run the owner bootstrap and verify the row.
6. Deploy the frontend.
7. `20261025111000_enable_pre_request.sql` (switches suspension enforcement on). Roll back with `alter role authenticator reset pgrst.db_pre_request; notify pgrst, 'reload config';`.
