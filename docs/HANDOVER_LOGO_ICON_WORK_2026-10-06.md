# HANDOVER — GAYZE logo & app-icon work (2026-10-06, evening session)

Purpose: transfer full context of the in-progress logo/icon fix to a new chat.
Status: **work in progress — blocked on receiving the user's real logo files.**

---

## 1. What the user wants (their words)

> "These are my logo not that monstrosity on discover icon in app. Also the app iPhone icon is missing"

- The user **rejects** the current Discover-tab mark and the PWA/iOS icon artwork (the
  gradient "G-eye"). These are NOT their logo. Do not regenerate or re-derive anything
  from them. Issue #8 also says: "Do not redesign the logo or substitute a generic G/eye mark."
- The user wants:
  1. The **Discover tab icon** in the mobile nav replaced with their real logo.
  2. The **iPhone home-screen icon** fixed (currently missing on iOS).
- Implied: the whole icon surface (favicon, PWA icons, maskable, apple-touch) should be
  rebuilt from their real logo.

## 2. BLOCKER: the user's logo files never arrived

The user attached images **twice**; none persisted into the workspace:

- Attempt 1 (6 files): `IMG_1342.png`, `IMG_1174.jpeg`, `3490FBAE-5877-4BC4-97ED-1B4A740D5816.png`, `IMG_0931.jpeg`, `IMG_1202.jpeg`, `IMG_1205.jpeg`
- Attempt 2 (1 file): `IMG_1343.jpeg`
- `/home/user/uploads/` never existed; full-filesystem searches found nothing.
- This assistant also has **no vision** — chat-embedded images are unusable even when
  the message shows them.

**First action for the next chat:** ask the user to re-supply the logo. The reliable
route (verified working from this sandbox): have the user attach the images to a
**GitHub issue** on `mrcwalshe-wq/Gayze-App-V3`, then download via
`gh api repos/mrcwalshe-wq/Gayze-App-V3/issues/<n>/assets` or the asset URLs.
Re-check `/home/user/uploads/` first in case the platform fixed the attachment path.

## 3. Root-cause findings (already diagnosed)

### 3.1 Why the iPhone icon is missing — `public/apple-touch-icon.png` was CORRUPT
- PNG container looked structurally complete (IHDR 180×180, colortype 2, IDAT, IEND)
  but the **IDAT stream failed zlib decompression** (`incorrect data check`) and the
  IDAT **CRC mismatched** (stored `9ad27ebc`, calculated `f2b62b72`).
- iOS cannot decode it → blank/screenshot home-screen tile. The corrupt file had
  shipped to production (deployed via their Cloudflare setup).
- Diagnostic technique (reusable): parse PNG chunks in Python, `zlib.decompress` the
  IDAT, compare `zlib.crc32(typ+data)` to the stored CRC.

### 3.2 The "monstrosity" — where the rejected artwork lives
- `public/gayze-discover-logo.svg` (1000×499, purple→pink→orange gradient G-eye) —
  rendered in the **mobile nav Discover tab**: `src/components/Navbar.tsx` (~line 73,
  `<img src="/gayze-discover-logo.svg?v=20261006-3">` inside `renderTabIcon`, case
  `tab.id === 'dating'`, mobile branch).
- `public/icons/gayze-app-icon.svg` (512 viewBox, white eye + spectrum gradient) —
  the favicon (`index.html` line ~20) and manifest icon.
- `public/icons/gayze-180.png`, `gayze-192.png`, `gayze-512.png`, `gayze-512-maskable.png`
  and (formerly) `apple-touch-icon.png` — same eye-mark family.
- The **approved real logo** the user does accept (used on splash/loading, auth,
  desktop header) is the wide mark: `public/gayze-logo.jpg` / `public/gayze-official-logo.webp`
  (1536×874, valid) referenced by `src/components/GayzeLogo.tsx`
  (`GAYZE_LOGO_PATH = '/gayze-official-logo.webp'`).

### 3.3 Cache layers that MUST be bumped when icons change
- `index.html`: `?v=20261006-3` on manifest link, apple-touch-icon links, favicon
  links, and the `/gayze-nav-final.css` stylesheet link.
- `public/manifest.webmanifest`: `?v=` on every icon `src`.
- `src/components/Navbar.tsx`: `?v=` on the discover-logo `<img>`.
- `public/service-worker.js`: `SW_VERSION = 'gayze-sw-v11'` and `ICON_VERSION`
  (used in `PRECACHE_URLS`, which precaches apple-touch-icon + all `/icons/*.png`;
  `NOTIFICATION_ICON = '/icons/gayze-192.png'` has no version param).
- Cloudflare `_headers` caches `/icons/*` for 7 days — version bump is what forces refresh.

## 4. Work already done this session (on branch `arena/bc811c00-gayze-app-v3`)

