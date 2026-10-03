# Map → chat and live peer Intent — follow-up validation

Date: 2026-10-01. Branch: `arena/01a0f3ee-gayze-app-v3`. HEAD remains `1190d6ab220b2658678b66136f95a21810b2f306`.

## Decision

**Both requested features are implemented and pass local validation. Production readiness is NOT established.** No commit, push, deployment, project migration application, reset, or branch change was performed. Patch 1 remains unchanged and unapplied.

The earlier `RELEASE_CANDIDATE_REPORT.md` and `RELEASE_CANDIDATE_INVENTORY.json` remain historical snapshots of the preceding request; their hashes are not a manifest of this newer source state.

## Explicit PASS / FAIL

“PASS (local)” means the implementation and executed local checks passed, not that a production endpoint or physical device was verified. “FAIL — verification gate” below means required evidence is missing, not that a new production delivery failure was observed.

| Requested area | Result | Evidence and limits |
| --- | --- | --- |
| Map → Message opens the specific chat without the conversation list | **PASS (local)** | Real Map Message action → production resolver → real ChatRoomView interaction test. Stable peer ID selects the right same-name person; cached existing chat bypasses interest/list I/O. Direct mobile pane, back, same-room reopen, delayed hydration and unknown target tested. Production membership RPC and physical browser checks remain unverified. |
| Other user's live current Intent banner, NOW/LATER + Social/Spicy | **PASS (local)** | Authenticated peer-scoped REST + existing RealtimeRecovery; updates, pause, replacement, deletion fallback, expiry, LATER→NOW, account/peer changes, stale callbacks, failures and cleanup tested. Production base-intents RLS/publication still needs verification; hidden rows are not fabricated. |
| Foreground message notifications | **PASS (local)** | Existing inbox/SW/dedup checks pass. New actual-pane test proves a toast is suppressed in the visible room but shown once when that same room is hidden behind the mobile list. Read acknowledgement is also gated on actual visibility. Real-device presentation remains unverified. |
| Background iPhone push | **FAIL — verification gate (unverified)** | **Production Cloudflare push path and physical iPhone/PWA arrival have NOT been verified. Do not call this fixed.** Local sender/SW/crypto checks are insufficient evidence of delivery. |
| E2EE | **PASS (local)** | E2EE suite, real AES-GCM benchmarks, key/cache/integrity and security tests pass. No encryption or key-storage implementation changed in this request; banner reads no message plaintext or private keys. Production cross-device key provisioning remains unverified. |
| Presence / last-seen | **PASS (local)** | Recovery/chat UI tests preserve online/last-seen independently of message sync; incognito and background lifecycle checks pass. Existing amber indicator and profile metadata behavior unchanged. Physical iOS/network transitions remain unverified. |
| Chat performance | **PASS (local regression/controlled benchmark)** | Bounded history, cache, chronology, scroll-anchor and dedup tests pass; benchmarks below. Cached direct navigation performs no interest/list request. **Live latency, paint timing and iPhone performance are not certified.** |

**Overall release gate: FAIL / not cleared**, because required production/device proof is absent and five known baseline suites remain failing.

## Implementation details

### 1. Direct chat navigation

