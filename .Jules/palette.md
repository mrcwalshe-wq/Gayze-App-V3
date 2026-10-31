## 2026-10-09 - Accessibility Attributes
**Learning:** Icon-only buttons inside dropdown actions lacked aria-labels, and forms in modal components missed htmlFor linkages.
**Action:** Always ensure nested or hidden dynamic elements maintain correct aria descriptions and label pairings.
## 2026-10-31 - Accessible Segmented Controls
**Learning:** Custom segmented controls and mode filters built with generic containers and buttons lack native grouping and state announcements for screen readers.
**Action:** Always wrap custom segmented control buttons in a container with `role="group"` and an `aria-label`, and ensure the individual buttons use `aria-pressed` to indicate their active state.
