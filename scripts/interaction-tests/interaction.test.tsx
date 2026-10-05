/**
 * GAYZE interaction / regression tests.
 *
 * Mounts the REAL components with React 19 inside jsdom, so the assertions run
 * against the shipped JSX, the shipped Leaflet wiring and the shipped CSS class
 * names — not against a re-implementation of them.
 *
 * Run: npx tsx scripts/interaction-tests/interaction.test.tsx
 */
const { flushIntervals } = await import('./env.mjs');

const React = (await import('react')).default;
const { createRoot } = await import('react-dom/client');
const { act } = await import('react');

const { RightNowView, MAX_TRAVEL_DISTANCE_KM, clampTravelDistanceKm } =
  await import('../../src/components/RightNowView.tsx');
const mapDefaults = await import('../../src/config/mapDefaults.ts');

let failures = 0;
function assert(cond, msg) {
  if (!cond) { console.error('  \u2717 FAIL:', msg); failures += 1; process.exitCode = 1; }
  else console.log('  \u2713', msg);
}
const section = (t) => console.log(`\n=== ${t} ===`);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ---------------------------------------------------------------------------
// Test doubles
// ---------------------------------------------------------------------------
const now = Date.now();
const HOUR = 3600_000;

function makePulse(over = {}) {
  return {
    id: `p_${Math.random().toString(36).slice(2)}`,
    peerId: 'user-1', peerName: 'Alex', peerShortKey: 'abcd1234\u2026',
    peerAvatar: 'user', title: 'SOCIAL \u00b7 Coffee', description: 'Coffee nearby',
    activityCategory: 'coffee', intentMode: 'social', intent: 'Coffee',
    venueName: 'Nearby', neighborhood: 'Near you',
    approxDistanceKm: 0.4, jitterMeters: 300,
    lat: 51.51 + Math.random() * 0.001, lng: -0.12 + Math.random() * 0.001,
    durationHours: 1, createdAt: now, expiresAt: now + HOUR, tags: ['Coffee', 'social'],
    isPaused: false,
    ...over,
  };
}

/** Records every camera move Leaflet is asked to make. */
const flyToCalls = [];
const leaflet = await import('leaflet');
const origFlyTo = leaflet.Map.prototype.flyTo;
const origSetView = leaflet.Map.prototype.setView;

// `flyTo` is the camera move the app uses for the locate control and the
// first-fix placement, so it is recorded and swallowed (no animation in jsdom).
leaflet.Map.prototype.flyTo = function flyTo(...args) {
  flyToCalls.push({ method: 'flyTo', center: args[0], zoom: args[1] });
  return this;
};
// `setView` MUST still run: Leaflet's own constructor uses it to mark the map
// loaded, and markers never attach to an unloaded map. Record it, then delegate.
leaflet.Map.prototype.setView = function setView(...args) {
  flyToCalls.push({ method: 'setView', center: args[0], zoom: args[1] });
  if (!createdMaps.includes(this)) createdMaps.push(this);
  return origSetView.apply(this, args);
};
/** Camera moves only (excludes Leaflet's internal setView during setup). */
const cameraMoves = () => flyToCalls.filter((c) => c.method === 'flyTo').length;

// Capture every Map instance the app creates so drag/zoom state can be asserted
// directly instead of inferred from the DOM. ESM exports are frozen, so the
// instance is picked up from `setView`, which Leaflet's own constructor calls.
const createdMaps = [];

/** Leaflet attaches markers on a later effect pass; wait for the DOM to settle. */
const SETTLE_MS = 150;

