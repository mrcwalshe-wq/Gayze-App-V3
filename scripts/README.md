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
