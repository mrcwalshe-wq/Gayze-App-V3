## 2026-10-09 - Accessibility Attributes
**Learning:** Icon-only buttons inside dropdown actions lacked aria-labels, and forms in modal components missed htmlFor linkages.
**Action:** Always ensure nested or hidden dynamic elements maintain correct aria descriptions and label pairings.
## 2026-10-09 - Accessible Toggle Groups
**Learning:** Custom segmented controls and mode filters (using standard `<button>` tags without input radio ties) lacked proper grouping context for screen readers. They visually indicate the active state but did not programmatically convey this to assistive technologies.
**Action:** When creating custom tab bars or filter groups with standard buttons, always wrap the buttons in a container with `role="group"` and an `aria-label`, and use `aria-pressed={isActive}` on the inner buttons to announce state changes correctly.
