# GAYZE — Design Critique & Redesign

**Tagline:** Real Intent. Real Time.
Scope: mobile-first web MVP. Primary viewport: modern iPhone (390×844), desktop secondary.

---

## Part 1 — Critique of the previous build

### 1. Visual hierarchy problems

| Problem | Where | Effect |
|---|---|---|
| The map was framed by a permanent opaque header **and** a permanent bottom tab bar, so the "primary canvas" sat in a letterboxed slot. | Global shell | Map read as content *inside* a page, not as the product. |
| Two competing "primary" surfaces: a full dating grid (photos, stories tray, filter chips) and the live map. | Discover tab | First-time users could not tell whether GAYZE was a dating swipe app or a live-intent map. |
| Right Now had three stacked top overlays (mode chip + intent bar + filter button) plus four side buttons plus a bottom card. | Right Now view | Six+ competing affordances above the map; none clearly "the" action. |
| Purple and amber were used at equal strength everywhere (amber CTAs, purple CTAs, emerald badges, rose timers). | Whole app | No signal colour discipline → looks themed, not designed. |
| Typography: heavy use of `font-black uppercase tracking-wider` for section titles. | Sheets, cards | Reads "gamer/HUD", not premium. High noise, low hierarchy. |

### 2. UX friction

- **Intent creation** was one long scrollable form with "STEP 1/2/3" labels rendered simultaneously — progressive disclosure in name only. Users saw the whole form at once.
- The map opened its intent sheet **twice** (local state + App state both fired on one tap) — an actual redundancy bug.
- Filters lived in *two* places with overlapping jobs: the filter drawer (category/mode/distance/privacy) and a separate side "privacy circles" toggle that duplicated the drawer's "approximate location radius" switch.
- Empty state sat as a large card at the top of the map, covering the very map it was apologising for.
- Navigation exposed five *feature* destinations (Discover, Map, Later, Groups, Safe Havens) plus four utility buttons in the header — nine entry points before the user understood one loop.

### 3. Information overload

- Marker preview card showed: name, age, badges, countdown, compatibility badge, availability, distance, venue, description, and **three** equal-weight action buttons (Interested, Safe Meet, Message) with emoji (`Gaze 👀`).
- Chat sidebar labelled everything: `E2EE`, `AES-256-GCM`, `Device storage only`, `Encrypted Groups (n)` — security theatre in the chrome instead of quiet assurance.
- Filter drawer used 3-column button grids with 12 options and a permanent "Show N Active Nearby" CTA for a filter set of four values.

### 4. Redundant controls

- Header utility cluster (Safety, Verify, Mask, Identity) vs. the same actions repeated inside Profile/Identity flows.
- "Set Right Now Intent" top bar button, "Broadcast Your Live Intent" empty-state button, and a floating `+` — three entrances, three different labels, none designed as *the* primary action.
- Zoom controls existed both as custom rail and as Leaflet defaults in some states.

### 5. Mobile ergonomics

- Fixed header (56px) + fixed tab bar (56px) + safe areas consumed ≥ 140px of an 844px viewport on the map screen.
- The active-intent bar, filter button and side rail were all in the top 100px — hardest reach zone; the primary create action was never in the thumb zone.
- Several rows relied on `text-[10px]`/`font-mono` for *primary* content (availability, area) — below comfortable legibility.
- Bottom cards were positioned against `3.5rem + safe-area` guesses and could collide with the expanded sheet.

### 6. Weak intent affordances

- "Intent" was expressed as form fields (mode dropdown-ish grids, duration strings) rather than as a *signal* the user sets.
- Nothing on the map visualised live activity energy — no haze, no heat; the map was inert tiles + rings.
- The relationship between "your intent" and "nearby intents" was never shown in one place.

### 7. Inconsistent component patterns

- Three different bottom-sheet implementations (filter, discovery, intent) with different radii, handles, paddings and close affordances.
- Buttons: some `rounded-xl`, some `rounded-2xl`, some pill; some uppercase black weight, some semibold sentence case.
- Four accent colours used as CTA colour interchangeably.

### 8. Generic / "AI-generated" tells

- Gradient-washed cards (`from-[#C9A24D]/25 via-[#2a2215]`), glow shadows on every active chip, `shadow-[0_0_18px…]` on selection.
- Emoji in UI copy, `✓` characters used as iconography inside marker squares.
- Buzzword chrome: "PLANNED CONNECTIONS", "STEP 1 — DISCOVERY CONTEXT", "Keet-Inspired Top Bar" (a competitor name in a source comment, and copy that shouts instead of speaks).
- Density of pills/chips everywhere: every meta fact became a bordered capsule.

### 9. What made it feel less premium

