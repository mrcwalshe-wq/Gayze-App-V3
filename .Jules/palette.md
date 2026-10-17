## 2026-10-09 - Accessibility Attributes
**Learning:** Icon-only buttons inside dropdown actions lacked aria-labels, and forms in modal components missed htmlFor linkages.
**Action:** Always ensure nested or hidden dynamic elements maintain correct aria descriptions and label pairings.
## 2026-10-15 - ARIA labels vs Visible Text
**Learning:** Adding `aria-label` to buttons that already contain rich visible text (e.g., `<strong>` or `<span>` tags with text) causes screen readers to ignore the child elements and only read the `aria-label`. This violates WCAG 2.5.3 (Label in Name) and can negatively impact speech-input users who might use the visible text to interact.
**Action:** Do not override visible text with `aria-label`. Reserve `aria-label` for icon-only buttons. If additional context is needed alongside visible text, use `aria-describedby` instead.
