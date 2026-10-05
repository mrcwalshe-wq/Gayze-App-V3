# Push notification verification harness

Runs the **real** migrations (`supabase/migrations/20260929120000_push_notifications.sql`
and `20261002090000_push_dispatch_url_fix.sql`, in that order)
on an in-process Postgres (PGlite, real RLS/roles/triggers), and drives the **real**
`src/services/pushService.ts` and `supabase/functions/send-push/index.ts` against it with a
simulated browser PushManager. `sw.test.mjs` loads the **real** `public/service-worker.js`
against a fake `self` and drives its `push` / `notificationclick` / `fetch` handlers.
It is offline; it never talks to Supabase or Cloudflare.

```bash
npm install
npm install --no-save @electric-sql/pglite   # test-only, deliberately not in package.json
node scripts/push-tests/sql.test.mjs
node scripts/push-tests/e2e.test.mjs
node scripts/push-tests/sw.test.mjs
```

> **Status of `e2e.test.mjs`: not part of `npm test`.** The 91 lines added by commit
> `f4a946c` were committed line-reversed and without their setup lines, so the file does not
> parse and the missing setup cannot be recovered from Git. Independently, even the last
> parsing version (`829075c`) fails against the current `send-push` function (it now imports
> `web-push` directly and uses `handler.ts` / `gayze_notifications`, which that harness does
> not model). No assertions were removed or rewritten; the file is left as committed. Current
> push backend behaviour is covered by `test:notifications` and `test:push-hardening`.

Coverage highlights: pg_net dispatch URL normalisation for every plausible
`gayze_functions_url` value (the message-push fix); message / interest / connection /
system / safety / intent-expiry dispatch; exactly-once ledger suppression; preference
gates including the master switch; multi-device delivery (one push per device); stale
endpoint pruning that never touches a healthy device; E2EE payload exclusion (no
ciphertext, nonce, keys or message text in any push); service-worker tap destinations
per event type and the narrow-fetch guarantees.

What it stubs (and therefore does NOT prove): `pgcrypto` / `pg_net` / Vault (stubbed),
Supabase's `auth.uid()` (a GUC-backed stand-in), web-push delivery and the browser's
PushManager. The base schema (`profiles`, `messages`, `conversation_members`, `intents`,
`safety_checkins`) is recreated from what the client code reads/writes, because no DDL for it
exists in this repository. Run the same checks against a real Supabase branch/staging project
before trusting production.
