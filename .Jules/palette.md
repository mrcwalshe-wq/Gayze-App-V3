## 2026-10-09 - Accessibility Attributes
**Learning:** Icon-only buttons inside dropdown actions lacked aria-labels, and forms in modal components missed htmlFor linkages.
**Action:** Always ensure nested or hidden dynamic elements maintain correct aria descriptions and label pairings.
## 2024-11-02 - Segmented Control Accessibility
**Learning:** Custom segmented controls built with `button` tags inside a wrapper `div` lack necessary context for screen readers to understand they are related toggle choices.
**Action:** Always add `role="group"` and `aria-label` to the container `div`, and ensure inner toggle buttons use `aria-pressed` to indicate their active state.
