/**
 * GAYZE Profile / "About you" tests.
 *
 * Mounts the REAL ProfileView and ProfileEditSheet with React 19 in jsdom.
 * All Supabase traffic is redirected to an in-process fetch stub (the real
 * client is never reached), and the Web Push platform APIs are faked so the
 * notification onboarding rules can be exercised in both directions.
 *
 * Run: npx tsx --import ./scripts/profile-tests/register-hooks.mjs scripts/profile-tests/profile.test.tsx
 */
const { flushIntervals, mountRoot, testWindow } = await import('../interaction-tests/env.mjs');

// ---------------------------------------------------------------------------
// Route every Supabase call to a local stub BEFORE any src module is imported
// (supabaseClient reads env at import time and otherwise falls back to the
// PRODUCTION project).
// ---------------------------------------------------------------------------
globalThis.__GAYZE_VITE_ENV__.VITE_SUPABASE_URL = 'http://127.0.0.1:54321';
globalThis.__GAYZE_VITE_ENV__.VITE_SUPABASE_PUBLISHABLE_KEY = 'sb_publishable_test';
globalThis.__GAYZE_VITE_ENV__.VITE_VAPID_PUBLIC_KEY = 'BPtestVapidKeyForProfileTests';

/** Controllable push-subscription state read by the fakes below. */
globalThis.__pushState = {
  supported: false,
  permission: 'default',
  subscription: null,
  ownsRow: true,
};

