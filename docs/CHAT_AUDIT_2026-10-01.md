# Chat history, message alerts and navigation audit

> **Controlled release-candidate follow-up (2026-10-01):** See [RELEASE_CANDIDATE_REPORT.md](RELEASE_CANDIDATE_REPORT.md) for the current inventory, warm-history/cache and drawer fixes, migration hardening, latest tests and open release gates. No rollout is authorized.

**2026-10-01 — implementation and local validation, not a production fix certification.**

Branch: `arena/01a0f3ee-gayze-app-v3`  
HEAD remains `1190d6ab220b2658678b66136f95a21810b2f306`.

The existing dirty worktree was preserved. No reset, commit, push, deployment, branch change or database migration application occurred. `patch 1` remains unapplied and unchanged (SHA-256 `c17b00ece307a9ff5da5339271c0ec3e7fb253fc7f7d3bcbe605e8dcc5b1540b`). No provider, branding, Cloudflare configuration or approved icon was replaced. Test fixtures replace network boundaries only; production functionality is not mocked.

This report supersedes the history-performance and foreground-toast descriptions in the earlier recovery/readiness reports. Their production rollout/security/TURN gates still apply.

## 1. Causes established from the current source

| Problem | Concrete cause | Targeted correction |
| --- | --- | --- |
| Recent history appears late | Ascending history scan; one awaited callback at a time; global queue behind decryption | Descending `(created_at,id)` keyset, newest 50 first, subsequent pages up to 200, eight concurrent historical deliveries, task yields; separate serial live lane and per-ID version ordering |
| Repeated key/network work | Inbox resolved ECDH/device/envelope keys per row; active room could repeat the same decrypt; unknown-room hydration overlapped list requests | Shared account/room/public-key/member-scoped RAM key and plaintext work; concurrent metadata loads coalesce; identical REST pages coalesce with independent cancellation |
| Unnecessary inbox crypto | Full old histories decrypted merely to obtain one-line conversation previews | Inbox decodes latest previews, new arrivals and updates to already-loaded messages. Active-room feed handles full history |
| Excess rendering | Per-row array scans/sorts and separate message/room state updates; all history rendered; smooth scroll on every count increase | Frame-sized publishing; one stable-ID map/sort per room/batch; duplicates are no-ops; initial DOM window of latest 100; accessible older-message expansion; preserve reader's scroll position |
| Avatar churn | Duplicate concurrent signing calls; avatar effect depended on the state it updated, including failed resolutions | Unique paths, shared in-flight URL signing, no avatar-state dependency loop; photo failures remain retryable and never gate message delivery |
| No visible incoming toast | Global callback explicitly removed the toast assuming the worker would show an OS banner; only haptic remained | Generic foreground toast before key/metadata/decryption work, independent of native push readiness; stable-ID dedup with the worker path |
| Misleading connection interruption | Healthy-channel observers/inbox invalidations used transport refresh; REST failure or long history could imply socket loss | Data-only `resync()`; coalesced reads without channel replacement; REST retry/backoff on the existing joined channel; history progress renews the stall deadline |

These are source-confirmed defects. There is no production trace proving which network/device event produced every reported symptom.

## 2. History, integrity and cache behavior

- REST selects only the existing message fields required by encryption, ordering, expiry and display. It remains scoped to the membership RPC and/or the selected conversation; RLS is still mandatory.
- Pagination uses timestamp **and** ID in descending order, including equal-timestamp boundaries. It continues through unexpectedly small server page caps, not just a single latest page.
- Initial recent results render before full backfill finishes. Sorting for display remains chronological, independent of decryption completion order.
- A history stall cannot block a different live message. Versions of the same ID remain ordered; stable-ID merges preserve tombstones and authenticated plaintext for the same ciphertext/nonce. A changed ciphertext cannot inherit stale plaintext/media from its old envelope.
- Inbox and active-room subscriptions still use the **same existing Supabase SDK client/recovery implementation**. Exact concurrent REST pages share HTTP; broad inbox queries and single-room queries are not falsely treated as equivalent.
- Full correctness sweeps are intentionally retained on reconciliation. They recover late/backdated commits and old burn/expiry changes without assuming `created_at` is commit order. **This is not a new server-side incremental protocol or elimination of all history bandwidth.** Large-account full scans can still be expensive; UI recent-first loading, crypto cost and redundant state work no longer wait on them. A trustworthy revision/change-log backend contract is needed before safely replacing those sweeps.
- No absence-based history deletion was added. Old displayed history is retained through reconnects.
- Already-loaded rooms remain in App memory across destinations. Reopening renders their recent history immediately while the authoritative scan runs. Initial rendering is capped at 100 rows; “Show older messages” expands by 100 and preserves scroll anchoring. All recovered history remains accessible; this is not a hard 100-message retention limit or a wholesale chat redesign.
- Keys: bounded 64-entry RAM reuse, five-minute successful reuse, brief missing-key retry window; signature includes account, room, public peer key and members. AES-GCM authentication failure evicts the matching key generation for retry. Existing direct/group crypto semantics are unchanged.
- Decrypted work: bounded 512-entry RAM cache, up to two minutes and never beyond message expiry for reuse. Burn/expiry invalidates lookup. Concurrent inbox/room requests share the same promise. This is an optimization cache, not durable message storage or an exactly-once crypto guarantee after eviction.
- Account clear, sign-out, device-identity restore, cache purge and unmount clear the new processor/batcher state as applicable. Retry boundaries and post-await publication check ownership/generation; late results cannot repopulate the cleared cache. Live message/key persistence was not moved to localStorage/sessionStorage or a new database. The existing device identity storage remains unchanged.
- Sends retain their prior stable-ID receipt/retry logic and now share key resolution. Draft retention, burn, expiry, safety code and E2EE regressions continue to pass.

