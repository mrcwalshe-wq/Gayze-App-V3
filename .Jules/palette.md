## 2026-10-09 - Accessibility Attributes
**Learning:** Icon-only buttons inside dropdown actions lacked aria-labels, and forms in modal components missed htmlFor linkages.
**Action:** Always ensure nested or hidden dynamic elements maintain correct aria descriptions and label pairings.
## 2026-10-22 - Accessibility Attributes for Groups
**Learning:** Found custom segmented controls missing `role="group"` and `aria-label` wrappers, even when inner buttons use `aria-pressed`. Screen readers need the grouping context to understand the relationship between the toggle buttons.
**Action:** Ensure custom segmented control components (like IntentMode) wrap their toggle buttons in a container with `role="group"` and an appropriate `aria-label`.
