# GAYZE — PWA & Web Push

Real, standards-based Web Push (Push API + Notifications API + Service Worker,
authenticated with VAPID). There is no in-app-only imitation: if the platform
cannot deliver an OS notification, the UI says so instead of faking one.

Production origin: **https://gayze.co.uk**
Worker: `gayze-app-v3`

---

## 1. What is in the repository

| Area | File |
| --- | --- |
| Manifest | `public/manifest.webmanifest` |
| Icons | `public/icons/gayze-{180,192,512}.png`, `public/icons/gayze-512-maskable.png`, `public/apple-touch-icon.png` |
| Service worker | `public/service-worker.js` |
| Static headers | `public/_headers` |
| Worker config | `wrangler.toml` |
| Client push logic | `src/services/pushService.ts` |
| Deep-link mapping | `src/services/notificationRouting.ts` |
| Canonical origin | `src/config/appUrl.ts` |
| Opt-in + preferences UI | `src/components/NotificationsModal.tsx` |
| iOS install nudge | `src/components/InstallPrompt.tsx` |
| Database | `supabase/migrations/20260929120000_push_notifications.sql` |
| Push sender | `supabase/functions/send-push/index.ts` |
| Key generator | `scripts/generate-vapid-keys.mjs` |
| Verification harness | `scripts/push-tests/` (PGlite + simulated device; see its README) |

The icons are rasterised from the existing official Gayze mark
(`public/gayze-logo.jpg`). The logo was not redesigned or recreated.

---

## 2. Generate VAPID keys

```bash
node scripts/generate-vapid-keys.mjs
```

This prints a P-256 application-server key pair.

* `VITE_VAPID_PUBLIC_KEY` — **public**. Embedded in the client bundle at build
  time. Safe to expose.
* `VAPID_PRIVATE_KEY` — **secret**. Supabase Edge Function secret only.
  Never commit it, never put it in a `VITE_*` variable, never log it.

`.gitignore` already excludes `.env*` (except `.env.example`).

---

## 3. Configure secrets

### Frontend (Cloudflare build environment)

```
VITE_VAPID_PUBLIC_KEY=<public key>
```

Vite inlines `VITE_*` at build time, so this must be present in the environment
that runs `npm run build`. Without it the app still builds and runs — the
Notifications sheet simply reports that push is not configured for this build.

### Server (Supabase Edge Function secrets)

```bash
supabase secrets set \
  VAPID_PUBLIC_KEY=<public key> \
  VAPID_PRIVATE_KEY=<private key> \
  VAPID_SUBJECT=mailto:support@gayze.co.uk \
  PUSH_DISPATCH_SECRET=<long random string>
```

`SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` are injected automatically.

### Database (Vault) — used by the dispatch trigger

Dashboard → Project Settings → Vault:

| Name | Value |
| --- | --- |
| `gayze_functions_url` | `https://<project-ref>.functions.supabase.co` |
| `gayze_push_dispatch_secret` | the same value as `PUSH_DISPATCH_SECRET` |

---

## 4. Apply the database migration

```bash
supabase db push
```

Creates, all with RLS forced on:

* `push_subscriptions` — unique on `endpoint`; a user can only select/insert/
  update/delete **their own** rows. Insert is gated by
  `with check (user_id = auth.uid())`, which is what stops one user attaching
  another user's device to their account.
* `notification_preferences` — master switch plus the five categories.
* `notification_dispatch_log` — service-role only, no user-facing policies.
  Used for the "notify once per intent" anti-spam guarantee.

Plus `push_category_enabled()` (server-side preference gate),
`request_push_dispatch()` (pg_net call into the Edge Function) and an
`AFTER INSERT` trigger on `messages`.

### The base schema is NOT in this repository

`profiles`, `messages`, `conversations`, `conversation_members`, `intents`,
`interests` and `safety_checkins` are created outside this repo (see
`docs/BACKEND_REQUIREMENTS.md`), as is the `submit_interest` RPC. The migration
therefore never alters them, and:

* **Preflight** — every object it creates carries a `gayze-push:` comment. If a
  function/table of the same name exists *without* that comment the migration
  aborts before changing anything, instead of overwriting it. (`touch_updated_at`
  is deliberately not used; the push tables have their own
  `gayze_push_set_updated_at()`.)
* **`messages` trigger** — installed only if `public.messages` is a real table
  with `id`, `conversation_id`, `sender_id`; otherwise skipped with a `WARNING`.
  The trigger body can never raise, so it cannot abort a message insert.
* **Sweeps** — no-op with a `WARNING` if their tables/columns are missing.
* **No `interests` trigger.** See "Connection notification" below.

Before applying, confirm in the live project (SQL editor):

```sql
select table_name, column_name from information_schema.columns
where table_schema = 'public' and (
  (table_name = 'messages'         and column_name in ('id','conversation_id','sender_id')) or
  (table_name = 'profiles'         and column_name in ('id','display_name')) or
  (table_name = 'conversation_members' and column_name in ('conversation_id','user_id')) or
  (table_name = 'intents'          and column_name in ('id','user_id','expires_at','is_paused')) or
  (table_name = 'safety_checkins'  and column_name in ('id','user_id','status','expires_at')) or
  (table_name = 'interests')
) order by 1, 2;
```

### Cron sweeps

```sql
select cron.schedule('gayze-intent-expiry', '*/5 * * * *',
                     $$select public.sweep_expiring_intents()$$);
select cron.schedule('gayze-safety-expiry', '* * * * *',
                     $$select public.sweep_expired_safety_checkins()$$);
```

