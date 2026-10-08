## 2026-10-09 - Accessible Form Inputs
**Learning:** Found that multiple core components (`AuthView`, `IdentityModal`, `RightNowView`) lacked proper `<label htmlFor="...">` associations with their `<input>`/`<textarea>` fields, relying on visual proximity or generic `<label>` wrapping without screen-reader compliant identifiers.
**Action:** Always verify that every form input field (including visually nested ones) has an explicit `id` and a corresponding `htmlFor` attribute on its label to ensure reliable programmatic accessibility across all screen readers.
