## 2026-10-09 - Accessibility Attributes
**Learning:** Icon-only buttons inside dropdown actions lacked aria-labels, and forms in modal components missed htmlFor linkages.
**Action:** Always ensure nested or hidden dynamic elements maintain correct aria descriptions and label pairings.
## 2024-10-30 - Custom segmented controls
**Learning:** Custom segmented controls built with buttons need a grouping container with an `aria-label` so screen readers understand the context of the `aria-pressed` states.
**Action:** Always wrap custom mode filters and tab-like button lists in a `role="group"` container with a descriptive `aria-label`. Ensure the inner buttons use the `aria-pressed` attribute correctly.