async function mount(props) {
  flyToCalls.length = 0;
  createdMaps.length = 0;
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  await act(async () => {
    root.render(React.createElement(RightNowView, {
      pulses: [],
      safeHavens: [],
      userNeighborhood: 'Near you',
      userLocation: { lat: 51.5, lng: -0.12 },
      onOpenDirectChat: () => {},
      onSelectHaven: () => {},
      ...props,
    }));
  });
  await act(async () => { await sleep(SETTLE_MS); });
  return {
    container,
    root,
    async rerender(next) {
      await act(async () => {
        root.render(React.createElement(RightNowView, {
          pulses: [], safeHavens: [], userNeighborhood: 'Near you',
          userLocation: { lat: 51.5, lng: -0.12 },
          onOpenDirectChat: () => {}, onSelectHaven: () => {},
          ...props, ...next,
        }));
      });
      await act(async () => { await sleep(SETTLE_MS); });
    },
    async unmount() { await act(async () => root.unmount()); container.remove(); },
  };
}

const text = (c) => c.textContent || '';
const click = async (el) => { await act(async () => { el.dispatchEvent(new window.MouseEvent('click', { bubbles: true })); }); await act(async () => { await sleep(10); }); };
const byText = (c, re) => Array.from(c.querySelectorAll('button')).find((b) => re.test(b.textContent || ''));

// Exact selectors read off the shipped markup.
const SEL = {
  openFilters: '[aria-label="Open discovery filters"]',
  closeFilters: '[aria-label="Close filters"]',
  nearbyList: '.g-nearby-btn',
  closeNearby: '[aria-label="Close nearby list"]',
  locate: '[aria-label="Locate me"]',
  pill: (label) => Array.from(document.querySelectorAll('button'))
    .find((b) => (b.textContent || '').trim() === label),
};

// ===========================================================================
section('[1] TRAVEL DISTANCE \u2014 5 km ceiling in the pure clamp');
assert(mapDefaults.MAX_TRAVEL_DISTANCE_KM === 5, 'MAX_TRAVEL_DISTANCE_KM is 5');
assert(MAX_TRAVEL_DISTANCE_KM === 5, 'RightNowView re-exports the same 5 km ceiling');
assert(clampTravelDistanceKm(10) === 5, '10 km clamps to 5 km');
assert(clampTravelDistanceKm(25) === 5, '25 km clamps to 5 km');
assert(clampTravelDistanceKm(1000) === 5, '1000 km clamps to 5 km');
assert(clampTravelDistanceKm(3) === 3, '3 km is preserved');
assert(clampTravelDistanceKm(5) === 5, '5 km is preserved');
assert(clampTravelDistanceKm(0) === 5 && clampTravelDistanceKm(-7) === 5, '0 / negative fall back to the 5 km ceiling');
assert(clampTravelDistanceKm(NaN) === 5 && clampTravelDistanceKm(Infinity) === 5, 'NaN / Infinity fall back to the 5 km ceiling');

// ===========================================================================
section('[2] TRAVEL DISTANCE \u2014 the UI cannot offer or set more than 5 km');
{
  const m = await mount({ pulses: [] });
  assert(text(m.container).includes('Nothing is live within 5 km'), 'empty state advertises the 5 km ceiling');
  assert(!/10 km|25 km/.test(text(m.container)), 'no 10 km / 25 km wording anywhere in the empty state');
  const widen = byText(m.container, /Widen radius/i);
  assert(!widen, 'no "widen radius" escape hatch when already at the 5 km ceiling');
  await m.unmount();
}
{
  // Narrow first, then confirm the only way back up is the 5 km ceiling.
  const m = await mount({ pulses: [makePulse()] });
  const filtersBtn = m.container.querySelector(SEL.openFilters);
  assert(Boolean(filtersBtn), 'filter control is present');
  if (filtersBtn) {
    await click(filtersBtn);
    const pill3 = Array.from(m.container.querySelectorAll('button')).find((b) => (b.textContent || '').trim() === '< 3 km');
    assert(Boolean(pill3), 'the "< 3 km" pill exists');
    if (pill3) await click(pill3);
    assert(!/Widen radius to 10 km|Widen radius to 25 km/.test(text(m.container)),
      'after narrowing, no 10 km / 25 km option is offered');
    const pill10 = Array.from(m.container.querySelectorAll('button')).find((b) => /^(10|25)\s*km/.test((b.textContent || '').trim()));
    assert(!pill10, 'the distance pill row offers no 10 km / 25 km button');
  }
  await m.unmount();
}

