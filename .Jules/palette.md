## 2026-10-09 - Accessibility Attributes
**Learning:** Icon-only buttons inside dropdown actions lacked aria-labels, and forms in modal components missed htmlFor linkages.
**Action:** Always ensure nested or hidden dynamic elements maintain correct aria descriptions and label pairings.

## 2026-10-10 - Segmented Control Accessibility
**Learning:** Custom segmented controls built with multiple `<button>` tags (e.g. for mode filters) need container semantics to be properly read by screen readers.
**Action:** Always wrap segmented `<button>` groups in a container with `role="group"` and an `aria-label`, and use `aria-pressed` on the active/inactive buttons to convey the toggle state.
