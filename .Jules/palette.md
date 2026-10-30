## 2026-10-09 - Accessibility Attributes
**Learning:** Icon-only buttons inside dropdown actions lacked aria-labels, and forms in modal components missed htmlFor linkages.
**Action:** Always ensure nested or hidden dynamic elements maintain correct aria descriptions and label pairings.
## 2026-10-30 - Form Label Accessibility
**Learning:** Several forms and configuration sheets (like `ProfileEditSheet`, `ProfileOnboarding`, `IdentityModal`, and `SetIntentSheet`) relied on visual layout or placeholder text rather than proper ARIA attributes (`aria-label`) or linked `<label htmlFor="...">` tags, causing screen readers to announce inputs generically.
**Action:** Always verify that every `<input>` has either a linked visible `<label>` via `htmlFor` and `id`, or a descriptive `aria-label` when the label is implicitly understood visually.