// ===========================================================================
section('[3] TRAVEL DISTANCE \u2014 the selected distance reaches discovery');
{
  const seen = [];
  const m = await mount({ pulses: [makePulse()], onMaxDistanceKmChange: (km) => seen.push(km) });
  assert(seen.length > 0 && seen[seen.length - 1] === 5, 'reports the default 5 km to App on mount');

  const filtersBtn = m.container.querySelector(SEL.openFilters);
  await click(filtersBtn);
  const pill1 = Array.from(m.container.querySelectorAll('button')).find((b) => (b.textContent || '').trim() === '< 1 km');
  assert(Boolean(pill1), 'the "< 1 km" pill exists');
  if (pill1) await click(pill1);
  assert(seen[seen.length - 1] === 1, 'selecting "< 1 km" reports 1 km to App (so discovery re-runs at 1000 m)');
  assert(seen.every((km) => km >= 1 && km <= 5), 'every reported distance is inside 1..5 km');
  await m.unmount();
}

// ===========================================================================
section('[4] MAP \u2014 pannable, and GPS updates do not constantly recenter');
{
  const m = await mount({ pulses: [makePulse()] });
  const mapEl = m.container.querySelector('.leaflet-container');
  assert(Boolean(mapEl), 'the Leaflet map mounts');

  // Leaflet must leave dragging enabled, or the map is not pannable.
  const live = createdMaps[createdMaps.length - 1];
  assert(Boolean(live), 'captured the live Leaflet Map instance');
  if (live) {
    assert(live.dragging && live.dragging.enabled(), 'map dragging handler is enabled');
    assert(live.options.dragging !== false, 'dragging is not disabled in the map options');
    assert(live.options.touchZoom !== false || live.options.scrollWheelZoom !== false,
      'pinch-zoom / wheel-zoom remain available');
    assert(typeof live.getCenter === 'function' && Number.isFinite(live.getCenter().lat),
      'the map has a real centre (not a collapsed jsdom pane)');
  }

  // The map is constructed already centred on the fix (Leaflet setView), so no
  // extra flyTo is needed at mount — that is the intended one-shot placement.
  const initViews = flyToCalls.filter((c) => c.method === 'setView');
  const centredOnUser = initViews.some((c) => {
    const pt = c.center;
    return pt && Math.abs(pt.lat - 51.5) < 1e-6 && Math.abs(pt.lng - -0.12) < 1e-6;
  });
  assert(centredOnUser, 'the map is initialised centred on the device fix (51.5, -0.12)');
  const movesAfterMount = cameraMoves();

  // Now simulate five further GPS fixes from watchPosition.
  for (let i = 1; i <= 5; i += 1) {
    await m.rerender({ userLocation: { lat: 51.5 + i * 0.0004, lng: -0.12 + i * 0.0004 } });
  }
  const movesAfterGps = cameraMoves() - movesAfterMount;
  assert(movesAfterGps === 0,
    `5 further GPS fixes produce ${movesAfterGps} extra camera moves (must be 0 \u2014 no recenter storm)`);
  await m.unmount();
}

section('[4b] MAP \u2014 the explicit recenter control still works');
{
  const m = await mount({ pulses: [makePulse()] });
  const baseline = cameraMoves();
  const locate = m.container.querySelector(SEL.locate);
  if (locate) {
    await click(locate);
    assert(cameraMoves() > baseline, 'pressing locate/recenter does move the camera');
  } else {
    console.log('  \u00b7 (locate control not found in this layout; skipped)');
  }
  await m.unmount();
}

// ===========================================================================
// Live intents render as .gm-pulse markers (a Leaflet divIcon). .gm-profile is
// the demo-only photo-grid marker, .gm-haven a Safe Haven, .gm-user the viewer.
const pulseMarkers = (c) => Array.from(c.querySelectorAll('.gm-pulse'));

