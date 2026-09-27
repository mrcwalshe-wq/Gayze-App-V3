# GAYZE MVP Completion Plan

**Status:** Working scope, 2026-09-27  
**Purpose:** Turn the current feature-rich prototype into a testable, trustworthy invite-only beta. This plan reflects the confirmed core journey and required features below; open operational details remain listed as questions.

## Confirmed Direction

- **Release:** Invite-only real-user beta.
- **Core journey:** Right Now intent → discover/mutual match → secure chat.
- **Also required:** Real QR identity verification and a safety check-in.
- **Backend:** The existing Supabase project is accessible. Review its schema, RLS policies, RPCs, and Realtime setup before changing backend behavior.
- **Still undecided:** Launch geography and eligibility, login/recovery expectations, what a safety check-in must do beyond a timer, moderation ownership, supported browsers, and team/date constraints.

## Current Shape

- **Frontend:** React 19 + TypeScript + Vite. `src/App.tsx` owns navigation, most app state, and feature orchestration; feature views live in `src/components/`.
- **Persistence:** Much of the profile, discovery, chat, event, story, and safety state is seeded and stored in `localStorage` via state initialization and effects in `src/App.tsx`; starter datasets live in `src/services/storageService.ts`.
- **Backend:** Supabase is optional (`src/services/supabaseClient.ts`). `src/services/supabaseService.ts` has real calls for Right Now discovery/intents, interest and gaze, profiles/devices, and encrypted conversation messages. The UI falls back to local/demo behavior when the configured path is unavailable.
- **Security:** Web Crypto and device identity/recovery logic live in `src/services/cryptoService.ts`. Some flows still create local demo rooms or simulated peers; the encryption helper contains a Base64 fallback if Web Crypto fails. Treat that fallback as a release blocker for anything presented as encrypted.
- **Feature surfaces:** Dating/profile browsing, live Right Now map, planned gatherings, chat, safe havens, identity/device management, QR verification, safety timer, stories, and call UI. Several are richer than their backing behavior: for example, calls progress through simulated states, and the distress action currently reports success through UI without a delivery integration.
- **Project readiness:** No README, SQL migrations, automated test files, or visible CI workflow were found. `package.json` defines `lint` and `build`, but both currently fail because dependencies are not installed (`lucide-react`, `leaflet`, and `@tailwindcss/vite` are among the unresolved packages). This does not establish whether the source compiles once dependencies are installed.

## Recommended MVP Boundary

Start with one honest end-to-end connection journey:

1. A person can understand the privacy model and create/edit a minimal profile.
2. They can publish, pause, expire, and remove a Right Now intent with clear location permission and location precision controls.
3. They can discover real, currently active intents in the launch area and express interest.
4. Mutual interest creates or opens a conversation; encrypted messages persist and arrive across two real accounts/devices.
5. They can verify a peer's identity and arrange a public meeting. The safety feature must describe what it actually does and never imply an alert was sent unless delivery is confirmed.

**Default recommendation:** Make Right Now → mutual interest → secure chat the launch-critical loop. Keep Dating only if it shares the same real profiles and interaction backend. Defer or label as unavailable any feature that is still seeded/simulated, including calls, stories, broad event hosting, and emergency-contact alerts. Safe Havens can ship as a curated, clearly sourced directory without user-generated safety claims.

## Work Plan

### P0. Establish a reproducible baseline

- Install dependencies from the committed lockfile using the repository's chosen package manager; confirm whether Bun is the intended standard (`bun.lock` exists).
- Make `lint` and `build` pass locally and in CI; record runtime/browser support and the required Supabase environment variables.
- Add a short setup guide and a deployment/environment checklist. Never put service-role credentials in client configuration.
- Identify the authoritative Supabase schema, migrations, RPC definitions, RLS policies, storage policies, and Realtime publication. Bring migration history into source control if the backend is in scope.

**Exit:** A new developer can configure, run, lint, and build from a clean checkout; backend changes are reproducible.

### P1. Lock scope and remove misleading prototype behavior

- Answer the product and launch questions below; document explicit in-scope and deferred features.
- Mark seeded/demo records as demo-only and keep them out of production discovery. Do not silently combine synthetic and real people in a live feed.
- Implement QR identity verification as a real scanned, cryptographically checked exchange; remove the simulated scan shortcut from beta builds.
- Make safety check-in status and delivery claims truthful. Keep calls, Stories, and Later gatherings out of the beta unless separately approved; remove simulated call connection states.
- Define what “encrypted,” “verified,” “anonymous,” “private location,” and “safety alert” mean in product copy and threat model.

**Exit:** Every visible MVP action has a defined real outcome, a failure state, and no false security or safety claim.

### P2. Complete the connection and identity loop

