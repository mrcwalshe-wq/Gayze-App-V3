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
| Discovery radius | `npm run test:discovery` | The **real** clamp DDL from `supabase/migrations/20260930090000_discover_right_now_radius_cap.sql`, executed in Postgres — plus a proof that the migration cannot touch the live `discover_right_now`. |
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
* **Safety first:** the comment-stripped, *executable* SQL never mentions
  `discover_right_now`; it creates exactly one object (the clamp helper) and
  every `revoke`/`grant` targets only that helper. The live function's DDL is
  not in this repository, so the migration must not be able to replace it.
* `10 km` and `25 km` requests are clamped to `5 km` — they can never succeed.
* `NaN` / `Infinity` / `null` / negative / zero all collapse into 100 m–5 km.
* 1 km and 3 km genuinely narrow the result set (the selected distance matters).
* Expired, paused and the caller's own intents are excluded, even when a wider
  radius is requested.

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
* `test:discovery` runs the clamp DDL verbatim, but the **live
  `discover_right_now` was never executed**. Its DDL is not in this repository
  and this sandbox has no Supabase credentials and no TLS egress to
  `*.supabase.co`. Section [3] is a *specification* test over a geometry-free
  reference query, not a test of the production RPC. Wiring the clamp into the
  live function is an operator step: see
  `supabase/pending/discover_right_now_radius_cap.recipe.sql`.
* `test:interaction` runs in jsdom: there is no real layout, so pixel-level
  rendering and touch gestures are not covered.