The safety sweep only considers check-ins that expired in the last hour, so the
first run cannot replay old check-ins that were never closed.

---

## 5. Deploy the Edge Function

```bash
supabase functions deploy send-push
```

`verify_jwt` is **off** for this function (see `supabase/config.toml`) because
it authenticates callers itself:

* `x-gayze-dispatch-secret` for database-trigger dispatches, or
* `Authorization: Bearer <user JWT>` for the self-targeted test push.

A user-initiated call can only ever target the verified JWT subject — the
target user is never read from the request body.

---

## 6. Deploy the frontend

```bash
npm run lint
npm run build
npx wrangler deploy
```

Then verify the three public URLs:

```bash
curl -I https://gayze.co.uk/manifest.webmanifest   # application/manifest+json
curl -I https://gayze.co.uk/service-worker.js      # text/javascript
curl -I https://gayze.co.uk/icons/gayze-192.png    # image/png
```

---

## 7. Notification catalogue

| Type | Producer | Title | Click destination | Wired? |
| --- | --- | --- | --- | --- |
| `message` | insert on `messages` (trigger) | New message | `/messages/<conversationId>` | yes |
| `connection` | `submit_interest` RPC result (client -> `send-push`) | New connection | `/messages/<conversationId>` | yes |
| `intent_expiring` | `sweep_expiring_intents()` cron | Your intent is ending soon | `/profile` | yes (needs cron) |
| `safety` | `sweep_expired_safety_checkins()` cron | Gayze safety alert | `/profile` | yes (needs cron) |
| `intent` ("someone is interested") | none yet | Someone is interested | `/right-now` | **no** — needs the `interests` schema / `submit_interest` body |
| `test` | admin/dev button | Gayze notifications are working | `/profile` | yes |

Message bodies are **end-to-end encrypted**. The server stores ciphertext only
and therefore cannot — and does not — put message content in a push payload.
The body is limited to `"<Sender> sent you a message"`.

### Connection notification (mutual interest)

The transition to "mutual" happens inside `submit_interest`, whose definition is
not in this repo, so no table trigger is used (it could miss the transition or
fire on the wrong row). The authoritative signal is the RPC's own result:

1. `submitInterest()` gets `{ mutual: true, conversation_id }`.
2. It calls `send-push` with `{ action: 'connection', conversationId }` and the
   caller's JWT (fire-and-forget; never affects the interest flow).
3. `send-push` verifies the JWT, loads `conversation_members`, requires exactly
   two members including the caller, and derives the recipient (the *other*
   member) itself — the request body never names a recipient.
4. It claims `('connection', conversationId)` in `notification_dispatch_log`
   (anchored to a canonical member so either side contends for the same slot):
   exactly one push per conversation, however often or from whichever side it is
   called.
5. It then applies the recipient's preferences (`push_category_enabled`).

Limitation: a client that never reports the mutual result (app killed between
the RPC returning and the follow-up call) sends no push. If you want that
closed, make `submit_interest` itself call `public.request_push_dispatch(...)`
at the mutual transition once its body is reviewed.

---

## 8. Privacy and security properties

* The VAPID private key exists only in Edge Function secrets.
* The service-role key is never referenced by frontend code.
* RLS is `force`d on every new table; no cross-user read path exists.
* Preferences are enforced **server-side** in `send-push` via
  `push_category_enabled()`, not only in the UI.
* Endpoints reported as `404`/`410` by the push service are deleted
  immediately, so dead devices are not retained.
* **Shared devices / sign-out.** Before the session is removed, sign-out
  (1) unsubscribes this browser from `PushManager` and (2) deletes this
  endpoint's `push_subscriptions` row under the signed-in user's own RLS. Both
  are bounded (2.5 s), independent and non-fatal: a failure can never block
  sign-out, and leaves a `gayze_push_pending_revoke` marker so the browser
  subscription is revoked on the next app start. If a session ends without the
  sign-out handler (remote/global sign-out), the `SIGNED_OUT` event revokes the
  browser subscription locally. The next user never claims an old row: if the
  browser still holds a subscription they do not own, enabling push revokes it
  and mints a fresh endpoint. RLS is unchanged.
* The service worker never caches cross-origin traffic (Supabase REST,
  Realtime, Auth, Storage), never caches non-GET requests, and never caches a
  request carrying an `Authorization` header.
* Push payload URLs are resolved against the worker's own origin. A payload
  cannot navigate Gayze off-origin, and in production cannot resolve to
  localhost.

---

## 9. iOS behaviour

iOS only exposes `PushManager` to a site installed on the Home Screen.

* If Gayze is opened in iOS Safari (not installed), `getPushEnvironment()`
  returns `blockedBy: 'ios-needs-install'` and the UI explains
  *"Add Gayze to your Home Screen to enable notifications."*
* `InstallPrompt` shows a Share → Add to Home Screen nudge. It backs off for a
  week per dismissal and stops entirely after three dismissals.
* Permission is never requested on page load — only from the explicit
  **Enable notifications** tap, which iOS requires.

---

## 10. Acceptance test

1. Open https://gayze.co.uk and sign in with Google.
2. Share → Add to Home Screen.
3. Launch Gayze from the Home Screen.
4. Profile → Notifications → **Enable notifications** → Allow.
5. Confirm a row appears in `push_subscriptions` for your user.
6. Tap **Send test notification** (dev/admin only).
7. Lock the device; the notification appears on the Lock Screen.
8. Tap it — Gayze opens/focuses and routes to the destination.
9. Send a message from a second account and confirm a real OS notification.

The admin test button is gated by `import.meta.env.DEV` or
`localStorage.setItem('gayze_admin', 'true')`.
