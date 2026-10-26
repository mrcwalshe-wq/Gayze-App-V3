import test from 'node:test';
import assert from 'node:assert/strict';
import { decodePayload, encodePayload, meetingEventText, sanitizeMeeting } from '../../src/services/meetupWire.ts';
import { isApplePlatform, routeUrl } from '../../src/services/routeLinks.ts';

const meeting: any = { id: 'meet_1', venueName: 'Tor Cafe', address: 'Derby Road, DE4 3QE', timeStr: 'Now (~15 mins)', timestamp: 1, status: 'proposed', event: 'proposed', isSafeHaven: false, safetyTimerDurationMinutes: 60, lat: 53.1, lng: -1.5 };

test('plain text stays plain text', () => {
  assert.equal(encodePayload('hello'), 'hello');
  assert.deepEqual(decodePayload('hello', 5), { text: 'hello' });
  assert.deepEqual(decodePayload('{"not":"ours"}', 5), { text: '{"not":"ours"}' });
});

test('a meetup survives the round trip', () => {
  const d = decodePayload(encodePayload('Safe meetup invitation', undefined, meeting), 99);
  assert.equal(d.text, 'Safe meetup invitation');
  assert.equal(d.meeting?.id, 'meet_1');
  assert.equal(d.meeting?.venueName, 'Tor Cafe');
  assert.equal(d.meeting?.lat, 53.1);
  assert.equal(d.meeting?.status, 'proposed');
  assert.equal(d.meeting?.timestamp, 99);
});

test('older app versions still read the text: mediaUrl is present and empty', () => {
  const wire = encodePayload('hi', undefined, meeting);
  assert.ok(wire.includes('"mediaUrl"'));
  const asOld = JSON.parse(wire);
  assert.equal(asOld.text, 'hi');
  assert.equal(asOld.mediaUrl, null);
});

test('photos still work with and without a meetup', () => {
  assert.equal(decodePayload(encodePayload('look', 'https://x/y.jpg'), 1).mediaUrl, 'https://x/y.jpg');
  assert.equal(decodePayload(encodePayload('look', 'https://x/y.jpg'), 1).meeting, undefined);
});

test('events map to the right status', () => {
  const s = (event: string) => sanitizeMeeting({ ...meeting, event }, 1)?.status;
  assert.equal(s('accepted'), 'accepted'); assert.equal(s('declined'), 'declined'); assert.equal(s('cancelled'), 'cancelled');
  assert.equal(s('amended'), 'proposed'); assert.equal(s('nonsense'), 'proposed');
});

test('a peer cannot smuggle bad coordinates, huge strings or control characters into the card', () => {
  const bad = sanitizeMeeting({ ...meeting, lat: 999, lng: 'x', venueName: 'A\u0000B'.padEnd(500, 'z'), safetyTimerDurationMinutes: 99999 }, 1)!;
  assert.equal(bad.lat, undefined); assert.equal(bad.lng, undefined);
  assert.equal(bad.venueName.length, 120); assert.ok(!bad.venueName.includes('\u0000'));
  assert.equal(bad.safetyTimerDurationMinutes, 480);
  assert.equal(sanitizeMeeting({ ...meeting, lat: 51, lng: undefined }, 1)!.lat, undefined);   // both or neither
  assert.equal(sanitizeMeeting({ venueName: 'x' }, 1), undefined);
  assert.equal(sanitizeMeeting(null, 1), undefined);
});

test('event lines read naturally', () => {
  assert.match(meetingEventText('proposed', 'Tor Cafe', 'Now'), /let's meet at Tor Cafe/);
  assert.match(meetingEventText('cancelled', 'Tor Cafe', 'Now'), /cancelled/);
  assert.match(meetingEventText('amended', 'Tor Cafe', 'Now'), /updated/);
});

test('route links use only the venue, per platform', () => {
  const dest = { lat: 53.1, lng: -1.5 };
  assert.equal(routeUrl(dest, 'walk', true), 'https://maps.apple.com/?daddr=53.100000,-1.500000&dirflg=w');
  assert.equal(routeUrl(dest, 'transit', true), 'https://maps.apple.com/?daddr=53.100000,-1.500000&dirflg=r');
  assert.equal(routeUrl(dest, 'drive', false), 'https://www.google.com/maps/dir/?api=1&destination=53.100000,-1.500000&travelmode=driving');
  assert.equal(routeUrl(dest, 'cycle', false), 'https://www.google.com/maps/dir/?api=1&destination=53.100000,-1.500000&travelmode=bicycling');
  assert.equal(isApplePlatform('Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X)'), true);
  assert.equal(isApplePlatform('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)', 5), true);
  assert.equal(isApplePlatform('Mozilla/5.0 (Linux; Android 14)'), false);
});
