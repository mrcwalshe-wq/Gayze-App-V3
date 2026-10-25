# Gayze: what is left to finish (2026-10-25)

Built from the repo, `FEATURE_COMPLETION_MATRIX.md`, `PRODUCTION_COMPLETION_AUDIT.md` and the production checks made so far. "Unverified" means built and tested in isolation but never exercised on a real device or with real accounts.

## 1. Needs you (dashboard or device access I do not have)

| # | Item | Why it matters |
|---|------|----------------|
| 1 | First real sign-in as owner at `/admin` | The admin console has never run against the live function |
| 2 | Install the 7 email templates, SMTP, SPF/DKIM, Site URL and redirect allow-list in Supabase | Emails still show the raw Supabase host; verification and reset flows are unproven end to end |
| 3 | Turn on leaked-password protection | Advisor finding, dashboard-only |
| 4 | Ask Supabase to set `pgrst.db_pre_request = 'public.gayze_pre_request'` | Suspension is enforced on writes, but reads and realtime continue until the token expires (up to 1 h) |
| 5 | Supabase custom auth domain | Google's consent screen shows the Supabase hostname |
| 6 | Allow gayze.co.uk and the Supabase host in the sandbox network policy | Lets me run live smoke tests myself |
| 7 | Two real phones for a messaging and call test | E2EE, calls, push and PWA update are unit-tested only |
| 8 | Decide a minimum-age statement for Terms | None exists today (legal content) |

## 2. Product work, in the order I would do it

1. **Make push notifications reliable.** `test:push-e2e` and `test:push-sw` fail on `main`; production shows deliveries accepted by the push services but receipt on a device is unproven. Foreground banner/unread badge gap reported earlier.
2. **Prove messaging on two real devices** (send, receive, key rotation, locked-chat recovery), then calls (TURN function is deployed, no call has been placed).
3. **Scheduled messages**: the RPCs exist, nothing delivers them. Either build the delivery job or hide the feature.
4. **Later group rooms**: cards say "private group room soon"; RSVP works but there is no room.
5. **Safety**: blocking, reporting and check-ins are in place but nearly empty in production; run each flow once and confirm the admin Reports view shows it.
6. **Account deletion** (`delete-account` v1, never exercised) and admin delete: test on a throwaway account.
7. **Fix the four failing test suites** (push e2e, push SW icons, filter drawer copy, profile Notifications row) so CI means something.
8. **Split `src/App.tsx` (~3,975 lines)** into route modules; it slows every change and hides regressions.
9. **Auth events**: nothing is stored, so failed sign-ins are invisible; call volume is not recorded.

## 3. Design follow-ups

- Bottom sheets (Discover profile, Host an event, Profile edit, Set intent, nearby list) use the same overlay layer as the Send a GAYZE sheet did, which slid under the tab bar. Check each on a phone and move them above the bar where their buttons are hidden.
- Not yet reviewed visually with real data: Discover map with tiles, intent sheets, call screens, Notifications, chat with real history.
- iOS Safari check of the SVG tab-bar edge and the new Messages header.

## 4. Security and platform leftovers

- `spatial_ref_sys` has no RLS and PostGIS lives in `public` (extension-owned; needs a privileged session).
- No auth audit rows are stored.
- Sandbox cannot reach production, so every production claim so far came from Firecrawl, GitHub and Supabase tooling, not a browser.
