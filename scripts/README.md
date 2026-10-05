# GAYZE test harnesses

All of these are **offline**. None of them talks to Supabase, Cloudflare or a
real push service, and none of them ships in the app bundle.

```bash
npm install
npm run test:setup     # test-only deps, deliberately NOT in package.json
npm test               # every suite below
```

`npm run test:setup` installs `@electric-sql/pglite`, `jsdom`,
`@testing-library/react` and `@testing-library/dom`. They are intentionally
kept out of `package.json` so the production dependency tree stays unchanged.
Run it once per fresh clone; the individual suites need it.

| Suite | Command | What it really runs |
| --- | --- | --- |
| Push — SQL | `npm run test:push-sql` | The **real** migration `supabase/migrations/20260929120000_push_notifications.sql` on in-process Postgres (PGlite) with real RLS/roles/triggers. See `push-tests/README.md`. |
| Push — end to end | `npm run test:push-e2e` | The **real** `src/services/pushService.ts` and `supabase/functions/send-push/index.ts` against that database, with a simulated browser PushManager. |
| E2EE | `npm run test:e2ee` | The **real** `src/services/cryptoService.ts` (WebCrypto AES-GCM + ECDH) across two simulated devices with separate identity stores. |
| Discovery radius | `npm run test:discovery` | The **real** `supabase/migrations/20260930090000_discover_right_now_radius_cap.sql`, executed in Postgres (PGlite) against a faithful stand-in of `private.discover_right_now`. Covers the 5 km cap, its pre-flight drift guards and idempotency. |
| Inspect script | `npm run test:inspect-script` | The **real** `supabase/pending/inspect_discover_right_now.sql`, executed statement by statement in Postgres against stand-in functions, plus a proof that it is read-only. |
| Interaction | `npm run test:interaction` | The **real** `RightNowView` mounted with React 19 in jsdom, driving real clicks against the shipped JSX and Leaflet wiring. |
| Profile migration | `npm run test:profile-migration` | The **real** `supabase/migrations/20261001090000_profile_about_you.sql` executed in Postgres (PGlite) against a legacy `profiles` schema: additive-only scan, existing rows preserved, `profile_intimacy` RLS + visibility enforcement. |
| Profile UI | `npm run test:profile` | The **real** `ProfileView` and `ProfileEditSheet` mounted with React 19 in jsdom: one notification experience, summary sections, completion nudge, sectioned editor. |

## What each suite covers

### `test:e2ee`
* Device A → Device B and Device B → Device A both decrypt (direct ECDH path,
  the one `resolveDirectKey` uses).
* Group key envelopes: a member unwraps, an **unrelated** third device cannot.
* Historical messages decrypt after a reload, including unicode, a media
  payload and a 4 kB body.
* No valid message is ever left showing `[Encrypted message]`, including when
  the device key bootstraps **late** (the retry path in `App.tsx`).
* Rows that genuinely cannot be decrypted (no nonce, wrong conversation) keep
  the placeholder rather than fabricating plaintext.
* AES-GCM tamper evidence: a flipped ciphertext or nonce byte fails rather than
  yielding wrong plaintext.

### `test:discovery`
Runs the migration file verbatim. The migration is a guarded `DO` block that
reads the live wrapper with `pg_get_functiondef()` and re-executes it with one
substring swapped, so the signature, return shape, language, `SECURITY DEFINER`
mode, volatility, `search_path` and owner are all re-asserted **byte-identical**
against values captured from the catalog before the change.
* **10 km and 25 km are indistinguishable from 5 km** — the 9 km and 25 km rows
  are unreachable at any requested radius, and the leak is demonstrated against
  the *unmodified* function first so the fix is shown to be doing the work.
* **500 m, 2 000 m, 4 999 m, 5 000 m and 0 m are unchanged** — compared against
  the same function before the migration ran, not against expected literals.
* **`NULL` still returns nothing.** Postgres `least()`/`greatest()` *ignore*
  NULLs, so the naive `least(greatest(p_radius_m, 0), 5000)` maps NULL to **0**
  (verified in Postgres); the migration's explicit `CASE` keeps NULL as NULL.
* **Negative radii deliberately change**: the live function returned nothing
  (no distance can be `<= -100`); the capped one clamps to 0. This is asserted
  as a change, because asserting "unchanged" would assert the old behaviour.
* Expired, paused and the caller's own intents stay excluded at 25 km, and the
  `Social` / `Private` and intent-name filters are identical before and after.