Over-animation (`animate-ping` on multiple dots, pulsing borders), too many borders on borders, mixed font families used decoratively (mono for things that aren't data), and above all **lack of restraint**: no single quiet moment on screen. A premium product lets one element dominate; the old build gave every element a highlight.

---

## Part 2 — Redesign principles

1. **The map is the app.** On Right Now, UI is limited to: one top-left state chip, one top-right filter control, one right-side micro-rail, one bottom action bar. Everything else is a sheet that appears on demand and leaves the map visible behind it.
2. **One primary action per screen.** Right Now → *set your intent*. Discover → *open a conversation*. Messages → *reply*. Profile → *manage your signal*. The primary is purple; amber is reserved for **trust + connection confirmations** (verification, "Message" on a matched intent).
3. **Right Now is the strongest state.** A slow purple haze breathes over areas with live intent; the mode chip carries a live dot; the create-intent button glows only while broadcasting.
4. **Progressive disclosure, actually.** Intent creation reveals: mode → what → optional details. The footer is a single live-summary + `Go live`.
5. **Five destinations, no more.** Discover · Right Now · Later · Messages · Profile. Safety, verification, mask and identity live *inside* Profile (and as quiet map overlays) — never as parallel top-level navigation.
6. **Silent security.** Verification/reliability appear as small badges where trust matters (profile rows, previews) — not as permanent chrome.
7. **Never fabricate.** Empty states say exactly what is true ("No active intent nearby") and offer one action.

---

## Part 3 — The redesigned experience

### Navigation
- **Mobile:** no global header. Views are full-bleed; each non-map view owns a compact in-view header. One bottom tab bar (56px + safe inset), glass, hairline border, 44px+ targets, purple active state with a 2px top indicator. Nothing overlaps the map except this bar, which map controls explicitly clear.
- **Desktop:** one translucent 56px top bar — brand + neighbourhood, centre nav pill, right utilities (safety status, discreet mask, avatar → Profile).

### Right Now (default)
- **Top-left:** single state chip — live dot + `Right Now` + nearby count, which transforms into *your* broadcast (intent · countdown · area) when live. One tap opens the manage sheet.
- **Top-right:** filter control with an active-count badge (the only filter entry point).
- **Right rail:** locate-me, zoom in, zoom out. (Privacy-circle toggle removed — it lives in the filter sheet.)
- **Bottom bar:** discovery-drawer trigger (count of nearby intents) + primary **Set intent / LIVE** button. This is the thumb-zone primary action.
- **Activity haze:** two-layer purple radial circles (450 m / 200 m) breathe slowly over each live cluster; social intents ring amber, private intents ring purple, your position is a cool cyan core with a privacy ring.
- **Preview card** (tap a marker): identity + intent chip + countdown + one-line intent, then **one** primary action (Message) and two quiet secondaries (Gaze, Safe meet).
- **Discovery drawer:** bottom sheet listing nearby intents as rows — the map stays behind the scrim.
- **Empty state:** a compact glass slab in the lower third — map still visible around it: *"No active intent nearby"* → **Create your intent**.

### Intent creation ("setting a live signal")
1. **WHAT ARE YOU UP FOR?** → Social / Private (two tiles, one tap).
2. **WHAT?** → intent options appear instantly below (Meet · Drinks · Date · Chat · Group / Hookup Host · Hookup Travel · Hookup Outdoor · Hookup Car · Other).
3. **Details (optional):** when (Right Now ≤2 h / later options), duration, travel willingness, hosting, one-line description with suggestions, Safe Haven proximity.
4. Sticky footer: live summary + **Go live** (or **Update signal** when editing, with an End action).

### Filter sheet
Same sheet anatomy as intent creation (grip, label, sections, footer). Sections: *Show me* (category), *Intent* (All/Social/Private), *Distance* (3 presets), *Privacy radius* toggle. Footer: **Reset** (ghost) + **Show N nearby** (purple). ~⅓ the ink of the old drawer.

### Discover
Intent-first, single column, no photo grid: mode segmented (All/Social/Private) → rows of people *by current intent* (live intents sorted first) with availability, distance, reliability + verification badges. Tap opens a preview sheet → Message / Gaze / Safe meet / Verify. Empty → same "No active intent nearby" language + CTA that opens the composer.

### Later
Unchanged in behaviour, restyled to the shared sheet/typography language: quiet header, one amber host action, list-first.

### Messages
One list → thread, both inside the same shell. Security copy reduced to a single lock line in the composer header. No AES/QR/TTL badges in the chrome unless opened.

### Profile
Identity header (monogram, name, approximate area, verified + reliability badges) → **your signal** (live state, countdown, pause/edit/end, or purple *Create your intent* CTA) → attributes → Safety & privacy rows (check-in timer, Safe Havens, discreet mask, location privacy, QR verification, identity & devices). One surface, hairline dividers, no card grid.

---

## Part 4 — Design system reference

**Colour**
| Token | Value | Use |
|---|---|---|
| `--bg-app` | `#090A0E` | Obsidian canvas |
| `--brand-purple` | `#6F3CC3` | Primary action, live state, activity haze, active nav |
| `--brand-amber` | `#C9A24D` | Trust, verification, connection confirmations, social intent |
| `--status-emerald` | `#10B981` | Verification + safe-haven only |
| Text | `#F4F5F8 / #9DA3AF / #6B7280` | Primary / secondary / muted |

**Glass:** `rgba(13,14,20,0.86)` + `backdrop-blur(20px)` + `1px rgba(255,255,255,0.08)`; strong variant `0.94` opacity for sheets. One border per element, ever.

**Radius:** 10 (inputs/chips) · 14 (buttons/cards) · 18 (floating controls) · 24 (sheets).

**Spacing:** 4px grid; sheet padding 20px; section gap 20px; row gap 12px.

**Type:** Plus Jakarta Sans (UI) · JetBrains Mono (data only: countdowns, distances, keys). Section labels: 10px mono, `0.16em` tracking, muted. No `font-black` on full sentences.

**Motion:** spring `cubic-bezier(.22,1,.36,1)`; sheets 320ms translate, backdrop 200ms fade, taps `scale(.97)` 120ms, haze 7s breathing. All disabled under `prefers-reduced-motion`.

**Components:** `g-btn` (primary purple / amber / ghost / quiet), `g-chip` (social amber · private purple · live purple-pulse), `g-sheet` (grip + label + body + sticky footer), `g-seg` (segmented), `g-float` (map controls), `g-row` (list row), `g-badge` (verify / trust), `g-empty`, `g-toast`, `g-tabbar`.

**Removed on purpose:** stories tray on the map, photo-grid dating view as a primary tab, duplicate privacy toggles, emoji UI copy, glow-on-everything selection states, security-theatre chrome, "Groups/Safe Havens" as top-level destinations (now reachable from Messages list contextually and Profile/ map layers respectively).
