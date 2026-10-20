## 2026-10-09 - Accessibility Attributes
**Learning:** Icon-only buttons inside dropdown actions lacked aria-labels, and forms in modal components missed htmlFor linkages.
**Action:** Always ensure nested or hidden dynamic elements maintain correct aria descriptions and label pairings.
## 2024-03-24 - Segmented Controls and Visible Text Labels
**Learning:** For custom segmented controls and mode filters using `<button>` tags (e.g., in DiscoverView), ensure the container has `role="group"` with an `aria-label`, and the inner buttons use the `aria-pressed={isSelected}` attribute to properly convey the active toggle state to screen readers. Also, do not apply `aria-label` to buttons that already contain rich visible text (e.g., `<strong>` or `<span>` tags with text), as it causes screen readers to ignore the child elements (violates WCAG 2.5.3).
**Action:** Apply `role="group"`, `aria-label`, and `aria-pressed` for segmented toggles. Remove redundant `aria-label`s from buttons that already have descriptive visible text.