- App sends an explicit room-open request with a sequence number. Reopening the same room after returning to the list is not lost as a no-op state update.
- ChatRoomView opens an explicit active target in the mobile conversation pane; room changes/open requests switch panes before paint. Back-to-list remains usable and metadata refreshes do not reopen it.
- An unloaded or unavailable explicit ID no longer falls back to `rooms[0]`. The UI waits for that specific conversation and offers a route back to rooms; it never presents another person's composer/history as the requested chat.
- Live room reuse requires the stable peer user ID and a real conversation ID, not a display name or key substring. If metadata is not cached, the existing coalesced membership-list loader is used before submitting interest.
- New live conversations still require the existing backend mutual-match contract. Failure, pending interest, missing authentication or an invalid returned ID cannot create a synthetic room. Profile actions without a discovery pulse use the same guarded path rather than falling through to demo creation.
- Account generation and latest-request guards prevent delayed routing results from replacing newer navigation. The mutual-interest entry point is guarded too. Conflicting cached peer identities are rejected and room registration avoids duplicate IDs.
- Notification deep links use the same explicit-open request. The same helper is reused by existing gathering/proposal destinations; their authorization model was not expanded.
- ChatRoomView reports its **actually visible** room to App. Below 640px, returning to the list clears it; at desktop widths the conversation remains visible beside the list. Cleanup clears it. MatchMedia has a resize fallback and legacy listener support.
- Foreground alerts and automatic read acknowledgement now consume that visibility rather than inferring it from tab + selected room alone.

### 2. Live peer Intent

- New banner sits directly below the conversation header, above key warnings/history. Its identity is the room's `peerUserId`, never the viewer's active Intent or historical `connectionContext`.
- Reads only `id,user_id,mode,intent,starts_at,expires_at,is_paused` from `intents`, scoped to the selected peer, unpaused and unexpired, ordered consistently and limited to one row. Unknown/malformed modes, invalid timestamps and wrong-user rows are rejected.
- `social` displays **Social** in existing amber styling; `private` displays **Spicy** in violet. `starts_at > now` displays **LATER**; otherwise **NOW**. A future start and expiry countdown are shown.
- Uses the **existing Supabase client and RealtimeRecovery**, not another realtime architecture, TURN provider or socket. Realtime events invalidate an authoritative read rather than supplying display data directly.
- A 15-second reconciliation fallback covers missed events and filtered DELETE delivery limitations. Expiry clears locally without needing an event. The existing chat clock handles LATER→NOW transitions.
- Fresh REST data can still display while realtime is joining. A 30-second freshness ceiling clears a stalled read's old snapshot; known read errors clear it immediately. Offline/background/sign-out clear it, and foreground recovery refetches.
- Account/room/peer scoping, invalidated-read revisions, current-generation checks, timer cleanup and subscription teardown prevent old responses/events from changing the next banner. The banner is unsubscribed on the hidden mobile list and when leaving chat.
- Empty/RLS-hidden results show “No current intent shared”; errors show “Current intent unavailable.” Intent availability does not block history, encryption or sending. No RLS widening or speculative schema change was made.

### 3. Timing source correction

Inspection found that all composer choices previously persisted `starts_at = now`, and the reload helper incorrectly turned an older active NOW intent into a later choice based on elapsed age. A banner alone could not reconstruct the original later selection.

The composer now saves actual scheduled starts in the existing column:

- Right now: current time.
- 1 hour / 2 hours: that offset from publication.
- Tonight: **19:00 device-local time, or now if already later**; this convention is explicitly shown in the composer.
- The selected availability duration starts at the scheduled start, so a two-hour delay with one-hour availability does not expire before it begins.

Reload derives a future timing bucket from `starts_at`, not elapsed activation age. The database has no `when_label`; exact original wording still cannot always round-trip. Old rows already saved with a current start cannot have their lost later choice recovered. Their banner follows the stored timestamp truthfully; republishing/editing uses the corrected scheduling. No data backfill was attempted.

## Exact incremental file scope

Only these six pre-existing files differ from the preceding RC snapshot:

| File | Change |
| --- | --- |
| `src/App.tsx` | Stable-ID direct routing, guarded live/profile/mutual paths, explicit reopen request, actual visible-room notification/read context. |
| `src/components/ChatRoomView.tsx` | Mobile direct opening/reopening, no wrong-room fallback, visibility reporting and peer banner placement. |
| `src/components/SetIntentSheet.tsx` | Persist actual selected schedule; explain Tonight convention. |
| `src/services/supabaseService.ts` | Reload timing from future start rather than elapsed age. |
| `package.json` | Add `test:chat-intent`; include new source in scoped ESLint command. |
| `eslint.recovery.config.mjs` | Include new source files in scoped lint. |

