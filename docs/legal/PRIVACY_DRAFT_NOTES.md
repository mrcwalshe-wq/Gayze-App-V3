# Privacy policy draft: what must change before it can be true

The draft (`privacy-policy-DRAFT.html`, same folder) is for a solicitor to review. It is not legal advice and it is **not published**. Yellow `[TO CONFIRM]` marks are facts only the company can supply.

## Things the app must do first (the draft says them, the app does not yet)
1. **Explicit consent for sexual-orientation data.** Sign-up and onboarding have no consent step. The draft relies on UK GDPR Article 9(2)(a). Build an unticked, separate consent screen, store the consent and its time, and let people withdraw it.
2. **Delete old data on a schedule.** Nothing is purged today. Measured on production on 8 Nov: 234 intents expired more than a day ago and still hold a position, 143 notifications older than 30 days, 13 messages past their expiry. Pick the periods in section 11 of the draft, then add scheduled clean-up jobs so the policy is true.
3. **A way to download your data**, or a manual process documented to answer requests within one month.
4. **Analytics.** `analyticsService` tries to write to a table `app_analytics`, which does not exist, so no events are stored. The draft says no outside analytics is used, which is correct. If you create the table, add it to the policy and a retention period.

## Filled in from Companies House (checked 8 Nov 2026)
GAYZE LABS LTD, company number 17035250, private limited company, active, incorporated 16 February 2026, registered office 82a James Carter Road, Mildenhall, Bury St. Edmunds, IP28 7DE. First accounts due 16 Nov 2027; first confirmation statement due 1 Mar 2027. Source: Companies House register (it does not check accuracy).

## Facts still to fill in
ICO registration number (the data protection fee applies from the first day you process personal data), a privacy mailbox on your own domain (not Gmail), who is the privacy lead or DPO, the email-sending provider, the exact place-search provider, Supabase backup retention, lock-screen notification wording, what a report captures.

## Verified while drafting
- Database region: Ireland (eu-west-1).
- Map tiles: `tile.openstreetmap.org` and `tile.openstreetmap.fr`.
- Call relay: Cloudflare.
- No third-party analytics SDK in the code.
- Messages are end-to-end encrypted (versioned device keys); event venue/address are readable only by the host and accepted guests (enforced in the database).

## Also worth a solicitor's time
A data protection impact assessment, the Article 9 condition for safety processing, the Online Safety Act duties (illegal-content risk assessment, reporting and complaints), and whether the terms and community guidelines need the same updates (events, pictures, quick plans).

## From the company profile PDF
- It says the company is run by the founder alone with no employees. The privacy contact, the data protection lead and moderation (Online Safety Act duties, reports, complaints) all fall on one person: plan cover and a documented process.
- It says users are "mainly UK, some international". If you knowingly serve people in the EU, check whether an EU representative is needed under Article 27 EU GDPR.
- It describes a freemium model with subscriptions and in-app purchases. The draft now has placeholders for payments; the policy and terms must be updated again when premium launches.
- It says the platform "does not facilitate or require any ... face to face services". GAYZE's events, quick plans and safety timer exist to help people meet in person. If that sentence is used in payment-provider or app-store applications, it could be read as inaccurate and put the account at risk. Describe the in-person element accurately.