section('[5] MAP \u2014 markers correspond to live intents only');
{
  const live = makePulse({ id: 'live-1', peerName: 'Live', expiresAt: now + HOUR });
  const expired = makePulse({ id: 'expired-1', peerName: 'Expired', expiresAt: now - 1000 });
  const paused = makePulse({ id: 'paused-1', peerName: 'Paused', expiresAt: now + HOUR, isPaused: true });
  const noExpiry = makePulse({ id: 'noexpiry-1', peerName: 'NoExpiry', expiresAt: 0 });

  const m = await mount({ pulses: [live, expired, paused, noExpiry] });
  const markers = pulseMarkers(m.container);
  assert(markers.length === 1, `exactly 1 marker renders for 4 intents (got ${markers.length})`);
  assert(markers.length === 1 && markers[0].textContent.trim() === 'L',
    `the surviving marker is the live intent ("${markers[0]?.textContent.trim()}")`);

  // Sanity-check the fixture: each of the other three WOULD render if not filtered.
  const control = await mount({ pulses: [
    makePulse({ id: 'c1', peerName: 'A', expiresAt: now + HOUR }),
    makePulse({ id: 'c2', peerName: 'B', expiresAt: now + HOUR }),
    makePulse({ id: 'c3', peerName: 'C', expiresAt: now + HOUR }),
  ] });
  assert(pulseMarkers(control.container).length === 3,
    'control: 3 unexpired, unpaused intents DO produce 3 markers (so the filter above is real)');
  await control.unmount();
  await m.unmount();
}

section('[5a] MAP \u2014 an intent expiring mid-session drops off the map');
{
  const realNow = Date.now;
  const t0 = realNow();
  // Expires in 60 s, so it is unambiguously live at mount time.
  const shortLived = makePulse({ id: 'short-1', peerName: 'Short', expiresAt: t0 + 60_000 });
  const m = await mount({ pulses: [shortLived] });
  assert(pulseMarkers(m.container).length === 1, 'the intent is on the map while still live');

  // Jump the clock past expiry, then fire the component's 30 s "now" tick.
  Date.now = () => t0 + 120_000;
  await act(async () => { flushIntervals(); });
  await act(async () => { await sleep(30); });
  assert(pulseMarkers(m.container).length === 0,
    'after the expiry tick the marker is removed (expired intents are excluded)');
  Date.now = realNow;
  await m.unmount();
}

section('[5b] MAP \u2014 Social / Spicy (intent mode) filtering works');
{
  const social = makePulse({ id: 's1', peerName: 'Soc', intentMode: 'social', intent: 'Coffee' });
  const priv = makePulse({ id: 'p1', peerName: 'Pri', intentMode: 'private', intent: 'Chill' });
  const m = await mount({ pulses: [social, priv] });
  const baselineMarkers = pulseMarkers(m.container).length;
  assert(baselineMarkers === 2, `both intents visible with no mode filter (got ${baselineMarkers})`);

  const filtersBtn = m.container.querySelector(SEL.openFilters);
  await click(filtersBtn);
  const privateBtn = Array.from(m.container.querySelectorAll('button')).find((b) => (b.textContent || '').trim() === 'Private');
  assert(Boolean(privateBtn), 'the Private intent-mode filter exists');
  if (privateBtn) {
    await click(privateBtn);
    const socialBtn = Array.from(m.container.querySelectorAll('button')).find((b) => (b.textContent || '').trim() === 'Social');
    assert(Boolean(socialBtn), 'the Social intent-mode filter exists');
    if (socialBtn) {
      await click(socialBtn);
      const afterSocial = pulseMarkers(m.container).length;
      assert(afterSocial === 1, `Social mode shows only the social intent (got ${afterSocial})`);
      assert(!m.container.querySelector('.gm-pulse--private'),
        'Social mode hides the private ("spicy") intent marker');
      await click(privateBtn);
      const afterPrivate = pulseMarkers(m.container).length;
      assert(afterPrivate === 1, `Private mode shows only the private intent (got ${afterPrivate})`);
      assert(Boolean(m.container.querySelector('.gm-pulse--private')),
        'Private mode renders the private intent with its private styling');
    }
  }
  await m.unmount();
}

