# Phase 1 manual test checklist (real iPhone)

Written for the person running it. **None of these has been run or passed**; the automated suite covers
only what is listed under "What the automated suite covers".

## What the automated suite covers (Playwright, pinned Docker image)

Visual baselines at 440x956, 402x874, 375x667 and 1280x800 for: navigation chrome, Right Now (map), Set Intent
steps 1 to 3, Messages (Chats and Notifications), Profile, and the dialogs Privacy, Edit profile, Identity,
Safety check-in and Swarm QR. Axe runs against the same screens.

The suite runs the production build as a *fake signed-in user* with every network request answered locally
(`e2e/support/harness.ts`); it never contacts the real Supabase project.

## Coverage gaps (must be checked by hand)

These screens are not in the automated baseline:

| Not covered | Why |
|---|---|
| Profile screen | At 402px wide it paints one pixel differently in about 1 of 5 loads (element positions identical in all 40 loads measured), so it cannot be a stable image baseline. The dialogs opened from it (Privacy, Edit profile, Identity, Safety check-in, QR) are covered |
| Sign-in / sign-up (`AuthView`), Consent gate, Profile onboarding | The fake user is already signed in, consented and onboarded, so the app skips them |
| Intent Hub | Needs an active intent; creating one needs a real backend response |
| A chat room, including the photo-send notice (`window.confirm`) | Needs a conversation and message keys |
| Later (Events), Discover (desktop only), the people sheet, `NearbySheet` | Need server data / live people |
| `EncryptedCallModal`, `FullScreenCallModal` | Need a call in progress |

For **each first-run screen** (sign-in, sign-up, forgot/reset password, consent, onboarding) check by hand after P0:

- [ ] Pinch-zoom works (P0-1) and inputs do not zoom on focus
- [ ] Text is at least 11px; nothing is clipped at the smallest iPhone (P0-5)
- [ ] Muted/placeholder text, links and the Apple/Google buttons are legible (P0-4 contrast)
- [ ] VoiceOver reads each field label and the error messages

## P0 manual checks (after the P0 fixes land)

- [ ] Pinch-zoom works on non-map screens
- [ ] Map pan and pinch still work
- [ ] Inputs do not zoom on focus
- [ ] VoiceOver announces each dialog and returns focus to the trigger on close
- [ ] Tab bar labels are legible and not clipped on the smallest iPhone
- [ ] The photo-send notice appears and Cancel does not send
- [ ] The Messages tab badge is announced with the correct count
