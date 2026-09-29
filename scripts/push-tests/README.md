# Push notification verification harness

Runs the **real** migration (`supabase/migrations/20260929120000_push_notifications.sql`)
on an in-process Postgres (PGlite, real RLS/roles/triggers), and drives the **real**
`src/services/pushService.ts` and `supabase/functions/send-push/index.ts` against it with a
simulated browser PushManager. It is offline; it never talks to Supabase or Cloudflare.

```bash
npm install
npm install --no-save @electric-sql/pglite   # test-only, deliberately not in package.json
node scripts/push-tests/sql.test.mjs
node scripts/push-tests/e2e.test.mjs
```

What it stubs (and therefore does NOT prove): `pgcrypto` / `pg_net` / Vault (stubbed),
Supabase's `auth.uid()` (a GUC-backed stand-in), web-push delivery and the browser's
PushManager. The base schema (`profiles`, `messages`, `conversation_members`, `intents`,
`safety_checkins`) is recreated from what the client code reads/writes, because no DDL for it
exists in this repository. Run the same checks against a real Supabase branch/staging project
before trusting production.
