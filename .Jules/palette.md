## 2026-10-09 - Accessibility Attributes
**Learning:** Icon-only buttons inside dropdown actions lacked aria-labels, and forms in modal components missed htmlFor linkages.
**Action:** Always ensure nested or hidden dynamic elements maintain correct aria descriptions and label pairings.
## 2025-02-23 - Screen reader friendly segmented controls
**Learning:** Found multiple segmented controls (mode filter in DiscoverView, type filter in SafeHavenView) lacking group context for screen readers. Using `role="group"` on the container with an `aria-label`, and `aria-pressed` on the toggle buttons correctly conveys the active state to AT users.
**Action:** Always wrap custom segmented button controls with `role="group"` and `aria-label`, and use `aria-pressed` to indicate selection state on the buttons themselves.
