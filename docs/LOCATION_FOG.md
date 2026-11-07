# Location fog

Stored positions are snapped to a grid by the database. Clients send their position; they do not add jitter.

## What changed

| Before | After |
| --- | --- |
| Browser added random jitter (500 m) and re-rolled it on every write; profile position rewritten about every 20 m of movement | Database trigger snaps every write to the centre of a 500 m cell (1 km for `neighborhood`), using a per-member offset from a server-only secret |
| Repeated writes were fresh random samples, so averaging recovered the true point | Same position always stores the same point; averaging gains nothing |
| `discover_right_now` returned `distance_m` from the intent to the intent **owner's** profile point (not the viewer) | Returns viewer-to-intent distance, rounded to 250 m bands (minimum 250 m) |
| Old rows held random-jitter history | Backfill re-snaps every existing intent and profile location |

## Files

- `supabase/migrations/20261107120000_location_fog_coords.sql` — secret table and the pure-SQL snapping function (no PostGIS).
- `supabase/migrations/20261107120100_location_fog_apply.sql` — triggers on `intents` and `profiles`, backfill, new `private.discover_right_now`.
- `scripts/location-fog-tests/` — 12 checks on plain PostgreSQL: `FOG_TEST_DATABASE_URL=... npm run test:location-fog`.

## Verification so far

- 12/12 snapping checks pass on PostgreSQL 16 (determinism, idempotence, accuracy bound, repeat-write stability, secret rotation, API roles locked out).
- Both migrations were run against the live Supabase project inside a transaction that always aborted: 2 triggers created, 0 stored points left unsnapped after backfill, API roles cannot read the secret, and discovery returned a banded viewer distance (1,250 m for a viewer placed 1,200 m away). Nothing was committed; production was re-checked afterwards.
- Not run: the app typecheck and the wider test suite (dependencies were not installed in the build environment), and a real two-device test.

## Rollout

1. Apply both migrations together, in order. The backfill rewrites all rows once.
2. Release the client at the same time. An old client still sends jittered points; they are snapped on arrival, so old clients stay private but add no accuracy.
3. Check the map: markers move to cell centres, so members near each other may share a marker position.

## Known limits

- The secret lives in the database. Anyone with service-role access can compute a member's grid, though not the true point.
- A member who moves across cells shows a stepped trail. That is inherent to any grid.
- The map's privacy circle radius (500/800 m in `RightNowView.tsx`) is drawn for display and does not match the 1 km cell for `neighborhood`; align it in a design pass.
- Discovery calls are not yet rate-limited or logged.
- `distance_m` is band-rounded, but the `p_radius_m` parameter still lets a caller probe distance to a cell centre. Because every stored point is a cell centre, this reveals only what the map already shows.