New files in this request:

| File | Purpose |
| --- | --- |
| `src/services/directChatRouting.ts` | Testable stable-ID/membership-first live resolver. |
| `src/services/peerIntent.ts` | Narrow peer read, validation, realtime invalidation, recovery/polling, expiry/freshness and cleanup. |
| `src/services/intentTiming.ts` | Canonical existing-option scheduling and reload labels. |
| `src/components/PeerIntentBanner.tsx` | Current peer Intent display, separate from own styling and historical context. |
| `scripts/chat-intent-tests/fixtures.mjs` | Isolated auth/REST/realtime boundaries and deterministic clock. |
| `scripts/chat-intent-tests/service.test.mjs` | Routing, validation, recovery, invalidation, expiry, failure and timing tests. |
| `scripts/chat-intent-tests/ui.test.mjs` | Actual Map/chat/banner/composer interactions and visibility/notification regression checks. |
| `docs/CHAT_INTENT_FOLLOWUP_2026-10-01.md` | This report. |

Final dirty worktree: **70 files (23 modified, 47 untracked)**, including all earlier work. This request adds eight files and changes six prior files. The previous lockfile, migration candidates, push sender, service worker, WebRTC/TURN implementation, crypto, presence and other recovery sources retain their prior RC hashes. No dependency version change was made; local test dependencies were restored with `npm ci` and the existing `test:setup` command.

Patch 1 SHA-256 remains `c17b00ece307a9ff5da5339271c0ec3e7fb253fc7f7d3bcbe605e8dcc5b1540b`.

## Final validation

Every command below was executed individually against the final source. The default chained test command was not used to conceal later results behind its first baseline failure. Logs and command exit codes are local scratch artifacts under `.cache/chat-intent-validation/`, particularly `results.json`.

| Command | Final result |
| --- | --- |
| `npm run lint` | PASS (TypeScript-backed existing script) |
| `npm run typecheck` | PASS |
| `npm run lint:recovery` | PASS (scoped ESLint, including new source) |
| `npm run test:chat-intent` | PASS, **21** tests |
| `npm run test:rc` | PASS, **11** tests |
| `npm run test:chat` | PASS, **15** tests |
| `npm run test:recovery` | PASS, **45** tests |
| `npm run test:notifications` | PASS, **32** tests |
| `npm run test:push-sw` | PASS |
| `npm run test:e2ee` | PASS |
| `npm run test:discovery` | PASS |
| `npm run test:interaction` | PASS |
| `npm run check:push-server` | PASS, Deno server type check |
| `npm run test:push-crypto` | PASS, real offline Web Push crypto, `ECE_KEYLOG=0` |
| `npm run build` | PASS |
| `npm run bench:rc` | PASS, controlled integrated benchmark |
| `npm run bench:chat` | PASS, controlled crypto/history benchmark |
| `npx --yes wrangler@4.145.0 deploy --dry-run --outdir .cache/chat-intent-validation/cloudflare` | PASS, 34 static assets; **no deployment** |
| `git diff --check` | PASS |
| `npm run test:push-sql` | **FAIL, existing baseline**: unexpected `)` at line 78 |
| `npm run test:push-e2e` | **FAIL, existing baseline**: unexpected `)` at line 252 |
| `npm run test:inspect-script` | **FAIL, existing baseline**: literal diff text breaks SELECT/WITH checks |
| `npm run test:profile-migration` | **FAIL, existing baseline**: malformed assignment/diff text at line 70 |
| `npm run test:profile` | **FAIL, existing baseline**: profile/nudge assertions and undefined `.click()` at line 342 |

The five counted targeted suites total **124 passing tests**. The unrelated broken fixtures were not changed. During this request's first broad run, old jsdom suites exposed the new unconditional MatchMedia call; the production component gained capability/resize fallbacks, and both affected suites passed on rerun. No new executed local failure remains.