// ===========================================================================
section('[6] DRAWERS \u2014 open / close cleanly, no stale overlays');
{
  const m = await mount({ pulses: [makePulse()] });
  const sheetsOpen = () => m.container.querySelectorAll('.g-sheet').length;
  assert(sheetsOpen() === 0, 'no sheet is open on first paint');

  const filtersBtn = m.container.querySelector(SEL.openFilters);
  assert(Boolean(filtersBtn), 'filter button present');
  await click(filtersBtn);
  assert(sheetsOpen() === 1, `filter drawer opens (sheets=${sheetsOpen()})`);
  assert(Boolean(m.container.querySelector('.g-overlay')), 'filter drawer has a backdrop overlay');

  const closeBtn = m.container.querySelector(SEL.closeFilters);
  assert(Boolean(closeBtn), 'the filter drawer exposes a close control');
  if (closeBtn) await click(closeBtn);
  assert(sheetsOpen() === 0, `filter drawer closes, leaving no stale sheet (sheets=${sheetsOpen()})`);
  assert(!m.container.querySelector('.g-overlay'), 'backdrop overlay is removed with the drawer (no stale overlay)');

  // Opening a second drawer must not stack a leftover from the first.
  const nearbyBtn = m.container.querySelector(SEL.nearbyList);
  assert(Boolean(nearbyBtn), 'nearby drawer button present');
  if (nearbyBtn) {
    await click(nearbyBtn);
    const afterNearby = sheetsOpen();
    assert(afterNearby === 1, `nearby drawer opens on its own (sheets=${afterNearby})`);
    const nb = m.container.querySelector(SEL.closeNearby);
    assert(Boolean(nb), 'nearby drawer exposes a close control');
    if (nb) await click(nb);
    assert(sheetsOpen() === 0, `nearby drawer closes cleanly (sheets=${sheetsOpen()})`);
    assert(!m.container.querySelector('.g-overlay'), 'no stale overlay after the nearby drawer closes');
  }

  // Backdrop tap dismisses too.
  await click(m.container.querySelector(SEL.openFilters));
  const backdrop = m.container.querySelector('.g-overlay');
  if (backdrop) {
    await act(async () => { backdrop.dispatchEvent(new window.MouseEvent('click', { bubbles: true })); });
    await act(async () => { await sleep(10); });
    assert(sheetsOpen() === 0, 'tapping the backdrop dismisses the drawer');
  }
  await m.unmount();
}

section('[7] DRAWERS / SHELL \u2014 safe-area aware');
{
  const m = await mount({ pulses: [makePulse()] });
  const html = m.container.innerHTML;
  assert(/safe-area-inset/.test(html), 'layout uses env(safe-area-inset-*) for the notch / home indicator');
  await m.unmount();
}

section('[8] REDESIGN \u2014 the Arena map-first shell is still intact');
{
  const m = await mount({ pulses: [makePulse()] });
  assert(Boolean(m.container.querySelector('.g-right-now-shell')), 'map-first full-bleed shell renders');
  assert(Boolean(m.container.querySelector('.g-map-bar')) || Boolean(byText(m.container, /Nearby|intent/i)),
    'bottom action bar / primary action renders');
  await m.unmount();
}

// ---------------------------------------------------------------------------
leaflet.Map.prototype.flyTo = origFlyTo;
leaflet.Map.prototype.setView = origSetView;

console.log('');
if (failures > 0) {
  console.error(`INTERACTION TESTS: ${failures} FAILED`);
  process.exit(1);
} else {
  console.log('INTERACTION TESTS: ALL PASSED');
  process.exit(0);
}