- Implement account/session and profile lifecycle, including age/eligibility policy, profile edits, account deletion, and recovery expectations.
- Validate intent lifecycle on the server: one active intent policy, expiry, pause/unpublish, location consent, privacy radius, and server-side filtering/authorization.
- Verify interest idempotency and mutual-match creation; ensure only eligible participants can read/write their conversation.
- Implement QR verification with a real camera/manual payload flow, signature or key-fingerprint validation, replay protection, and clear failure states; never award verification from a demo payload.
- Finish the two-device encrypted chat path: authenticated key agreement, identity-key changes, safety-number verification, replay/duplicate handling, reconnect state, and explicit behavior when a peer key is missing or changed.
- Ensure ephemeral-message expiry is enforced server-side and clients do not claim deletion until it is actually enforced. Define attachment support as out of scope unless needed.

**Exit:** A scripted two-account journey works from a clean database through discovery, mutual match, real QR/key verification, two-way chat, expiry, and reload/reconnect.

### P3. Make privacy and safety behavior dependable

- Remove the Base64 “encryption” fallback; fail closed and show a clear error when secure cryptography is unavailable.
- Review location collection, fuzzy-coordinate generation, permission denial, retention, and whether raw coordinates are stored. Verify RLS/RPC behavior against unauthorized users.
- Ship the required check-in with a documented, tested timer and expiry behavior. Confirm whether alerts go only to the user, to trusted contacts, or to an emergency service; do not show “sent” until a configured delivery provider confirms it. If external delivery is not available for beta, explicitly label the feature as a local check-in and offer a user-controlled fallback.
- Test identity backup/restore, device registration/revocation, data clearing, and account deletion. Avoid clearing unrelated origin-wide storage without explicit scope and confirmation.

**Exit:** Security/privacy tests and a documented threat/privacy review cover the shipped flows; unsupported safety promises are absent. The check-in's actual delivery scope is reflected in UI and onboarding.

### P4. Release readiness

- Add focused automated coverage for intent rules, matching, authorization, encryption failure handling, expiry, and data deletion; add browser tests for the core journey on mobile and desktop.
- Add observable error reporting without collecting message plaintext or precise location unnecessarily.
- Validate accessibility, location permission denial, network loss, empty states, and small-screen behavior.
- Run a small closed beta in the chosen launch geography; define support, moderation/report/block handling, incident response, and rollback ownership before opening access.

**Exit:** Agreed release criteria pass in a production-like environment and beta feedback has an owner and triage path.

## Remaining Questions

The major scope choices above are confirmed. These questions still affect implementation and beta readiness. The bracketed options are recommendations, not decisions already made.

1. **Where is the invite-only beta, and who is eligible?** One launch city/community or multiple? What minimum age and verification policy?
2. **What sign-in and recovery model is acceptable?** Current code attempts anonymous Supabase sessions. Is anonymous identity sufficient, or are email/phone/social login and recovery required?
3. **What location precision and retention are acceptable?** Is approximate location sufficient? May precise coordinates reach the backend, and for how long?
4. **What must safety check-in do?** Local timer only, trusted-contact check-in, or verified emergency alert delivery? Which channels/contacts, and who owns operations? [Recommended beta fallback: clearly labeled local timer unless actual delivery is implemented and tested.]
5. **What is the QR verification policy?** Must both users be online, can users compare fingerprints offline, and what recovery applies after device/key change?
6. **What moderation and abuse controls are launch requirements?** Blocking, reporting, profile review, rate limits, and response times need owners and explicit policy.
7. **Which browsers/devices must be supported?** Mobile web/PWA only, or are native capabilities (push, background location, calls) expected?
8. **What team capacity and test/deploy environment are available?** Who can validate UX, Supabase policies, security, and beta operations, and what date constrains scope?

## Suggested Acceptance Criteria for the Recommended Core

- Two independent test accounts can create profiles and control whether their intents are discoverable.
- A user can publish, pause, resume, expire, and delete an intent; no expired or blocked user's intent appears in discovery.
- Location is not requested until needed, denied permission remains usable, and displayed coordinates satisfy the documented privacy bound.
- A unilateral interest does not reveal a conversation; mutual interest creates exactly one authorized conversation.
- QR verification succeeds only after a real peer payload is checked; invalid, replayed, or changed keys fail clearly and never alter trust scores.
- Messages are ciphertext at rest in the backend, decrypt only for conversation participants with valid keys, and fail closed on invalid/missing keys.
- Safety check-in behavior matches the confirmed delivery scope; expiry and any alert failure are visible, and no unconfirmed alert is described as delivered.
- A key change is visible and requires verification; the interface does not mark a peer verified from a simulated scan.
- No feature claims that a call connected, an emergency alert was delivered, or data was erased unless the underlying operation confirms it.
- Automated checks cover the rules above; the core path passes on the agreed mobile and desktop browsers.

## Codebase Starting Points

- App shell and workflow orchestration: `src/App.tsx`
- Discovery and intent map: `src/components/RightNowView.tsx`
- Dating browse surface: `src/components/DatingGridView.tsx`
- Local seed/demo records: `src/services/storageService.ts`
- Supabase client and data operations: `src/services/supabaseClient.ts`, `src/services/supabaseService.ts`
- Cryptography and device identity: `src/services/cryptoService.ts`
- Chat UI and local/synced message presentation: `src/components/ChatRoomView.tsx`
- Safety timer UI: `src/components/SafetyTimerModal.tsx`
- Simulated call UI: `src/components/EncryptedCallModal.tsx`
