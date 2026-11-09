# Local copies of the brand fonts (test harness only)

Served to the visual tests by route interception in `e2e/support/harness.ts`, so baselines do not depend on
Google Fonts. The app itself (`index.html`) is unchanged and still loads the fonts from Google at runtime.

| Family | Files (latin, latin-ext, variable) | Licence |
|---|---|---|
| Plus Jakarta Sans | `LDIoaomQNQcsA88c7O9yZ4KMCoOg4Ko*.woff2` | SIL OFL 1.1, `PlusJakartaSans-OFL.txt` |
| JetBrains Mono | `tDbv2o-flEEny0FZhsfKu5WU4zr3E_BX0PnT8RD8yKwBNntkaToggR7BYRbKPx*.woff2` | SIL OFL 1.1, `JetBrainsMono-OFL.txt` |

Source: the Google Fonts CSS2 API response for the exact family/weight query in `index.html`, latin and latin-ext subsets only.