* **Drift guards**: the migration aborts, leaving the function untouched, when
  the wrapper is missing, when volatility/language/security/`search_path` differ,
  or when the pass-through call is not present exactly once. It is idempotent.
* `private.discover_right_now` is never written to, and the migration contains
  no static DDL at all.

### `test:interaction`
* The 5 km ceiling in the UI: no 10 km / 25 km option exists anywhere.
* The selected travel distance is reported to `App` so live discovery re-runs at
  that radius.
* The map stays pannable (dragging enabled) and **five further GPS fixes produce
  zero camera moves**, while the explicit "Locate me" control still recentres.
* Markers correspond to live intents only; expired, paused and expiry-less
  intents render nothing, and a mid-session expiry tick removes the marker.
* Social / Private intent-mode filtering.
* Drawers open, close and leave **no stale overlay**; backdrop tap dismisses.
* Safe-area insets are applied.

### `test:profile-migration`
* Runs the shipped migration file verbatim. The statement scan proves it is
  **additive only**: `ALTER TABLE … ADD COLUMN`, one new table, one new
  SECURITY DEFINER read path — no existing column, policy or function is
  dropped, altered or replaced, and `discover_right_now` is never mentioned.
* An existing user's row (values, `interests` looking-for selections, trust
  counters) is byte-identical after the migration; every new column is NULL.
* `profile_intimacy`: RLS enabled, exactly one owner policy, CHECK rejects
  visibility values outside `everyone/connections/private`, default is the
  privacy-preserving `connections`.
* `get_profile_intimacy` is exercised through all visibility paths: owner
  always; stranger only for `everyone`; `connections` requires a shared
  conversation (via the live `get_my_conversations()` shape); `private` is
  never overridden. `anon` cannot execute it.
* Idempotent: re-running the migration is a clean no-op.

### `test:profile`
* Notification onboarding is ONE experience: the promotional card renders only
  while push is unsupported-off AND not dismissed AND not subscribed; enabling
  retires it mid-session; dismissal is permanent; the single permanent
  Notifications row opens the existing settings sheet in every state.
* Profile summary sections (Looking for / Interests / Intimacy / My setup /
  Boundaries) render only when they contain information; the intimacy
  visibility badge is shown; the owner always sees their own section.
* Completion nudge: material-first priority order, soft copy, jumps into the
  editor at the first missing section, never blocks the rest of the profile.
* Sectioned editor: all seven sections, chips/toggles over text entry, intimacy
  and role are optional, sensitive visibility defaults to `connections`,
  grouped Save, 18+ age gate, `+ Add interests` progressive disclosure,
  custom interests survive Save, closing a dirty sheet autosaves without
  confirmation dialogs.

### `test:inspect-script`
* `supabase/pending/inspect_discover_right_now.sql` contains **only** SELECT/WITH
  statements — asserted by checking every statement's leading keyword.
* All 8 blocks execute without error against a `plpgsql` stand-in shaped like the
  expected production function.
* Q2 really returns the signature, defaults, `RETURNS TABLE`, `SECURITY DEFINER`
  and `search_path`; Q3 reports security, volatility, language, config, owner and
  effective privileges; Q4 separates IN from `RETURNS TABLE` columns.
* Q8's chunked fallback reassembles **byte-for-byte** into the Q2 output,
  including for a body longer than one chunk (8526 chars / 3 chunks).
* Documents a real Postgres behaviour: `pg_depend` records **no** table
  dependencies for function bodies, so Q6 is a labelled text-scan heuristic
  rather than a catalog query.

## Known limits

* `test:e2ee` simulates `indexedDB` / `localStorage` in memory. Real browser
  key persistence is not exercised.
* `test:discovery` executes the real migration, but **not against the live
  project**. PostGIS is unavailable in PGlite, so `st_dwithin` is modelled as
  `distance_m <= p_radius_m`, and `private.discover_right_now` is a stand-in
  shaped to the behaviour the operator confirmed (caller exclusion,
  `is_paused = false`, `expires_at > now()`, mode/intent filters, radius filter,
  expiry ordering). What is genuinely proven is the thing the migration changes:
  the radius value the private function receives. Post-apply verification
  against the live project is still an operator step — the queries are in the
  migration file's footer.
* `test:interaction` runs in jsdom: there is no real layout, so pixel-level
  rendering and touch gestures are not covered.