Node 22 still emits the existing ZXing Node >=24 engine warning. Installation audit reported zero vulnerabilities. Real browser layout/paint and physical iPhone checks were not performed; jsdom assertions are not pixel-level evidence.

## Controlled performance results

Final `bench:rc`: real ChatRoomView, recovery, pagination, merge and AES-GCM; synthetic 1,000-message backend, 10ms REST, 20ms JOIN acknowledgement and 4ms key discovery. Times are **jsdom commits**, not browser paints. This fixture does not include a production peer-Intent request.

| Scenario | Shell commit ms | First decrypted commit ms | History complete ms | REST queries / rows | Key lookups / decryptions | Joins |
| --- | ---: | ---: | ---: | --- | --- | ---: |
| Cold | 37.21 | 311.98 | 1301.62 | 7 / 1000 | 1 / 1000 | 1 |
| Warm forced full scan | 124.61 | 124.62 | 561.43 | 7 / 1000 | 0 / 488 | 1 |
| Warm controlled recent | 113.52 | 113.54 | 285.81 | 1 / 50 | 0 / 0 | 1 |

The exact 1–2 startup reconciliation passes depend on JOIN/read timing; the bounded path is not a promise of one production request. The cold shell is faster than the warm shell in this fixture: these results **do not establish a generally faster cached shell**. They preserve evidence of less redundant history I/O/decryption, not production latency resolution.

Final `bench:chat`: 300 real AES-GCM messages; sequential baseline 1317ms and 300 key lookups; optimized 86ms total, 21ms to newest, one key lookup and four state merges. Reopening newest 50: 0.21ms, no extra key lookups/decryptions. All 300 plaintexts and chronological IDs match. Again, this is a controlled CPU/latency fixture, not live device evidence.

The new Intent path is separate from message/key loading: one limited peer read per normal 15-second poll plus coalesced invalidations, only while the peer banner is mounted. It neither rescans message history nor blocks the composer.

## Production gates still required — not executed

1. **Peer Intent permission/data contract:** with authorized test accounts, verify peer `intents` SELECT under actual RLS, paused/expired/hidden behavior, one-current-intent policy and future start acceptance. Verify intents publication/realtime access and polling fallback; do not weaken privacy policies to make a banner appear. The base production schema/policies are not fully represented in repository migrations.
2. **Navigation and device UI:** Map preview and full-sheet Message actions, duplicate display names, existing/new mutual chats, same-room reopen, delayed hydration, account switching, native notification deep links, mobile Back and desktop resizing. Check small-screen/keyboard/safe-area layout on a real browser/iPhone.
3. **Foreground/native notification integration:** authenticated owner routing, durable inbox counts, foreground toast versus visible chat, replay suppression and actual notification permissions. Existing SW handshake may produce a quiet OS record; it does not prove zero OS banners on every platform.
4. **Background iPhone push:** verify the actual deployed Cloudflare worker/assets/service-worker/deep-link path and the existing Supabase dispatch/sender configuration; matching VAPID, subscriptions, preferences, durable database event/claim, provider response and physical installed-PWA delivery while backgrounded/locked. Test tap routing and account changes. A local dry run or successful provider encryption does not verify any of those production hops.
5. **E2EE/presence/performance:** real two-device key provisioning, long history, reconnect/background/resume, incognito/last-seen, Wi-Fi/mobile transitions, physical paint/latency and existing Cloudflare TURN behavior. Existing TURN production source/credential TTL verification remains outstanding from the prior audit; nothing in this request replaces it.

A presence-only shell check found no Supabase management/service-role, VAPID, push-dispatch or Cloudflare credentials available here. That does **not** prove production is unconfigured. No credentials were requested or exposed, and no deployment was attempted to obtain proof. The earlier pending notification migration remains unapplied and unchanged.
