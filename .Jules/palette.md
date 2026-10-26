## 2026-10-09 - Accessibility Attributes
**Learning:** Icon-only buttons inside dropdown actions lacked aria-labels, and forms in modal components missed htmlFor linkages.
**Action:** Always ensure nested or hidden dynamic elements maintain correct aria descriptions and label pairings.

## 2024-05-23 - Segmented Controls Accessibility
**Learning:** Custom segmented controls and filter groups using `<button>` elements lack native active state announcements, leaving screen reader users unaware of the currently selected filter.
**Action:** Always wrap custom segmented controls in a container with `role="group"` and an `aria-label`, and add `aria-pressed={isActive}` to the individual buttons.
