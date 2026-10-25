## 2026-10-09 - Accessibility Attributes
**Learning:** Icon-only buttons inside dropdown actions lacked aria-labels, and forms in modal components missed htmlFor linkages.
**Action:** Always ensure nested or hidden dynamic elements maintain correct aria descriptions and label pairings.

## 2026-10-25 - Custom Segmented Controls Accessibility
**Learning:** Custom segmented controls and mode filters using `<button>` tags (e.g., in DiscoverView, SafeHavenView) miss proper group roles and aria-pressed states.
**Action:** Ensure the container has `role="group"` with an `aria-label`, and the inner buttons use the `aria-pressed={isSelected}` attribute to properly convey the active toggle state to screen readers.
