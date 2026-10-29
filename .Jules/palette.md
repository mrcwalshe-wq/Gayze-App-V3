## 2026-10-09 - Accessibility Attributes
**Learning:** Icon-only buttons inside dropdown actions lacked aria-labels, and forms in modal components missed htmlFor linkages.
**Action:** Always ensure nested or hidden dynamic elements maintain correct aria descriptions and label pairings.

## 2026-10-29 - Safe Haven Filter Accessibility
**Learning:** Filter controls built with dynamic map iterations lack group containment and ARIA pressed states, leading to poor screen reader navigation.
**Action:** Apply `role="group"` to pill containers and `aria-pressed` to individual filter buttons for complex view filtering.
