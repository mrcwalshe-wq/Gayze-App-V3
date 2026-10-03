import { flushIntervals } from '../interaction-tests/env.mjs';
import assert from 'node:assert/strict';
import { test, afterEach } from 'node:test';
import { readFileSync } from 'node:fs';
import { loadModule } from '../recovery-tests/load-module.mjs';
import { user, peer, other, roomId, otherRoomId, room, intentRow, backend, flush } from './fixtures.mjs';
const React = await import('react');
const { render, cleanup, fireEvent, act, within } = await import('@testing-library/react');
afterEach(async () => { cleanup(); await flush(); });
const props = () => ({ rooms: [room(otherRoomId, other), room()], messages: {}, activeRoomId: roomId,
  currentUser: { publicKey: 'device', displayName: 'Me' }, currentUserId: user,
  onSelectRoom() {}, onUpdateRoomTtl() {}, async onSendMessage() {} });
const settle = () => act(async () => { await new Promise(resolve => setTimeout(resolve, 200)); await flush(); });

// Real map action -> production routing resolver -> real mobile conversation UI.
test('Map Message opens the specific same-name peer directly, not the conversation list', async () => {
  const { RightNowView } = await loadModule('src/components/RightNowView.tsx');
  const { ChatRoomView } = await loadModule('src/components/ChatRoomView.tsx');
  const { resolveLiveDirectChat } = await loadModule('src/services/directChatRouting.ts');
  const pulse = { id: 'supabase_intent', peerId: peer, peerName: 'Alex', peerShortKey: 'key', peerAvatar: '',
    title: 'Social', description: 'Chat nearby', activityCategory: 'coffee', intentMode: 'social', intent: 'Chat',
    venueName: 'Nearby', neighborhood: 'London', approxDistanceKm: .4, jitterMeters: 300, lat: 51.51, lng: -.12,
    durationHours: 1, createdAt: Date.now(), expiresAt: Date.now() + 3600000, tags: [], isPaused: false };
  function Harness() {
    const [target, setTarget] = React.useState(null);
    return target ? React.createElement(ChatRoomView, { ...props(), activeRoomId: target })
      : React.createElement(RightNowView, { pulses: [pulse], gatherings: [], safeHavens: [], profiles: [], userNeighborhood: 'London',
        userLocation: { lat: 51.51, lng: -.12 }, travelDistanceKm: 5, onOpenQR() {}, onSelectHaven() {}, onCreateGathering() {}, onOpenSetIntent() {},
        async onOpenDirectChat(selected) {
          const result = await resolveLiveDirectChat({ peerId: selected.peerId, rooms: props().rooms, current: () => true,
            loadRooms: () => assert.fail(), submitInterest: () => assert.fail() });
          setTarget(result.room.id);
        } });
  }
  const ui = render(React.createElement(Harness));
  fireEvent.click(ui.getByRole('button', { name: /1 nearby/ }));
  fireEvent.click(ui.getByText('Alex').closest('button'));
  await settle();
  fireEvent.click(ui.getByRole('button', { name: 'Message' })); await settle();
  assert.equal(ui.getByTestId('conversation-pane').dataset.roomId, roomId);
  assert(!ui.getByTestId('conversation-pane').className.includes('hidden'));
  assert(ui.getByTestId('conversation-list').className.includes('hidden sm:flex'));
});

test('back/list remains usable; same-room open sequence reopens chat; unknown target never falls back', async () => {
  const { ChatRoomView } = await loadModule('src/components/ChatRoomView.tsx'); const visible = [];
  const base = { ...props(), onVisibleRoomChange: id => visible.push(id), openRequest: { roomId, sequence: 1 } };
  const ui = render(React.createElement(ChatRoomView, base)); await settle(); assert.equal(visible.at(-1), roomId);
  fireEvent.click(ui.getByRole('button', { name: 'Back to rooms' })); assert.equal(visible.at(-1), null);
  assert(ui.getByTestId('conversation-pane').className.includes('hidden sm:flex'));
  ui.rerender(React.createElement(ChatRoomView, { ...base, rooms: [...base.rooms] }));
  assert.equal(visible.at(-1), null, 'metadata polls must not reopen chat');
  ui.rerender(React.createElement(ChatRoomView, { ...base, openRequest: { roomId, sequence: 2 } }));
  assert.equal(visible.at(-1), roomId); assert(!ui.getByTestId('conversation-pane').className.includes('hidden'));
  ui.rerender(React.createElement(ChatRoomView, { ...base, activeRoomId: 'missing-target' }));
  assert.equal(ui.queryByTestId('conversation-pane'), null); assert.equal(visible.at(-1), null);
  assert(ui.getByText('Opening requested conversation'));
  ui.rerender(React.createElement(ChatRoomView, { ...base, activeRoomId: 'missing-target', rooms: [...base.rooms, room('missing-target')] }));
  assert.equal(ui.getByTestId('conversation-pane').dataset.roomId, 'missing-target');
  ui.unmount(); assert.equal(visible.at(-1), null);
});

test('desktop list and conversation visibility use the actual 640px breakpoint', async () => {
  const original = window.matchMedia, listeners = new Set();
  const media = { matches: true, addEventListener(_event, fn) { listeners.add(fn); }, removeEventListener(_event, fn) { listeners.delete(fn); } };
  window.matchMedia = () => media;
  try {
    const { ChatRoomView } = await loadModule('src/components/ChatRoomView.tsx'); const visible = [];
    const ui = render(React.createElement(ChatRoomView, { ...props(), onVisibleRoomChange: id => visible.push(id) }));
    fireEvent.click(ui.getByRole('button', { name: 'Back to rooms' })); assert.equal(visible.at(-1), roomId);
    act(() => { media.matches = false; for (const fn of listeners) fn(); }); assert.equal(visible.at(-1), null);
    ui.unmount(); assert.equal(listeners.size, 0);
  } finally { window.matchMedia = original; }
});