const jsonResponse = (body, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

globalThis.fetch = async (input) => {
  const url = String(typeof input === 'string' ? input : input?.url ?? '');
  if (url.includes('/auth/v1/user')) return jsonResponse({}, 401);
  if (url.includes('/rest/v1/push_subscriptions')) {
    return globalThis.__pushState.ownsRow && globalThis.__pushState.subscription
      ? jsonResponse([{ id: 1 }])
      : jsonResponse([]);
  }
  if (url.includes('/rest/v1/rpc/get_profile_intimacy')) {
    // The SERVER decides visibility: empty = not visible to this caller.
    return jsonResponse(globalThis.__peerIntimacyRows ?? []);
  }
  if (url.includes('/rest/v1/profiles')) {
    const row = { display_name: 'Sam', age: 31, neighborhood: 'Peckham', bio: 'Peer bio', interests: ['Drinks', 'Travel'] };
    const details = {
      pronouns: 'they/them', height_cm: 175, body_type: null,
      hobbies: ['Music'], boundaries: ['No smoking'], my_setup: ['Can travel'], availability: ['Weekends'],
    };
    return jsonResponse([url.includes('pronouns') ? details : row]);
  }
  if (url.includes('/rest/v1/')) return jsonResponse([]);
  return jsonResponse({}, 404);
};

function installPushPlatform() {
  const state = globalThis.__pushState;
  state.supported = true;
  testWindow.PushManager = class PushManager {};
  const registration = {
    pushManager: {
      getSubscription: async () => state.subscription,
      subscribe: async () => state.subscription,
    },
  };
  const serviceWorker = {
    register: async () => registration,
    ready: Promise.resolve(registration),
    getRegistration: async () => registration,
  };
  try {
    Object.defineProperty(testWindow.navigator, 'serviceWorker', { value: serviceWorker, configurable: true, writable: true });
  } catch {
    (testWindow.navigator as any).serviceWorker = serviceWorker;
  }
  const Notification = {
    get permission() { return globalThis.__pushState.permission; },
    requestPermission: async () => globalThis.__pushState.permission,
  };
  testWindow.Notification = Notification as any;
  globalThis.Notification = Notification as any;
}

function removePushPlatform() {
  globalThis.__pushState.supported = false;
  delete (testWindow as any).PushManager;
  delete (testWindow as any).Notification;
  delete (globalThis as any).Notification;
  try {
    delete (testWindow.navigator as any).serviceWorker;
  } catch { /* ignore */ }
}

// ---------------------------------------------------------------------------

const React = (await import('react')).default;
const { createRoot } = await import('react-dom/client');
const { act } = await import('react');

const { ProfileView } = await import('../../src/components/ProfileView.tsx');
const { ProfileEditSheet } = await import('../../src/components/ProfileEditSheet.tsx');
const { computeProfileCompletion, DEFAULT_INTIMACY_VISIBILITY } = await import('../../src/config/profileOptions.ts');

let failures = 0;
function assert(cond, msg) {
  if (!cond) { console.error('  ✗ FAIL:', msg); failures += 1; process.exitCode = 1; }
  else console.log('  ✓', msg);
}
const section = (t) => console.log(`\n=== ${t} ===`);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function makeUser(over = {}) {
  return {
    publicKey: 'pk_test',
    shortKey: 'pk_abcd…wxyz',
    handle: 'chris-b',
    displayName: 'Chris',
    bio: '',
    avatarSeed: 'seed',
    neighborhood: 'Bermondsey',
    privacySetting: 'fuzzy_500m',
    safetyVerified: false,
    interests: [],
    reliabilityScore: 0,
    verifiedPeersCount: 0,
    ...over,
  };
}

async function mountProfile(user, props = {}) {
  const container = mountRoot();
  const calls = { notifications: 0, edit: [], identity: 0 };
  let root;
  await act(async () => {
    root = createRoot(container);
    root.render(
      React.createElement(ProfileView, {
        currentUser: user,
        activeUserIntent: null,
        areaLabel: 'Bermondsey',
        onOpenSafetyTimer: () => {},
        isSafetyTimerActive: false,
        onOpenMask: () => {},
        onOpenIdentity: () => { calls.identity += 1; },
        onOpenQR: () => {},
        onOpenSafeHavens: () => {},
        onOpenNotifications: () => { calls.notifications += 1; },
        onOpenProfileEdit: (s) => { calls.edit.push(s ?? null); },
        ...props,
      }),
    );
  });
  await act(async () => { await sleep(30); });
  return { container, calls, unmount: async () => { await act(async () => root.unmount()); } };
}

const text = (el) => (el.textContent || '').replace(/\s+/g, ' ').trim();
const findButton = (root, label) =>
  [...root.querySelectorAll('button')].find((b) => text(b) === label);
const sectionHeader = (root, name) =>
  [...root.querySelectorAll('button[aria-expanded]')].find((b) => (b.textContent || '').includes(name));
const hasText = (root, needle) => (root.textContent || '').includes(needle);

// ---------------------------------------------------------------------------
section('[1] One notification experience — onboarding prompt + one permanent section');
// ---------------------------------------------------------------------------

// --- 1a. unsupported platform: no promotional card, section still there
removePushPlatform();
{
  localStorage.clear();
  const { container, calls, unmount } = await mountProfile(makeUser());
  assert(!hasText(container, 'Turn on notifications'), 'unsupported platform: no "Turn on notifications" card');
  assert(hasText(container, 'Messages, intent activity and safety'), 'permanent Notifications row is present');
  const labels = [...container.querySelectorAll('.g-label')].filter((el) => text(el) === 'Notifications');
  assert(labels.length === 1, `exactly ONE Notifications section label (found ${labels.length})`);
  const row = [...container.querySelectorAll('.g-row')].find((r) => text(r).startsWith('Notifications'));
  assert(Boolean(row), 'permanent Notifications row opens the existing settings');
  await act(async () => { row.click(); await sleep(10); });
  assert(calls.notifications === 1, 'tapping the permanent row opens the EXISTING notification settings (one system)');
  await unmount();
}

// --- 1b. supported + not subscribed + not dismissed: prompt shows
installPushPlatform();
{
  localStorage.clear();
  globalThis.__pushState.permission = 'default';
  globalThis.__pushState.subscription = null;
  const { container, unmount } = await mountProfile(makeUser());
  assert(hasText(container, 'Turn on notifications'), 'not enabled + not dismissed: onboarding card shows');
  assert(hasText(container, 'Stay in the loop'), 'card copy is the onboarding prompt');
  assert(hasText(container, 'Messages, intent activity and safety'), 'permanent Notifications row is still present');
  await unmount();
}

// --- 1c. supported + SUBSCRIBED: prompt is gone even without dismissal
{
  localStorage.clear();
  globalThis.__pushState.permission = 'granted';
  globalThis.__pushState.subscription = { endpoint: 'https://push.example.test/ep1' };
  globalThis.__pushState.ownsRow = true;
  const { container, unmount } = await mountProfile(makeUser());
  assert(!hasText(container, 'Turn on notifications'), 'notifications ENABLED: promotional card is gone');
  assert(hasText(container, 'Messages, intent activity and safety'), 'permanent Notifications row remains');
  await unmount();
}

// --- 1d. enabling mid-session retires the prompt (the 30 s re-check)
{
  localStorage.clear();
  globalThis.__pushState.permission = 'default';
  globalThis.__pushState.subscription = null;
  const { container, unmount } = await mountProfile(makeUser());
  assert(hasText(container, 'Turn on notifications'), 'before enabling: card visible');
  await act(async () => {
    globalThis.__pushState.permission = 'granted';
    globalThis.__pushState.subscription = { endpoint: 'https://push.example.test/ep2' };
    flushIntervals(); // the prompt's own heartbeat re-checks subscription state
  });
  // Passive effects run at act exit; give the async re-check its own window.
  await act(async () => { await sleep(30); });
  assert(!hasText(container, 'Turn on notifications'), 'after enabling: card disappears without a reload');
  await unmount();
}

// --- 1e. dismissal is permanent
{
  localStorage.clear();
  globalThis.__pushState.permission = 'default';
  globalThis.__pushState.subscription = null;
  const first = await mountProfile(makeUser());
  assert(hasText(first.container, 'Turn on notifications'), 'before dismiss: card visible');
  const dismiss = [...first.container.querySelectorAll('button')]
    .find((b) => (b.getAttribute('aria-label') || '') === 'Dismiss notification reminder');
  await act(async () => { dismiss.click(); await sleep(10); });
  assert(!hasText(first.container, 'Turn on notifications'), 'X dismisses the card');
  await first.unmount();

  // A fresh mount (e.g. next visit) must NOT resurface it.
  const second = await mountProfile(makeUser());
  assert(!hasText(second.container, 'Turn on notifications'), 'dismissal is permanent — card stays gone on re-mount');
  await second.unmount();
}

// --- 1f. engaging the prompt retires it and opens the same settings sheet
{
  localStorage.clear();
  globalThis.__pushState.permission = 'default';
  globalThis.__pushState.subscription = null;
  const { container, calls, unmount } = await mountProfile(makeUser());
  const cta = findButton(container, 'Start notifications');
  await act(async () => { cta.click(); await sleep(10); });
  assert(calls.notifications === 1, 'CTA opens the existing notification settings sheet');
  assert(!hasText(container, 'Turn on notifications'), 'engaging the prompt retires it');
  await unmount();
}

// ---------------------------------------------------------------------------
section('[2] Profile summary — sections render only when they contain information');
// ---------------------------------------------------------------------------

{
  const empty = makeUser();
  const { container, unmount } = await mountProfile(empty);
  for (const label of ['Looking for', 'Interests', 'Intimacy', 'My setup', 'Boundaries']) {
    const found = [...container.querySelectorAll('.g-label')].some((el) => text(el) === label);
    assert(!found, `empty user: "${label}" section hidden`);
  }
  await unmount();
}

{
  const full = makeUser({
    bio: 'Short bio line.',
    age: 42,
    pronouns: 'he/him',
    heightCm: 180,
    bodyType: 'Athletic',
    interests: ['Date', 'Hookup'],
    hobbies: ['Gym', 'Travel'],
    mySetup: ['Sometimes host'],
    availability: ['Weekends'],
    boundaries: ['Safer sex', 'Discretion important'],
    intimacy: {
      role: 'Versatile',
      preferences: ['Kissing', 'Massage'],
      experience: 'Exploring',
      visibility: 'connections',
    },
  });
  const { container, unmount } = await mountProfile(full);
  assert(hasText(container, '“Short bio line.”'), 'bio renders as the About you quote');
  assert(hasText(container, '42 · he/him · Bermondsey'), 'age · pronouns · area in the header');
  assert(hasText(container, '180 cm') && hasText(container, 'Athletic'), 'optional facts render as chips');
  assert(hasText(container, 'Looking for') && hasText(container, 'Date'), 'Looking for shows the reused interests values');
  assert(hasText(container, 'Interests') && hasText(container, 'Gym'), 'Interests shows hobby chips');
  assert(hasText(container, 'Intimacy') && hasText(container, 'Versatile'), 'Intimacy renders when set');
  assert(hasText(container, 'Connections only'), 'intimacy visibility badge is shown');
  assert(hasText(container, 'Sometimes host') && hasText(container, 'Weekends'), 'My setup + availability render');
  assert(hasText(container, 'Safer sex') && hasText(container, 'Discretion important'), 'Boundaries render');
  const labels = [...container.querySelectorAll('.g-label')].filter((el) => text(el) === 'Notifications');
  assert(labels.length === 1, 'still exactly ONE Notifications section with a full profile');
  await unmount();
}

{
  // Privacy-preserving: a PRIVATE intimacy section is still visible to its owner.
  const priv = makeUser({
    intimacy: { role: 'Top', preferences: [], experience: undefined, visibility: 'private' },
  });
  const { container, unmount } = await mountProfile(priv);
  assert(hasText(container, 'Intimacy') && hasText(container, 'Top'), 'owner always sees their own Intimacy section');
  assert(hasText(container, 'Private'), 'visibility badge shows the Private setting');
  await unmount();
}

// ---------------------------------------------------------------------------
section('[3] Profile completion — subtle, prioritised, never blocking');
// ---------------------------------------------------------------------------

{
  const c0 = computeProfileCompletion({ hasPhoto: true, lookingForCount: 1, interestCount: 1, hasIntimacy: true, setupCount: 1, hasBio: true });
  assert(c0.percent === 100 && c0.missing.length === 0, 'all six priorities -> 100%, nothing missing');

  const c1 = computeProfileCompletion({ hasPhoto: true, lookingForCount: 2, interestCount: 0, hasIntimacy: false, setupCount: 0, hasBio: true });
  assert(c1.percent === 50, `photo+lookingFor+bio -> 50% (got ${c1.percent}%)`);
  assert(c1.missing.map((m) => m.key).join(',') === 'interests,intimacy,setup', 'missing items follow the material-first priority order');

  const c2 = computeProfileCompletion({ hasPhoto: false, lookingForCount: 0, interestCount: 0, hasIntimacy: false, setupCount: 0, hasBio: false });
  assert(c2.percent === 0 && c2.missing[0].key === 'photo', 'photo is the first priority when nothing is set');
}

{
  // UI: avatarUrl counts as a photo; suggestions jump into the right section.
  const user = makeUser({ avatarUrl: 'https://example.test/a.jpg', interests: ['Chat'], bio: 'x' });
  const { container, calls, unmount } = await mountProfile(user);
  assert(hasText(container, '50% complete'), 'shows "Profile · 50% complete"');
  assert(hasText(container, 'quick things to add'), 'nudge copy is soft, not a checklist');
  const nudge = [...container.querySelectorAll('button')].find((b) => hasText(b, 'complete'));
  await act(async () => { nudge.click(); await sleep(10); });
  assert(calls.edit[0] === 'interests', `tapping the nudge opens the editor at the first missing section (got ${calls.edit[0]})`);
  // Not blocking: nothing here hides the rest of the profile.
  assert(hasText(container, 'Safety & privacy'), 'incomplete profile still shows the full page');
  await unmount();
}

{
  const completeUser = makeUser({
    avatarUrl: 'https://example.test/a.jpg', interests: ['Chat'], hobbies: ['Gym'],
    mySetup: ['Can host'], bio: 'x',
    intimacy: { role: 'Top', preferences: [], experience: undefined, visibility: 'connections' },
  });
  const { container, unmount } = await mountProfile(completeUser);
  assert(!hasText(container, 'complete'), 'a complete profile shows no nudge at all');
  await unmount();
}

// ---------------------------------------------------------------------------
section('[4] Edit profile — sectioned editor, optional everything, one Save');
// ---------------------------------------------------------------------------

function mountEditor(user, extra = {}) {
  const container = mountRoot();
  const saved = [];
  const calls = { closed: 0, identity: 0, intent: 0 };
  let root;
  const render = (props = {}) => act(async () => {
    root = root ?? createRoot(container);
    root.render(
      React.createElement(ProfileEditSheet, {
        isOpen: true,
        currentUser: user,
        hasPhoto: Boolean(user.avatarUrl),
        onClose: () => { calls.closed += 1; },
        onSave: async (payload) => { saved.push(payload); return true; },
        onOpenIdentity: () => { calls.identity += 1; },
        onOpenSetIntent: () => { calls.intent += 1; },
        ...extra,
        ...props,
      }),
    );
    await sleep(10);
  });
  return { container, saved, calls, render, unmount: async () => { await act(async () => root.unmount()); } };
}

{
  const { container, saved, calls, render, unmount } = await mountEditor(makeUser());
  await render();
  for (const label of ['Identity', "What I'm looking for", 'Intimacy', 'Interests', 'My setup', 'Boundaries', 'Privacy']) {
    assert(hasText(container, label), `edit sheet has a "${label}" section`);
  }
  assert(!hasText(container, 'Date of birth') && container.querySelectorAll('textarea').length <= 1,
    'text entry is limited (bio textarea only in the default open section)');

  // Intimacy is optional: nothing is required, visibility defaults to connections.
  await act(async () => { sectionHeader(container, 'Intimacy')?.click(); await sleep(10); });
  const connBtn = [...container.querySelectorAll('.g-seg__btn')].find((b) => text(b) === 'Connections only');
  assert(Boolean(connBtn) && connBtn.getAttribute('data-active') === 'true',
    `sensitive preferences default to the privacy-preserving option ("${DEFAULT_INTIMACY_VISIBILITY}")`);

  // Open "What I'm looking for" and toggle chips; no role required to save.
  await act(async () => { sectionHeader(container, "What I'm looking for")?.click(); await sleep(10); });
  await act(async () => { findButton(container, 'Chat')?.click(); await sleep(10); });
  await act(async () => { findButton(container, 'Date')?.click(); await sleep(10); });
  await act(async () => { findButton(container, 'Save')?.click(); await sleep(10); });

  assert(saved.length === 1, 'one grouped Save persists everything');
  assert(JSON.stringify(saved[0].lookingFor) === JSON.stringify(['Chat', 'Date']), 'looking-for chips persist in order');
  assert(saved[0].intimacy.role === undefined, 'role is NOT required — saving without one works');
  assert(saved[0].intimacy.visibility === 'connections', 'default intimacy visibility saved as connections');
  assert(calls.closed === 1, 'sheet closes after a successful save');
  await unmount();
}

{
  // Age validation — 18+ gate is kept from onboarding.
  const { container, saved, render, unmount } = await mountEditor(makeUser());
  await render();
  const ageInput = container.querySelector('input[placeholder="Age"]');
  await act(async () => {
    const setter = Object.getOwnPropertyDescriptor(testWindow.HTMLInputElement.prototype, 'value').set;
    setter.call(ageInput, '12');
    ageInput.dispatchEvent(new Event('input', { bubbles: true }));
    await sleep(10);
  });
  await act(async () => { findButton(container, 'Save')?.click(); await sleep(10); });
  assert(saved.length === 0, 'invalid age blocks the save');
  assert(hasText(container, 'Age must be 18'), 'inline error explains the age gate');
  await unmount();
}

{
  // Custom interest + "+ Add interests" progressive disclosure.
  const { container, saved, render, unmount } = await mountEditor(makeUser());
  await render();
  await act(async () => { sectionHeader(container, 'Interests')?.click(); await sleep(10); });
  const previewCount = [...container.querySelectorAll('button')].filter((b) => ['Fitness', 'Gym', 'Travel', 'Food', 'Music', 'Films', 'Gaming', 'Art'].includes(text(b))).length;
  assert(previewCount === 8, `compact preview shows 8 interests initially (got ${previewCount})`);
  await act(async () => { findButton(container, 'Add interests')?.click(); await sleep(10); });
  const allCount = [...container.querySelectorAll('button')].filter((b) => text(b) === 'Dogs').length;
  assert(allCount === 1, '"+ Add interests" reveals the full picker');

  const custom = container.querySelector('input[placeholder="Custom interest"]');
  await act(async () => {
    const setter = Object.getOwnPropertyDescriptor(testWindow.HTMLInputElement.prototype, 'value').set;
    setter.call(custom, 'Tea rituals');
    custom.dispatchEvent(new Event('input', { bubbles: true }));
    await sleep(10);
  });
  await act(async () => { findButton(container, 'Save')?.click(); await sleep(10); });
  assert(saved[0].hobbies.includes('Tea rituals'), 'custom interest is saved as a chip value');
  await unmount();
}

{
  // Closing a dirty sheet saves it — no confirmation dialogs, no lost edits.
  const { container, saved, calls, render, unmount } = await mountEditor(makeUser());
  await render();
  await act(async () => { sectionHeader(container, 'Boundaries')?.click(); await sleep(10); });
  await act(async () => { findButton(container, 'No smoking')?.click(); await sleep(10); });
  const closeBtn = [...container.querySelectorAll('button')].find((b) => (b.getAttribute('aria-label') || '') === 'Close');
  await act(async () => { closeBtn.click(); await sleep(10); });
  assert(saved.length === 1 && saved[0].boundaries.includes('No smoking'),
    'closing a dirty sheet autosaves the grouped edits');
  assert(calls.closed === 1, 'sheet closed without a confirmation dialog');
  await unmount();
}

// ---------------------------------------------------------------------------
section('[5] Profile viewed by another user — public tier + server-enforced intimacy');
// ---------------------------------------------------------------------------

const { PeerProfileSummary } = await import('../../src/components/PeerProfileSummary.tsx');

async function mountPeer() {
  const container = mountRoot();
  let root;
  await act(async () => {
    root = createRoot(container);
    root.render(React.createElement(PeerProfileSummary, { userId: 'peer-9' }));
  });
  await act(async () => { await sleep(30); });
  return { container, unmount: async () => { await act(async () => root.unmount()); } };
}

{
  globalThis.__peerIntimacyRows = [{
    intimacy_role: 'Top',
    intimacy_prefs: ['Kissing'],
    intimacy_experience: null,
    intimacy_visibility: 'connections',
  }];
  const { container, unmount } = await mountPeer();
  assert(hasText(container, 'they/them') && hasText(container, '175 cm'), 'peer About facts render');
  assert(hasText(container, 'Drinks') && hasText(container, 'Music'), 'peer Looking for + Interests render');
  assert(hasText(container, 'Can travel') && hasText(container, 'Weekends'), 'peer My setup + availability render');
  assert(hasText(container, 'No smoking'), 'peer Boundaries render');
  assert(hasText(container, 'Top') && hasText(container, 'Kissing'),
    'intimacy renders ONLY because the server said it is visible to this caller');
  await unmount();
}

{
  // Server withholds (private / unconnected): nothing sensitive can leak.
  globalThis.__peerIntimacyRows = [];
  const { container, unmount } = await mountPeer();
  assert(!hasText(container, 'Top') && !hasText(container, 'Kissing') && !hasText(container, 'Intimacy'),
    'no intimacy data renders when get_profile_intimacy returns nothing — no leak');
  assert(hasText(container, 'Drinks'), 'public tier is unaffected');
  await unmount();
}

{
  // Unset peer (e.g. live discovery row with no profile): renders nothing at all.
  const { PeerProfileSummary: PPS } = { PeerProfileSummary };
  const container = mountRoot();
  let root;
  await act(async () => {
    root = createRoot(container);
    root.render(React.createElement(PPS, { userId: null }));
  });
  await act(async () => { await sleep(10); });
  assert(container.innerHTML.trim() === '' || !hasText(container, 'Looking for'),
    'no userId -> no summary block at all (map stays intent-first)');
  await act(async () => root.unmount());
}

console.log(`\nPROFILE TESTS: ${failures === 0 ? 'ALL PASSED' : `${failures} FAILED`}`);
if (failures > 0) process.exitCode = 1;
// A jsdom process with React roots does not exit on its own.
process.exit(failures === 0 ? 0 : 1);