- **Regenerated `public/apple-touch-icon.png`** from `public/icons/gayze-512.png`
  (LANCZOS downscale → 180×180 RGB, verified end-to-end: zlib decompresses, all CRCs
  valid). **This is a STOPGAP**: it restores a decodable icon so iOS shows *something*,
  but it still uses the rejected eye-mark artwork. Must be regenerated from the user's
  real logo once received.
- Full audit of logo/icon usage across the repo (results in section 3.2 above and
  the file map in section 6).

## 5. Remaining tasks (in order)

1. Obtain the user's real logo files (see section 2). Pick the best source image
   (highest resolution; prefer one with transparent or clean background).
2. Regenerate the icon set from it:
   - `public/apple-touch-icon.png` — 180×180, **opaque RGB** (iOS skips transparent
     ones), logo centred with padding.
   - `public/icons/gayze-180.png`, `gayze-192.png`, `gayze-512.png`.
   - `public/icons/gayze-512-maskable.png` — logo within the ~80% safe zone
     (20% padding on all sides).
   - `public/icons/gayze-app-icon.svg` (favicon/manifest) — ideally rebuild as SVG
     from the logo if a vector source exists; otherwise export PNG fallbacks only.
3. Replace the Discover tab mark (`public/gayze-discover-logo.svg` or swap the
   `<img>` target in `Navbar.tsx`). The desktop Discover badge already uses
   `GayzeLogo` (the approved webp) — check both still look right at 20–30 px.
4. Bump every cache version listed in section 3.3 (single coordinated bump, e.g.
   `?v=20261007-1` and `SW_VERSION 'gayze-sw-v12'`).
5. Verify: `npm install && npm run build` (also lint/typecheck if scripts exist —
   check `package.json`); visually check splash, auth, desktop header, mobile nav,
   favicon at mobile + desktop viewports.
6. Commit on the session's arena branch, push, open PR.
7. Housekeeping (user was informed, not yet decided): close superseded conflicting
   PRs **#20** (`fix/premium-navbar-logo`) and **#21** (Jules bottom-nav) — both
   `mergeable_state: dirty` and superseded by main; optionally remove unused brand
   assets (`public/ChatGPT Image Sep 27, 2026, 02_03_19 PM.png` 356 KB committed to
   prod, `public/gayze-logo.webp` byte-duplicate of official webp,
   `public/gayze-logo-mark.svg` unreferenced). Issue **#8** (logo + hue polish +
   drawers + map controls + 5 km travel-radius cap) remains open.

## 6. Key file map

| File | Role |
|---|---|
| `src/components/GayzeLogo.tsx` | In-app logo component (approved webp) — splash, auth, desktop header |
| `src/components/GayzeLoadingScreen.tsx` | Splash/gazing screens, uses `GAYZE_LOGO_PATH` |
| `src/components/AuthView.tsx` | Sign-in, `GayzeLogo size={62}` |
| `src/components/Navbar.tsx` | Desktop header + mobile bottom nav; Discover tab img (line ~73) |
| `public/gayze-official-logo.webp` | Approved wide logo (1536×874) |
| `public/gayze-discover-logo.svg` | REJECTED gradient G-eye (mobile Discover tab) |
| `public/icons/gayze-app-icon.svg` | REJECTED eye favicon/manifest icon |
| `public/icons/gayze-{180,192,512,512-maskable}.png` | PWA icons (eye-mark family) |
| `public/apple-touch-icon.png` | iOS home-screen icon (was corrupt; now stopgap) |
| `public/service-worker.js` | PWA + push; precaches icons; version consts |
| `public/manifest.webmanifest` | PWA manifest, icon list with `?v=` |
| `index.html` | Icon/manifest/stylesheet links with `?v=` |
| `public/gayze-nav-final.css` | "Obsidian Velvet" mobile nav styling (`g-discover-*`, `g-tab__*`) |

## 7. Environment gotchas

- Repo: `mrcwalshe-wq/Gayze-App-V3` at `/home/user/Gayze-App-V3`; branch
  `arena/bc811c00-gayze-app-v3`; **shallow clone** (local log shows 1 commit — use
  `gh api` / GitHub web for history).
- **`https://gayze.co.uk` is NOT reachable from this sandbox** (TLS connect fails;
  `api.github.com` works). Cannot verify production directly.
- Pillow works via `pip install --break-system-packages pillow` (12.3.0 installed).
- Brand constants: Purple `#6F3CC3`, Amber `#C9A24D`, app background `#090a0f`.
- Stack: React + Vite + TS + Tailwind, Supabase, Leaflet, Cloudflare Workers
  (`wrangler.toml`, `public/_headers`).
- Do not use image-generation tools to invent a logo — the user wants THEIR files only.