test('banner shows other peer NOW/Social then authoritative LATER/Spicy and clock transition/expiry', async () => {
  const db = backend(), start = Date.now(); db.rows = [intentRow(start)];
  const { ChatRoomView } = await loadModule('src/components/ChatRoomView.tsx', db);
  const ui = render(React.createElement(ChatRoomView, { ...props(), activeIntentMode: 'private' })); await settle();
  let banner = within(ui.getByRole('region', { name: "Alex's current intent" }));
  assert(banner.getByText('NOW')); assert(banner.getByText('Social')); assert(banner.getByText('Coffee'));
  db.rows = [intentRow(start, { intent: 'Meet', mode: 'private', starts_at: new Date(start + 60_000).toISOString(), expires_at: new Date(start + 120_000).toISOString() })];
  await act(async () => { db.channels[0].emit(); await flush(); });
  assert(banner.getByText('LATER')); assert(banner.getByText('Spicy')); assert(banner.getByText('Meet'));
  const realNow = Date.now;
  try {
    Date.now = () => start + 60_001; act(flushIntervals); assert(banner.getByText('NOW'));
    Date.now = () => start + 120_001; act(flushIntervals); assert(banner.getByText('No current intent shared'));
    assert.equal(banner.queryByText('Meet'), null);
  } finally { Date.now = realNow; }
  assert(ui.getByRole('textbox'), 'intent expiry must not remove/block message composer');
});

test('peer/account switches never show prior intent; hidden mobile list unsubscribes banner', async () => {
  const db = backend(); db.rows = [intentRow()];
  const { ChatRoomView } = await loadModule('src/components/ChatRoomView.tsx', db);
  const ui = render(React.createElement(ChatRoomView, props())); await settle(); assert(ui.getByText('Coffee'));
  const old = db.channels[0];
  ui.rerender(React.createElement(ChatRoomView, { ...props(), activeRoomId: otherRoomId }));
  assert.equal(ui.queryByText('Coffee'), null); await settle();
  const next = db.channels.at(-1); assert.notEqual(old, next); assert(old.closed);
  await act(async () => { old.emit(); await flush(); }); assert.equal(ui.queryByText('Coffee'), null);
  fireEvent.click(ui.getByRole('button', { name: 'Back to rooms' })); await settle();
  assert.equal(ui.queryByRole('region'), null); assert(next.closed);
  ui.rerender(React.createElement(ChatRoomView, { ...props(), currentUserId: other })); await settle();
  assert.equal(ui.queryByText('Coffee'), null); assert(ui.getByText('Current intent unavailable'));
});

test('composer stores future start and expiry after start; reload derives timing from starts_at', async () => {
  const { SetIntentSheet } = await loadModule('src/components/SetIntentSheet.tsx');
  const { intentRowToActiveIntent } = await loadModule('src/services/supabaseService.ts');
  let saved;
  const ui = render(React.createElement(SetIntentSheet, { isOpen: true, onClose() {}, onSaveIntent(data) { saved = data; }, userNeighborhood: 'London' }));
  fireEvent.click(ui.getByText('Social').closest('button')); fireEvent.click(ui.getByText('Drinks').closest('button'));
  fireEvent.click(ui.getByRole('button', { name: '2 hours', exact: true }));
  const now = Date.now(); fireEvent.click(ui.getByRole('button', { name: 'Go live' })); await settle();
  assert(saved.activatedAt >= now + 7_200_000); assert(saved.expiresAt > saved.activatedAt);
  assert.equal(intentRowToActiveIntent({ ...intentRow(), starts_at: new Date(saved.activatedAt).toISOString(), expires_at: new Date(saved.expiresAt).toISOString() }).when, 'Next 2 hours');
});

test('App wires direct requests and actual visible room into foreground alerts/read acknowledgement', () => {
  const app = readFileSync('src/App.tsx', 'utf8');
  assert.match(app, /openRequest=\{chatOpenRequest\}/); assert.match(app, /onVisibleRoomChange=\{reportVisibleChatRoom\}/);
  assert.match(app, /viewingRoom: activeTabRef.current === 'swarms' \? visibleChatRoomRef.current : null/);
  assert.match(app, /visibleChatRoomId !== activeRoomId/);
  const profileHandler = app.slice(app.indexOf('const handleOpenDirectChatWithProfile'), app.indexOf('const handleProposeHavenDate'));
  assert.match(profileHandler, /if \(isSupabaseConfigured\) \{[\s\S]*await handleOpenDirectChatFromPulse[\s\S]*return;/);
});

test('foreground toast suppressed only for the actually visible chat, not its hidden mobile list', async () => {
  const { ChatRoomView } = await loadModule('src/components/ChatRoomView.tsx');
  const { MessageAlerts } = await loadModule('src/services/messageAlerts.ts');
  const alerts = new MessageAlerts(); let viewingRoom = null, toasts = 0;
  const ui = render(React.createElement(ChatRoomView, { ...props(), onVisibleRoomChange: id => { viewingRoom = id; } }));
  const present = id => alerts.present(id, roomId, { viewingRoom, foreground: true, userId: user, recipientId: user }, () => toasts++);
  present('visible'); assert.equal(toasts, 0);
  fireEvent.click(ui.getByRole('button', { name: 'Back to rooms' }));
  present('hidden-list'); present('hidden-list'); assert.equal(toasts, 1);
  ui.unmount(); assert.equal(viewingRoom, null);
});
