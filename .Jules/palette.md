## 2026-10-09 - Accessibility Attributes
**Learning:** Icon-only buttons inside dropdown actions lacked aria-labels, and forms in modal components missed htmlFor linkages.
**Action:** Always ensure nested or hidden dynamic elements maintain correct aria descriptions and label pairings.
## 2026-10-28 - ARIA group on filter pills
**Learning:** Custom segmented controls and toggle filters (like in SafeHavenView) frequently use `div` containers and simple `button` lists. These lack structural semantics for screen readers.
**Action:** Add `role="group"`, an informative `aria-label` to the container, and `aria-pressed` to the active buttons in these structures to convey state and grouping to AT.
