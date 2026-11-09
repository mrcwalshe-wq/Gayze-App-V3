# Incoming calls as a real phone call (iPhone)

How it works: when someone calls, the database trigger asks `send-push` to send Apple a **VoIP push** to the callee's phone.
iOS wakes the app, which shows the system call screen (lock screen, ringtone, Answer / Decline) through **CallKit**.
Answering opens the app and joins the call. Code: `plugins/gayze-callkit`, `src/services/nativeCalls.ts`,
`supabase/functions/send-push/voip.ts`, migration `20261109190000_voip_call_push.sql`.

## One-time setup
1. Apple Developer > Keys: create a key with **Apple Push Notifications service (APNs)** enabled; download the `.p8`. Note the Key ID and Team ID.
2. Apple Developer > Identifiers > `com.gayze.app`: make sure **Push Notifications** is enabled (VoIP uses the same key; the topic is `com.gayze.app.voip`).
3. Supabase > Edge Functions > Secrets: `APNS_KEY_P8` (the file contents), `APNS_KEY_ID`, `APNS_TEAM_ID`. Optional `APNS_VOIP_TOPIC` (default `com.gayze.app.voip`).
4. Apply the migration, deploy `send-push`, ship a new TestFlight build (the app needs the new native plugin, the `voip` background mode and the push entitlement).

## Testing (real iPhone only; the simulator cannot receive VoIP pushes)
Install the TestFlight build on two phones, sign in on both, quit the app on the callee's phone, lock it, and call from the other.
Expected: the normal full-screen call screen. Debug builds use Apple's sandbox, TestFlight/App Store builds use production; the app reports which.

## Limits to know
- iOS requires every VoIP push to show a call. Calls older than ~70 s are shown and dismissed at once.
- An unanswered call stops ringing after 45 s.
- If the caller hangs up before the callee answers, the callee's call screen disappears after the timeout (there is no cancel push yet).
