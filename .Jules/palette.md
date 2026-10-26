## 2026-10-09 - Accessibility Attributes
**Learning:** Icon-only buttons inside dropdown actions lacked aria-labels, and forms in modal components missed htmlFor linkages.
**Action:** Always ensure nested or hidden dynamic elements maintain correct aria descriptions and label pairings.
## 2026-10-26 - Accessible Segmented Controls
**Learning:** The mode filters in DiscoverView and SafeHavenView used a group of `<button>`s inside a `<div>`, but lacked `role="group"`, `aria-label`, and `aria-pressed` states, making them difficult to interact with via screen readers.
**Action:** When implementing custom segmented controls with buttons, always wrap them in a `role="group"` with an `aria-label` and ensure each internal button reflects its selection state via `aria-pressed={isSelected}`.
