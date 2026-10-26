## 2026-10-09 - Accessibility Attributes
**Learning:** Icon-only buttons inside dropdown actions lacked aria-labels, and forms in modal components missed htmlFor linkages.
**Action:** Always ensure nested or hidden dynamic elements maintain correct aria descriptions and label pairings.
## 2026-10-23 - Segmented Control Accessibility
**Learning:** Custom segmented controls built with buttons (like the Discover mode filter) lack native ARIA grouping and state.
**Action:** Apply `role="group"`, `aria-label`, and `aria-pressed` to convey structural boundaries and active toggle states to screen readers.
