## 2026-10-09 - Accessibility Attributes
**Learning:** Icon-only buttons inside dropdown actions lacked aria-labels, and forms in modal components missed htmlFor linkages.
**Action:** Always ensure nested or hidden dynamic elements maintain correct aria descriptions and label pairings.

## 2024-11-20 - Mode Filters Accessibility
**Learning:** For custom segmented controls and mode filters using `<button>` tags (e.g., in DiscoverView), adding `aria-pressed={isSelected}` correctly conveys the active toggle state to screen readers.
**Action:** Always ensure container has `role="group"` with an `aria-label`, and inner buttons use `aria-pressed` for custom toggle groups.
