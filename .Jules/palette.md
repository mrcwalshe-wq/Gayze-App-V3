## 2026-10-09 - Accessibility Attributes
**Learning:** Icon-only buttons inside dropdown actions lacked aria-labels, and forms in modal components missed htmlFor linkages.
**Action:** Always ensure nested or hidden dynamic elements maintain correct aria descriptions and label pairings.
## 2026-10-10 - Segmented Control Accessibility
**Learning:** Custom segmented controls and filter groups using raw buttons lack proper semantic grouping and state signaling for screen readers.
**Action:** Always wrap custom button groups in `role="group"` with an `aria-label` and apply `aria-pressed={isSelected}` on the individual buttons to convey the active toggle state.
