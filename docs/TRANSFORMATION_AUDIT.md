# GAYZE product transformation: Phase 1 audit

Date: 2026-10-30. Source brief: "Transform GAYZE into a Social Discovery & Messaging Platform".
This is an audit of the repository and the production Supabase project (`qdewyupsqmtonkloqxsh`). It changes no behaviour.
Nothing here was inferred from the brief: every row below was read from the code or queried from the database.

## 1. What exists today

| Area | State | Evidence |
|---|---|---|
| Stack | React 19 + Vite + Tailwind v4 + TS SPA, Supabase (Auth, Postgres, Realtime, Storage, Edge Functions), PostGIS, Capacitor shells, Cloudflare Worker (static assets) | `package.json`, `wrangler.toml` |
| Size | `App.tsx` 4,178 lines; `RightNowView.tsx` 2,481; 56 migrations; 6 Edge Functions (`admin-api`, `delete-account`, `place-search`, `send-push`, `webrtc-ice-servers`, `delete-account`) | repo |
| Navigation | 6 tabs in one `activeTab` state: `right_now` (map of live intents), `dating` (Discover), `later` (gatherings), `swarms` (Messages), `safe_havens`, `profile` | `App.tsx` ~3580-3860 |
| Intents | Core of discovery. `intents` table 190 rows, modes `social`/`private`, time-limited, `discover_right_now` RPC, map, edge glow, hub, sheets, notifications (`intent_expiring`) | `RightNowView`, `SetIntentSheet`, `IntentHub`, migrations |
| Gaze / interest | "Send GAYZE" request -> accept -> conversation. `gazes` 35, `interests` 19, 24 h send cooldown | `submit_interest`, `accept_interest` |
| Messaging | Direct (and `gathering`) conversations; **end-to-end encrypted** (per-conversation AES key wrapped to device identity keys; `identity_devices` 113, `conversation_key_envelopes` 574). Text, photo, meetup cards, call cards, TTL/expiring messages, scheduled messages, unsend, delete-for-me. Realtime recovery layer | `ChatRoomView`, `conversationKeyService`, `messages` 178 rows |
| Calls | WebRTC audio/video with signalling over Realtime, call history, call push notifications, TURN via `webrtc-ice-servers` Edge Function | `webrtcService.ts` (994 lines) |
| Presence | Supabase Realtime presence (client-tracked online/away/offline + last seen). No server-side table, no heartbeat expiry, no hide-status setting | `presenceService.ts` |
| Notifications | Durable inbox (`gayze_notifications` 299 rows), Web Push (`push_subscriptions` 34, VAPID, `send-push`), preferences, service worker, iOS home-screen banner | solid, in daily use |
| Profiles | Photos (private bucket), interests table `profile_interests` exists but **0 rows**, "intimacy" preferences table (sexual/body fields) | `profile_interests`, `profile_intimacy` |
| Safety | Blocks (RLS + trigger enforcement), reports (+ `ReportSheet`), safety timer / check-ins, Safe Havens (0 rows), QR identity verification | tables exist, 0 blocks/reports in use |
| Admin | Owner-only console, audit log, restrictions, broadcasts, member notices | `admin-api`, 1 admin |
| Holding page | `ConceptHoldingPage` at the public root; a "Private access" link to `/login`. **No concept password exists**, so nothing to verify server-side today | `ConceptHoldingPage.tsx` |
| Maps | Leaflet (not Mapbox) with provider config in `src/config/mapProviders.ts`; PostGIS used by `discover_right_now` | code |
| Deploy | Cloudflare Workers **static assets only** (`wrangler.toml`, no Worker script). GitHub Action deploys on push to `main` | `.github/workflows/cloudflare-deploy.yml` |

## 2. Brief vs. reality (gap analysis)

| Brief item | Gap |
|---|---|
| Interests, hobbies, categories | Table exists, empty; no taxonomy, no picker, no search. **Build.** |
| Discover by shared interests | Today's Discover is intent/photo based. **Rebuild** on interests + `discover_*` RPC with privacy rules. |
| Presence (server-backed, heartbeat, hide status) | Client-only Realtime presence. **Build** `user_presence` + heartbeat RPC + privacy flag. |
| Group chats | Only `direct` and `gathering` types. Group admin roles, names/images, add/remove: **Build**. Must reuse the existing E2EE key-envelope system, not create a second conversation system. |
| Reactions, replies, edits, typing, receipts, voice notes, video, pin/mute/archive, message search | None implemented (unsend/delete-for-me/TTL exist). Search over E2EE messages can only be client-side after decryption. |
| Communities | No tables. **Build** with RLS, roles, moderation, reports. |
| Events/activities | `gatherings` + RSVPs exist (4 rows) and are the closest base. **Evolve** rather than duplicate. |
| Notification categories | Messages/gaze/connection/call exist. Add reactions, group invites, community, event invite/reminder. |
| Concept password gate | **Cannot be done in the current deployment**: the Worker serves static assets only, so there is no server to verify a password. Needs a Worker script (`main` in `wrangler.toml`) with a Cloudflare secret. That changes the production Worker configuration and must be done deliberately. |
| TURN / ICE verification | Edge Function exists; real-world call testing needs two physical devices. Not testable in this environment. |
| Mapbox | Not used; Leaflet is. The brief says retain "where useful": keep Leaflet. |

