## 2026-10-09 - Accessibility Attributes
**Learning:** Icon-only buttons inside dropdown actions lacked aria-labels, and forms in modal components missed htmlFor linkages.
**Action:** Always ensure nested or hidden dynamic elements maintain correct aria descriptions and label pairings.
## 2026-10-10 - Segmented Controls
**Learning:** Custom segmented controls built with flex/grid containers of buttons did not expose their grouped nature or active state (via `aria-pressed`) to assistive technology.
**Action:** When creating segmented mode toggles or filter pills out of basic buttons, wrap them in `role="group"` with an `aria-label`, and use `aria-pressed` on the active child button.
