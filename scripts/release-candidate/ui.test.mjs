import '../interaction-tests/env.mjs';
import assert from 'node:assert/strict';
import { test, afterEach } from 'node:test';
import { readFileSync } from 'node:fs';
import { loadModule } from '../recovery-tests/load-module.mjs';
const React = await import('react');
const { render, cleanup, fireEvent, waitFor } = await import('@testing-library/react');
afterEach(cleanup);
const css = readFileSync('src/index.css', 'utf8');

test('intent composer expands actual social/private choices and preserves semantic amber/violet classes', async () => {
  const { SetIntentSheet } = await loadModule('src/components/SetIntentSheet.tsx');
  const ui = render(React.createElement(SetIntentSheet, { isOpen: true, onClose() {}, onSaveIntent() {}, userNeighborhood: 'London' }));
  const social = ui.getByText('Social').closest('button'); fireEvent.click(social);
  assert.equal(social.dataset.active, 'true'); assert.equal(social.dataset.tone, 'social');
  assert(ui.getByText('Drinks')); assert(ui.getByRole('button', { name: 'Go live' }).className.includes('g-btn--intent-social'));
  fireEvent.click(ui.getByText('Drinks').closest('button'));
  ui.rerender(React.createElement(SetIntentSheet, { isOpen: true, onClose() {}, onSaveIntent() {}, userNeighborhood: 'London', safeHavens: [{ id: 'haven', name: 'New haven' }] }));
  assert.equal(ui.getByRole('button', { name: 'Go live' }).disabled, false);
  fireEvent.click(ui.getByText('Private').closest('button'));
  assert(ui.getByRole('button', { name: 'Go live' }).className.includes('g-btn--intent-private'));
  assert.match(css, /g-opt\[data-active='true'\]\[data-tone='social'\]/);
  assert.match(css, /g-sheet__foot--social .g-btn--intent-social/);
});

test('Right Now drawers open, selected card expands and controls retain current design contracts', async () => {
  const { RightNowView } = await loadModule('src/components/RightNowView.tsx');
  const pulse = { id: 'pulse', peerId: 'peer', peerName: 'Test member', peerShortKey: 'key', peerAvatar: 'user',
    title: 'Social', description: 'Chat nearby', activityCategory: 'coffee', intentMode: 'social', intent: 'Chat',
    venueName: 'Nearby', neighborhood: 'London', approxDistanceKm: .4, jitterMeters: 300, lat: 51.51, lng: -.12,
    durationHours: 1, createdAt: Date.now(), expiresAt: Date.now() + 3600000, tags: [], isPaused: false };
  const ui = render(React.createElement(RightNowView, { pulses: [pulse], gatherings: [], safeHavens: [], profiles: [],
    userNeighborhood: 'London', userLocation: { lat: 51.51, lng: -.12 }, travelDistanceKm: 5,
    onOpenDirectChat() {}, onOpenQR() {}, onSelectHaven() {}, onCreateGathering() {}, onOpenSetIntent() {} }));
  fireEvent.click(ui.getByRole('button', { name: /1 nearby/ }));
  assert(ui.getByText('1 live nearby'));
  fireEvent.click(ui.getByText('Test member').closest('button'));
  await waitFor(() => assert(ui.container.querySelector('.g-preview')));
  fireEvent.click(ui.getByText('Test member').closest('button'));
  assert(ui.container.querySelector('.g-sheet--above-nav')); assert(!ui.container.querySelector('.g-preview'));
  assert.match(css, /\.g-sheet\.g-sheet--above-nav\s*\{[^}]*margin-bottom: var\(--g-sheet-bottom-gap\);[^}]*max-height: max\(0px, calc\(100dvh[^}]*var\(--g-sheet-bottom-gap\)/s);
  assert(!ui.container.querySelector('.g-sheet').className.includes('mb-['), 'do not rely on layer-overridden margin utility');
  // Real browser geometry remains a separate gate; jsdom cannot prove pixels.
});

test('stored notification path consumption rejects tampered non-notification destinations', async () => {
  const { consumeNotificationPath } = await loadModule('src/services/notificationRouting.ts');
  for (const path of ['/unexpected', '/auth/callback', '//evil.example/notifications', 'https://evil.example/notifications']) {
    sessionStorage.setItem('gayze_notification_destination', path); assert.equal(consumeNotificationPath(), null);
  }
  sessionStorage.setItem('gayze_notification_destination', '/notifications'); assert.equal(consumeNotificationPath(), '/notifications');
});


test('test-push feedback distinguishes policy/config/preferences and never equates acceptance with device delivery', async () => {
  let response = { data: { delivered: 0 }, error: null };
  const backend = { functions: { async invoke() { return response; } } };
  const { sendTestNotification } = await loadModule('src/services/pushService.ts', backend);
  assert.match((await sendTestNotification()).reason, /No provider accepted/);
  response = { data: { delivered: 0, skipped: 'preferences' }, error: null };
  assert.match((await sendTestNotification()).reason, /preferences/);
  response = { data: null, error: { context: { status: 403 } } };
  assert.match((await sendTestNotification()).reason, /Operator access/);
  response = { data: null, error: { context: { status: 503 } } };
  assert.match((await sendTestNotification()).reason, /configuration/);
  response = { data: { delivered: 1 }, error: null }; assert.equal((await sendTestNotification()).ok, true);
});


test('refreshing the same existing intent cannot erase an open composer draft', async () => {
  const { SetIntentSheet } = await loadModule('src/components/SetIntentSheet.tsx');
  const intent = { remoteId: 'intent', mode: 'social', intent: 'Chat', description: 'saved', when: 'Now', duration: '1 hr' };
  const props = { isOpen: true, onClose() {}, onSaveIntent() {}, userNeighborhood: 'London', existingIntent: intent };
  const ui = render(React.createElement(SetIntentSheet, props));
  fireEvent.click(ui.getByText('Drinks').closest('button'));
  ui.rerender(React.createElement(SetIntentSheet, { ...props, existingIntent: { ...intent } }));
  assert.equal(ui.getByText('Drinks', { selector: '.g-opt__t' }).closest('button').dataset.active, 'true');
  ui.rerender(React.createElement(SetIntentSheet, { ...props, isOpen: false }));
  ui.rerender(React.createElement(SetIntentSheet, props));
  assert.equal(ui.getByText('Chat', { selector: '.g-opt__t' }).closest('button').dataset.active, 'true');
});
