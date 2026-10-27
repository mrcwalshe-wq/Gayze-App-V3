# Releasing the GAYZE native apps

Native builds run in Codemagic (`codemagic.yaml`), so no Mac is needed.
Both apps wrap the web build in `dist` using Capacitor (`capacitor.config.ts`, app id `com.gayze.app`).

## One-time setup

### Accounts
1. Apple Developer Program (paid). Needed for TestFlight and the App Store.
2. Google Play Console (one-off fee). New personal accounts must run a closed test
   with about 12 testers for 14 days before production release.
3. Codemagic, signed in with GitHub, with this repo added.

### iOS
1. In App Store Connect create an app with bundle ID `com.gayze.app` and note its numeric Apple ID.
2. App Store Connect > Users and Access > Integrations: create an API key (App Manager role).
3. Codemagic > Team integrations > App Store Connect: add the key and name it `GAYZE_ASC`.
4. Codemagic > the iOS workflow > Environment variables: add `APP_STORE_APPLE_ID` (the numeric id).
5. Let Codemagic manage signing (automatic certificates and profiles) for `com.gayze.app`.

### Android
1. Create an upload keystore once (keep a safe backup, it cannot be recovered):
   `keytool -genkey -v -keystore gayze-upload.jks -keyalg RSA -keysize 2048 -validity 10000 -alias gayze`
2. Codemagic > Team settings > Code signing identities > Android keystores: upload it and name it `gayze_keystore`.
3. The first Play upload is manual: download the `.aab` artifact and upload it in Play Console.

### Supabase
Authentication > URL Configuration > Redirect URLs must include `gayze://auth/callback`.

## Releasing
Codemagic > Start new build > pick `ios-release` or `android-release` on `main`.
iOS builds land in TestFlight automatically. Android builds give an `.aab` artifact.

## Not done yet
- Native push notifications. The web push (service worker + VAPID) does not run in the native apps;
  they need APNs (iOS) and Firebase (Android) via `@capacitor/push-notifications`, plus a
  native-token sender in the Supabase `send-push` function.
- Store listings, screenshots, privacy policy URL, and in-app account deletion and
  report/block tools if user-generated content is offered (both stores require them).