### Query/index audit boundary

The repository explicitly lacks the authoritative base `messages`/membership DDL. Its migrations do not establish the deployed message-history indexes. Therefore **a missing production index is not an established root cause** and no speculative index/schema migration was added.

Before release, an authorized operator should inspect indexes/RLS and the real authenticated query plan, for example:

```sql
-- Read-only inventory; run in the correct project, without sharing secrets.
select schemaname, tablename, indexname, indexdef
from pg_indexes
where schemaname = 'public'
  and tablename in ('messages', 'conversation_members');
```

Check whether an existing index supports `messages(conversation_id, created_at DESC, id DESC)` and whether membership predicates have suitable indexes (including the user's conversation lookup). Use representative first-page and keyset `EXPLAIN (ANALYZE, BUFFERS)` reads under the authenticated RLS context, not only a service-role plan. Verify equivalent existing indexes before proposing DDL. The live schema, query plans, row counts and latency were not accessible here.

## 3. Notification chain: where it stops, what changed

### Foreground — concrete disconnected path repaired

Previously: message INSERT → Realtime or recovered REST row → global App callback → **haptic only, no toast**, because the callback assumed OS push already worked.

Now: an eligible new incoming row → account-scoped stable-message-ID presentation → generic **“New GAYZE message”** toast/haptic when the app is visible/focused and that conversation is not being viewed. Own messages, initial old history, expired/burned rows and duplicate IDs do not create extra alerts. Metadata/key failure does not suppress the generic alert. Viewing the active room acknowledges the presentation without an extra toast.

This in-app feedback does not require Notification permission, VAPID, a PushManager endpoint or the pending notification migration. Existing settings are explicitly labelled **Push notifications**; native master/category preferences remain enforced by the server, not repurposed to gate message rendering.

### Native background push — implemented chain, not proven live

The current source connects:

`messages INSERT → membership-derived recipient → durable gayze_notifications row → owned dispatch trigger/HTTP bridge → authenticated send-push → preferences + eligibility → owned PushManager endpoint + atomic claim → encrypted VAPID Web Push → browser push service (Apple endpoint on supported iOS) → worker showNotification → safe conversation deep link`.

The notification record/unread count remain database-authoritative. Provider failure never deletes the record. Existing Web Push is retained; this is **not** a native APNs-token/FCM architecture replacement.

Known local blockers / limits:

1. Only `.env.example` is present; `VITE_VAPID_PUBLIC_KEY` is absent from the process environment. This local build cannot complete push enrollment even if installation/capability/permission checks pass: `subscribeToPush()` stops at its `not-configured` preflight.
2. Supabase management/service-role, VAPID server keys/subject, dispatch secret and Cloudflare API token are unavailable in this environment. No values were requested, displayed or changed.
3. The durable-notification migration remains **unapplied**, and the working-tree sender/worker/app changes have **not been deployed**. The production database/function/configuration state cannot be inferred from the local files.
4. No real subscription, provider acceptance receipt, APNs delivery or physical iPhone alert was observed. The **exact production native failure hop remains unverified**; claiming it is fixed or blaming APNs would be unsupported.

Enrollment/permission/storage code was inspected: iOS install gate, user-gesture permission request, public VAPID subscription, authenticated endpoint ownership, subscription persistence, opt-in-only rotation, shared-device ownership and sign-out revoke behavior remain intact. Correct browser permission alone is not proof of a stored, owned endpoint or a working sender.

### Foreground/native coordination

- Sender includes only opaque DB-derived message, conversation and recipient IDs for correlation; never plaintext or keys.
- The worker asks a visible, focused app to present/acknowledge that message via MessageChannel. App validates account and IDs, plus a 300 ms presentation deadline. The worker waits at most 400 ms.
- Acknowledged messages still produce **one user-visible OS notification record, with `silent: true`**, satisfying the existing user-visible-only push model; the app shows at most one toast for the same message ID. Active-room acknowledgements suppress the extra toast too.
- Missing/old/unresponsive clients or no acknowledgement fall back to normal OS presentation. The foreground deadline prevents a delayed request from generating a late competing toast after that fallback.
- `PUSH_RECEIVED` records a native presentation receipt in account-local RAM, so foreground REST catch-up does not toast that already-presented message again. IDs received for another account are not acknowledged by the app.
- Existing bounded persistent worker receipts suppress native replay across worker restarts; server endpoint claims remain authoritative. No plaintext is added to those receipts.

**Limits:** one in-app toast plus one silent OS record is deliberately not zero OS presentation in foreground. Actual banner/sound behavior is OS-controlled and needs iPhone verification. Mixed old/new deployed sender/worker/app versions lack full correlation. Browser storage eviction, bounded receipts, acknowledgement timeout/races and at-most-once provider claims do not permit an absolute exactly-once/guaranteed-delivery claim. Existing ambiguous-send/showNotification-failure tradeoffs remain documented in `PUSH_NOTIFICATIONS.md`.

## 4. Connection, presence and TURN

- App owns the inbox, signalling and presence above the chat view. Their effect dependencies exclude `activeTab`; routing away is not an offline signal. The active room's owner is keyed by room/account, not component tab visibility. The selected room and loaded history survive navigation.
- Attaching a second observer now reads data without replacing a healthy channel. Notification table invalidations/read acknowledgements likewise resync data rather than churning subscriptions.
- A joined socket with REST failure reports message recovery and retries the read with backoff. It is not declared disconnected solely because REST/key/history work is incomplete. The 60-second deadline measures a **stall**, renewed by successful message pages/batches, rather than total history duration.
- `connected` still requires a joined channel and a completed reconciliation. Actual SDK errors, failed/stalled joins, network loss, browser background, expired credentials and account changes retain the existing recovery/parking/cleanup behavior. SDK heartbeat/token refresh remain owned by Supabase; no second WebSocket or fabricated heartbeat was added.
- Amber **Online now** continues to come from the actual presence set; last seen comes from server profile metadata, never a message timestamp. Ghost/incognito/unhydrated privacy is still protected. Message-sync status does not determine peer online status.
- Existing Cloudflare TURN/STUN/ICE configuration and prior source investigation were reviewed; they remain unchanged. TURN supplies WebRTC media relay credentials, not Supabase chat history or push delivery. The deployed TURN function source/real TTL/authentication are still missing evidence; see `TURN_CREDENTIAL_CONTRACT.md`. No coturn, new provider, secret-bearing public env or Vercel path was introduced.

## 5. Reproducible local performance evidence

Run `npm run bench:chat`. It uses the real scanner, processor, AES-GCM and merge functions with **300 generated encrypted fixture messages and a simulated 4 ms key-discovery delay**. The baseline models the audited serial/per-row key/decrypt/merge behavior; it is not a recording of the deployed app. No production request is made. UI commit timing here is the batch-publisher boundary, not measured browser paint.

Recorded run:

| Metric | Modeled serial baseline | Optimized path |
| --- | ---: | ---: |
| Newest message published | 1,509 ms | 39 ms |
| Complete fixture processing, including final flush wait | 1,509 ms | 105 ms |
| Key lookups | 300 | 1 |
| State merges | 300 | 4 |
| AES-GCM decryptions | 300 | 300 |
| Warm last-50 cache reads | — | 0.18 ms, no additional key/decrypt calls |

All 300 chronological IDs and plaintexts matched. Timings vary with local load; the workload reduction is deterministic. This **does not establish production or physical-device speed**.

Additional tests execute the real chat component in jsdom: 1,000 loaded messages initially produce 100 message bodies, older expansion produces 200 in chronological order, scroll anchoring is retained, warm reopen shows cached messages while syncing, and Online now survives history sync status. jsdom is not a real layout/paint/iOS test.

## 6. Validation

| Check | Result |
| --- | --- |
| `npm run lint` and `npm run typecheck` | PASS (repository lint alias runs TypeScript) |
| `npm run lint:recovery` | PASS; scoped ESLint includes all added/changed services |
| `npm run test:chat` | **15 PASS**: scanner/concurrency/cancellation, shared real crypto/cache, batched integrity, toast dedup/receipts, shared REST cancellation, UI/avatar/worker handshake |
| `npm run test:recovery` | **44 PASS**: existing 40 plus healthy-observer attach, read-outage recovery, long-progressing history, independent live lane |
| `npm run test:notifications` | **28 PASS**; real local migration/handler boundary now also asserts canonical correlation IDs |
| `npm run check:push-server` | PASS, Deno sender typecheck |
| `npm run test:push-crypto` | **1 PASS**, actual offline Web Push cryptography |
| Existing `test:push-sw`, `test:e2ee`, `test:discovery`, `test:interaction` | PASS |
| `npm run build` | PASS, Vite production build |
| Wrangler 4.145.0 `deploy --dry-run` | PASS, 34 assets, no deployment |
| `git diff --check`, branch/HEAD/patch checks | PASS |
| Live Supabase queries/RLS/index plans, provider/APNs and physical iPhone/network tests | **NOT RUN / NOT VERIFIED** |

Preserved baseline failures were rerun individually, not hidden or repaired:

- `test:push-sql`: unexpected `)` at `scripts/push-tests/sql.test.mjs:78`.
- `test:push-e2e`: unexpected `)` at `scripts/push-tests/e2e.test.mjs:252`.
- `test:inspect-script`: literal diff/`+` text in SQL.
- `test:profile-migration`: invalid assignment from diff text at line 70.
- `test:profile`: existing nudge/completion assertions and undefined `.click()` at line 342.

Node 22 versus ZXing's Node >=24 engine warning remains. No dependency upgrade or unrelated malformed fixture repair was made. Local logs/benchmark scratch are under ignored `.cache/chat-audit/`, not deliverable source artifacts.

## 7. Files changed for this audit (not the entire prior worktree)

- `src/services/chatSubscriptions.ts`: recent-first bounded delivery, live lane, same-ID ordering, exact-page HTTP coalescing.
- `src/services/chatMessageProcessing.ts` **new**: scoped RAM key/decrypt reuse and frame batcher.
- `src/services/messageMerge.ts`: batched stable/no-op merge and envelope-safe plaintext/media preservation.
- `src/App.tsx`: processor/batcher/cache lifecycle, lighter inbox handling, metadata coalescing, foreground toast/worker correlation.
- `src/components/ChatRoomView.tsx`: bounded initial DOM, older expansion, scroll anchoring, avatar effect correction.
- `src/services/profilePhotoService.ts`: coalesce in-flight signed-URL requests.
- `src/services/realtimeRecovery.ts`: data resync, actual read retry, progressing-history deadline.
- `src/services/notificationInbox.ts`: healthy-channel data invalidation.
- `src/services/messageAlerts.ts` **new**: account-scoped opaque-ID foreground/native dedup.
- `public/service-worker.js`: bounded foreground presentation handshake; existing native receipts/click routing retained.
- `supabase/functions/send-push/{handler,index}.ts`: read/send canonical opaque message correlation IDs; no new provider/schema.
- `scripts/chat-tests/{fixtures.ts,processing.test.ts,client.test.mjs,benchmark.ts}` **new**.
- `scripts/recovery-tests/recovery.test.ts`: descending/task-yield fixture support plus four new lifecycle regressions.
- `scripts/notification-tests/pipeline.test.ts`: source-derived correlation assertions.
- `package.json`, `eslint.recovery.config.mjs`: focused test/benchmark scripts and lint scope.
- This report, `docs/PUSH_NOTIFICATIONS.md`, `docs/RELEASE_READINESS.md`: current behavior and supersession notice.

## 8. Before anyone claims the live issues are resolved

With explicit rollout authorization (not given in this task): inspect the production schema/RLS/index plans, reconcile/apply the pending notification migration, configure/deploy the existing sender with the **existing matching VAPID pair**, verify dispatch/Vault/drain configuration, and ship compatible app/worker versions. Do not rotate keys casually or paste credentials into chat.

Then verify on two real accounts/devices: long-history cold/open/reopen latency; progressive chronology; send/retry/duplicate/burn/expiry behavior; toast on another tab but not active room; background/locked/Focus iOS PWA delivery; provider acceptance versus actual OS arrival; notification tap after cold start/login; account switch/sign-out isolation; route-away/reopen presence; ghost privacy; Wi-Fi/mobile transitions and suspension. Record actual failures at their boundary. Keep the earlier TURN and release-readiness gates open.