## 3. What the transformation removes or retires (dependency audit)

Removing these touches shared code and live data. None of it was deleted in this phase.

| Concept | Where it lives | Dependencies to unpick first |
|---|---|---|
| IntentMode `social`/`private`, "Spicy", intent hub/sheets/glow/map | `RightNowView`, `SetIntentSheet`, `IntentHub`, `IntentMode.tsx`, `IntentEdgeGlow`, `PeerIntentBanner`, `intents` (190 rows), `discover_right_now`, `get_peer_intent`, `get_peers_live_intents`, nav centre button, `intent_expiring` notifications, admin insights that count intents | Map is the default landing tab; navigation, onboarding and push copy all reference intents. |
| Gaze/"Send GAYZE" request flow | `gazes`, `interests`, `submit_interest`, `accept_interest`, cooldown trigger, notifications, banners | This is also how two strangers become a conversation today. Needs a replacement entry path (message request or open DM) before removal. |
| Intimacy profile | `profile_intimacy`, `get_profile_intimacy`, profile editor sections | Sensitive data. Retire UI first, then decide retention/deletion with an explicit migration. |
| Safe Havens, safety timer, meetup/journey/compass, past-meet QR | `SafeHavenView`, `SafetyTimerModal`, `ScheduleMeetingModal`, `MeetupCard`, `JourneySheet`, `place-search` route mode | These are recent work and are compatible with "meet people for activities". Recommend keeping meetups/directions and re-skinning rather than deleting. |
| "Swarm" naming | `swarms` tab id, `SwarmRoom`, `SwarmQRModal`, `swarmSecretKeyHex` | Mostly internal identifiers; rename in UI copy first, code later. |
| Dating copy / "Gaze" language | Onboarding, notifications, push copy (`send-push`), legal pages, `docs/` | Copy sweep. |

## 4. Security and correctness findings

1. `public.spatial_ref_sys` has RLS disabled (PostGIS system table; flagged by the advisor on every run).
2. `postgis` extension is installed in `public`.
3. Leaked-password protection is disabled in Supabase Auth settings (dashboard setting, not code).
4. Many `SECURITY DEFINER` RPCs are executable by `authenticated` (intended, each checks `auth.uid()`); `gayze_pre_request` and PostGIS `st_estimatedextent` are executable by `anon`.
5. Device-identity and conversation-key tables carry the E2EE trust model; any new conversation type (groups) must go through the same envelope flow or it will silently be unencrypted. This is the largest design risk in the brief.
6. Client-trusted reliability/QR data (score carried in the QR payload, placeholder 95/14 defaults) is spoofable. A server-backed replacement is written (`feat/past-meets-reliability`) but **is not applied to the database** (the Supabase approval prompt timed out twice).
7. Pre-existing test failures on `main`: 9 in `test:interaction`, 3 in `test:profile`.
8. No blocks or reports have ever been created in production; the moderation path has not been exercised end to end.

## 5. Recommended staging

Each stage is its own PR and leaves `main` deployable.

1. **Foundation (no user-visible deletion):** interests taxonomy + picker + `profile_interests` RLS, `user_privacy_settings`, server-backed `user_presence` (+ hide status), notification categories. Migration + RLS tests.
2. **Discover v2:** interest-based discovery RPC (privacy-aware, approximate location only), new Discover tab with filters/empty states.
3. **Navigation switch:** Discover / Chats / Communities / Activity / Profile. Retire Right Now map as a landing tab (keep nearby map as an optional view), hide intent entry points behind the new IA.
4. **Messaging features** on the existing E2EE pipeline: reactions, replies, edits, receipts, typing, pin/mute/archive. Then groups with proper key envelopes.
5. **Communities** and **Activities** (evolve gatherings).
6. **Removal pass:** drop intent UI/RPCs/columns only after nothing references them, with a rollback migration and a data export of `intents`/`gazes`.
7. **Holding page + gate:** rewrite copy now; server-side password needs a Worker script and a Cloudflare secret.
8. **Hardening:** RLS validation suite for every new table, advisor clean-up, accessibility and responsive pass.

## 6. Decisions needed before stage 3 and 6

* Confirm that retiring intents, the Gaze flow and the map landing screen is wanted even though they are in daily use by current testers.
* How should strangers start a conversation once Gaze is gone (open DM, or message request that the recipient accepts)?
* Keep meetups, directions, Safe Havens and the safety timer (recommended) or retire them with intents?
* Concept password: provide the intended password mechanism (Cloudflare secret name) and approve adding a Worker script to the existing `gayze-app-v3` Worker.
* Minimum age policy wording for onboarding and terms.
