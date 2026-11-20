## 2026-10-09 - Accessibility Attributes
**Learning:** Icon-only buttons inside dropdown actions lacked aria-labels, and forms in modal components missed htmlFor linkages.
**Action:** Always ensure nested or hidden dynamic elements maintain correct aria descriptions and label pairings.
## 2025-05-18 - SafeHavenView Accessibility Enhancements
**Learning:** Found an accessibility issue pattern specific to this app's components: custom segmented controls and mode filters using `<button>` tags were missing appropriate roles and states for screen readers.
**Action:** Always ensure that filter containers have `role="group"` with an `aria-label`, and the inner buttons use the `aria-pressed={isSelected}` attribute to convey the active toggle state.
