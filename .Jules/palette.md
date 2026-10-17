## 2026-10-09 - Accessibility Attributes
**Learning:** Icon-only buttons inside dropdown actions lacked aria-labels, and forms in modal components missed htmlFor linkages.
**Action:** Always ensure nested or hidden dynamic elements maintain correct aria descriptions and label pairings.
## 2026-10-13 - Form Accessibility (Label associations)
**Learning:** Found multiple form `<label>` elements missing the `htmlFor` attribute linking them to their corresponding `<input>` or `<textarea>` tags, reducing screen reader compatibility and clickability.
**Action:** Always ensure `htmlFor` attributes on labels match the `id` attributes of the inputs they group, especially in modal components and authentication views.
