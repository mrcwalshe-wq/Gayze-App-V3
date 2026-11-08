# GAYZE on the App Store: what is ready and what is not

State of the repo on 8 Nov 2026. Bundle ID `com.gayze.app`, App Store Connect app `6827405145`, builds run in Codemagic (`ios-release` workflow, uploads to TestFlight). Nothing has been submitted for review.

## 1. First: get a TestFlight build running
1. Codemagic, Start new build, `ios-release`, branch `main`. It builds the web app, syncs Capacitor, signs, and uploads to TestFlight.
2. If it fails, the log names the step. Signing and App Store Connect key setup are in `NATIVE_APP_RELEASE.md`.
3. Install the TestFlight build on a real iPhone. Everything in the audit that needs a phone (calls, camera, location, notifications, sign-in) starts here.

## 2. Likely to cause a rejection, and what to do
| Risk | Why | Action |
|---|---|---|
| **Privacy policy URL points at the old policy** | The App Privacy answers must match the policy, and the live one is out of date (no events, pictures or encryption description). | Publish the reviewed policy (`docs/legal/privacy-policy-DRAFT.html`) before submitting. Needs ICO number, privacy email, solicitor review. |
| **Sign in with Apple (guideline 4.8)** | The app offers Google sign-in. Apps that offer a social login must also offer a login that limits data and can hide the email. | Add Sign in with Apple (Apple Services ID and key, switched on in Supabase Auth), or confirm with Apple in review notes that email and password is the equivalent. Adding it is the safe route. |
| **"Just a website" (guideline 4.2)** | The app is the web app in a wrapper. Apple rejects wrappers with no native value. | Native push notifications are the strongest answer (section 3). Haptics and the share sheet help. |
| **User-generated content (guideline 1.2)** | Dating and chat apps need: report, block, in-app account deletion, published contact details, and a promise to act on reports within 24 hours. | The first three exist. Write the 24-hour commitment into the review notes and make sure someone covers it (you are the only moderator). |
| **Export compliance** | `ITSAppUsesNonExemptEncryption` is `false`. The app has end-to-end encrypted messages. They use the system's own cryptography (WebKit), which is normally exempt, but check the answer in App Store Connect. | Answer the export questions carefully, with advice if unsure. Not changed here. |
| **Demo account** | Reviewers cannot use your account or your location. | Create two demo accounts with sample data and put the sign-in details in the review notes. Explain the consent screen and that chat is end-to-end encrypted. |

## 3. Not built yet
- **Native push notifications.** Web push does not run inside the app. Needs an Apple Push key (.p8, Key ID, Team ID), `@capacitor/push-notifications`, the Push Notifications entitlement, device-token storage, and an APNs sender in the `send-push` function.
- **Screenshots**: required for the 6.9 inch (1320 x 2868) iPhone size. Take them from the TestFlight build with demo data.
- **Privacy manifest** (`PrivacyInfo.xcprivacy`) for the app itself. Capacitor's own frameworks carry theirs. Upload a build, and add one only if Apple's email lists missing reasons (ITMS-91053).

## 4. Changed in this PR
- iPhone only (`TARGETED_DEVICE_FAMILY` 1). The layout is built for phones; leaving iPad on would require iPad screenshots and an iPad-quality layout. Revert if you want iPad.
- Portrait only, `arm64` required.

## 5. App Store Connect answers (check each yourself)
**Category:** Social Networking (secondary: Lifestyle). **Age rating:** expect 18+. Answer the questionnaire honestly: user-generated content yes, messaging yes, location yes, mature themes yes (dating, sexual orientation).

**App Privacy labels** (data you collect, linked to the person, not used for tracking):
| Type | Declare | Note |
|---|---|---|
| Contact info | Email address | |
| Identifiers | User ID, device ID | |
| Location | Precise location | Collected, then shown to others as an approximate position |
| User content | Photos, other content | |
| Sensitive info | Yes | Sexual orientation can be inferred |
| Messages | Not collected | End-to-end encrypted, we cannot read them. Confirm with Apple's definition. |
| Usage / diagnostics | None | No third-party analytics |

**Suggested listing text** (edit freely)
- *Name:* GAYZE. *Subtitle:* Real intent. Real time.
- *Promotional text:* See who is around and what they are up for, right now or later. Make a quick plan or host an event. Chats are end-to-end encrypted.
- *Description:* GAYZE is for adults who want to meet people nearby with a clear idea of why. Set what you are up for and when, see who is around, and start a chat when you both want to. Plan something spontaneous with a Quick plan, or host an event and choose who comes. Your exact location is never shown, event venues are only shared with people you accept, and messages are end-to-end encrypted. Block and report anyone, and delete your account any time. 18+ only.
- *Keywords:* gay,social,meet,events,nearby,plans,friends,dating,community
- *Support URL:* a page with a real contact address. *Marketing URL:* optional.

**Review notes to paste** (fill the brackets):
> GAYZE is an adults-only (18+) social app for meeting people nearby. Sign in with the demo account [email / password]. A consent screen appears first; tick the box to continue. Messages are end-to-end encrypted, so only the two participants can read them. Safety: every profile has Block and Report; Profile has Delete account; reports go to an admin console and are reviewed within 24 hours. Contact: [privacy/support email]. Location is used only while the app is open, and other members see an approximate position.

## 6. Order of work
1. TestFlight build on your phone (you).
2. Two-phone test pass (you, with me fixing what it finds).
3. Publish the reviewed privacy policy and set the contact addresses.
4. Sign in with Apple, then native push (me, after you supply the Apple keys).
5. Screenshots, listing, privacy labels, review notes, demo accounts.
6. Submit.

## 7. Nude photos in chat (decided 8 Nov 2026)
Members will send nude photos. The guidelines ban them, but chats are end-to-end encrypted, so GAYZE cannot see or scan them. Plan for it openly instead of hoping it does not happen.

**Answer the age rating honestly.** "Sexual content or nudity" should be **Infrequent**, not "None", because members can send it to each other. The 18+ override already makes the rating 18+; the point is that the answers are true.

**Built (PR "photo safety")**
- Photos other people send are hidden (blurred) until you tap them, and a Report button appears on the photo.
- The first time someone sends a photo on a device, a notice says nude and sexual images are not allowed, that sending an unrequested sexual image can be a criminal offence in England and Wales, and that the account will be suspended.

**Why it matters in law and for review**
- *Cyberflashing:* sending a sexual image of genitals to cause alarm or distress, or for gratification while reckless, is an offence in England and Wales (Online Safety Act 2023, section 66A of the Sexual Offences Act 2003). A blur and a report route show a reasonable effort.
- *Child sexual abuse material:* if anyone ever reports it, it must be reported to the authorities. Have a written procedure: preserve the report, do not forward the image, report to the IWF and the police, suspend the account.
- *App Review (guideline 1.2):* the report, block and delete-account tools, the published contact address, and the 24-hour action commitment are what Apple looks at. Say in the review notes that photos are hidden until opened and that explicit content is banned and acted on.
- *Online Safety Act:* the illegal-content risk assessment must name this risk and the measures taken.

**Next, in order of value**
1. On-device nudity detection (Apple's Sensitive Content Analysis, iOS 17 and later) to blur likely nude photos and warn before sending. Needs a small native plugin, so it comes after the first TestFlight round.
2. Only allow photos once both people have replied, or ask permission before the first photo.
3. A "report this photo" path that attaches the photo from the reporter's phone (it is encrypted, so only the reporter can supply it).
4. A written moderation procedure, with the 24-hour target and cover for when you are unavailable.
