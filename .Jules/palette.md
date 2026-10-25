## 2026-10-09 - Accessibility Attributes
**Learning:** Icon-only buttons inside dropdown actions lacked aria-labels, and forms in modal components missed htmlFor linkages.
**Action:** Always ensure nested or hidden dynamic elements maintain correct aria descriptions and label pairings.

## 2026-10-25 - Segmented Control Accessibility
**Learning:** Custom segmented controls and mode filters built with `<button>` tags (e.g., in DiscoverView, SafeHavenView) lacked `role="group"`, `aria-label`, and `aria-pressed` states, making it difficult for screen reader users to understand the current selection and context.
**Action:** Always wrap custom segmented controls and filter buttons in a container with `role="group"` and an appropriate `aria-label`. Ensure individual toggle buttons use the `aria-pressed={isSelected}` attribute to convey their active state to assistive technologies.
