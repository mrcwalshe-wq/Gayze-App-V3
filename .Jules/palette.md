## 2026-10-09 - Accessibility Attributes
**Learning:** Icon-only buttons inside dropdown actions lacked aria-labels, and forms in modal components missed htmlFor linkages.
**Action:** Always ensure nested or hidden dynamic elements maintain correct aria descriptions and label pairings.
## 2026-10-09 - Segmented Controls
**Learning:** Custom segmented controls using mapped `<button>` tags lacked a group grouping and toggle state.
**Action:** Always wrap segmented buttons in a container with `role="group"` and `aria-label`, and use `aria-pressed={isSelected}` for the individual buttons.
