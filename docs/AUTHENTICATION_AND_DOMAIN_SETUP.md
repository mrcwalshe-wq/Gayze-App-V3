# Authentication, email and domain setup

What the code does, what could and could not be verified from here, and the exact
external settings that remain. Nothing below claims an email was delivered or a Google
sign-in succeeded in production; those need the dashboard steps and a live test.

## What is in the repository

| Concern | Where |
| --- | --- |
| Sign in / create account / forgot / reset / resend screens | `src/components/AuthView.tsx` |
| Friendly, non-leaking error wording and validators | `src/services/authMessages.ts` |
| Email-link and OAuth return handling (`token_hash`, expired links, cancelled Google, URL cleaning) | `src/services/authCallback.ts`, wired in `src/App.tsx` |
| Email templates (7) and their generator and tests | `supabase/templates/*.html`, `scripts/email-templates/` |
| Callback paths | `AUTH_REDIRECT_PATHS` in `src/services/supabaseClient.ts` |
| Tests | `npm run test:auth`, `npm run test:email` |

Behaviour: client-side inline validation (email shape, password rules, confirmation match); loading/disabled states; password reset and verification resend always answer generically (no account enumeration); expired, reused or malformed links, cancelled Google consent and provider errors are shown as plain-language states with a next step; tokens and codes are removed from the address bar after use; suspended accounts see a clear message and are signed out; the Google button uses the official multicolour "G".

Not changed: sign-in with Google still uses Supabase's PKCE flow (`flowType: 'pkce'`, `detectSessionInUrl: true`). `getAuthRedirectUrl` already maps `*.workers.dev` to `https://gayze.co.uk`.

## Why the Supabase hostname appears, and what removes it

| Where it shows | Cause | Fix |
| --- | --- | --- |
| Links in emails (`…supabase.co/auth/v1/verify?token=…`) | Default templates use `{{ .ConfirmationURL }}`, which points at the Supabase project | **Code is ready.** Paste the templates in `supabase/templates/` (they link to `{{ .SiteURL }}/auth/…?token_hash=…&type=…`, which the app exchanges with `verifyOtp`). Needs dashboard access. |
| Google "Choose an account / to continue to …supabase.co" | Google redirects to Supabase's `/auth/v1/callback` and names that domain | **Cannot be fixed in code.** Requires a Supabase **custom domain** (paid add-on) such as `auth.gayze.co.uk`, then updating Google's authorised redirect URI. Also set the Google OAuth consent screen app name, logo and authorised domain `gayze.co.uk`. |
| Browser network tab, API calls | Normal; the project URL is a public publishable endpoint | None needed. It is never rendered in UI copy (`authMessages` tests assert this). |

## Checklist: Supabase dashboard (project `qdewyupsqmtonkloqxsh`)

Authentication → URL Configuration
- [ ] **Site URL** = `https://gayze.co.uk` (the templates build every link from it).
- [ ] **Redirect URLs** allow-list: `https://gayze.co.uk/**` and `https://www.gayze.co.uk/**` (add `http://localhost:3000/**` for development only). Remove wildcards for hosts you do not own.

Authentication → Emails → Templates
- [ ] For each of **Confirm sign up**, **Reset password**, **Change email address**, (and **Magic link**, **Reauthentication** if enabled) paste the matching file from `supabase/templates/` and the subject from `supabase/templates/subjects.json`.
- [ ] If your plan offers **Notifications** templates, paste `password_changed_notification.html` and `email_changed_notification.html` and switch them on. (A "new sign-in" and "account restriction" email are not provided by Supabase Auth; account restriction would need an Edge Function sending through your SMTP provider.)
- Supabase sends the HTML body only. A separate plain-text part is not configurable in the dashboard; it appears only if your SMTP provider generates one.

Authentication → Emails → SMTP Settings
- [ ] **Custom SMTP** with a sender on your domain (e.g. `GAYZE <no-reply@gayze.co.uk>`). The built-in sender is rate limited to a handful of emails per hour and is not suitable for production.
- [ ] DNS for the sender domain: **SPF** (include your provider), **DKIM** (provider-supplied CNAMEs) and **DMARC** (`v=DMARC1; p=none; rua=mailto:…` to start, tighten after monitoring).
- Distinguish: *accepted by SMTP* ≠ *delivered* ≠ *landed in the inbox*. Only the third is proven by sending to real mailboxes (Gmail, iCloud, Outlook) and checking inbox and spam placement.

Authentication → Sign In / Providers
- [ ] Email provider: **Confirm email** on.
- [ ] Google: client ID and secret set; **Skip nonce checks** off.
- [ ] Authentication → Policies (or Attack Protection): turn on **Leaked password protection** (flagged by the security advisor; availability depends on plan) and set a minimum password length of 8 or more.
- [ ] Confirm rate limits for email sending, sign-ins and OTP are at sensible values.

Google Cloud Console → APIs & Services
- [ ] OAuth consent screen: app name **GAYZE**, logo, support email, **authorised domain `gayze.co.uk`**, privacy policy `https://gayze.co.uk/privacy.html`, terms `https://gayze.co.uk/terms.html`.
- [ ] OAuth client (Web): **Authorised JavaScript origins** `https://gayze.co.uk`, `https://www.gayze.co.uk`; **Authorised redirect URI** `https://qdewyupsqmtonkloqxsh.supabase.co/auth/v1/callback` (or `https://<custom auth domain>/auth/v1/callback` after adding the Supabase custom domain).

Edge Function secrets (project-wide): `ADMIN_SITE_URL=https://gayze.co.uk` (optional; this is the default), `ADMIN_ALLOWED_ORIGINS` (only if you need a preview origin for the admin console).

## Domain and hosting (observed)

Production is a **Cloudflare Worker** (`gayze-app-v3`) serving `https://gayze.co.uk`, deployed by GitHub Actions "Deploy to Cloudflare"; Vercel only produces preview checks. `wrangler.toml` uses `not_found_handling = "single-page-application"`, so `/admin`, `/auth/confirm`, `/auth/reset-password` and `/auth/email-change` resolve to the app shell. Not verifiable from this environment (egress to `gayze.co.uk` is blocked from the sandbox): apex/`www` redirect behaviour, HSTS, DNS (SPF/DKIM/DMARC) records. Confirm them in the Cloudflare dashboard; do not change DNS speculatively.

Installed PWA: Google sign-in opens in the system browser and returns to the installed app only if the OS associates the origin with the app; on iOS the return lands in Safari. This needs a real-device test and is not claimed here.

## Live verification still required after the settings above

1. Create a throwaway account → confirmation email arrives, link opens `gayze.co.uk/auth/confirm?token_hash=…`, lands signed in.
2. Forgot password → generic message; email arrives; link works once; reusing it shows the expired-link state with "Request a new reset link".
3. Change email → confirmation to the new address.
4. Google sign-in (new and existing account), cancel at the consent screen, installed-PWA behaviour on iPhone and iPad.
5. Wrong password, unverified account sign-in (offers "Send the confirmation link again"), offline sign-in, repeated attempts (rate-limit wording).
