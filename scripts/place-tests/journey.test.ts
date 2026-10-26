import test from 'node:test';
import assert from 'node:assert/strict';
import { arrivalRadiusM, bearingDeg, directionState, distanceM, dueStage, estimateSpeed, etaMinutes, stageMessage, turnNeeded, type Stage } from '../../src/services/journey.ts';

const A = { lat: 51.5, lng: -0.12 };
const north = { lat: 51.51, lng: -0.12 };
const east = { lat: 51.5, lng: -0.10 };

test('bearing points the right way', () => {
  assert.ok(Math.abs(bearingDeg(A, north) - 0) < 1);
  assert.ok(Math.abs(bearingDeg(A, east) - 90) < 1);
  assert.ok(Math.abs(bearingDeg(north, A) - 180) < 1);
});

test('turnNeeded is signed and wraps', () => {
  assert.equal(turnNeeded(350, 10), 20);
  assert.equal(turnNeeded(10, 350), -20);
  assert.equal(Math.abs(turnNeeded(0, 180)), 180);
  assert.equal(turnNeeded(90, 90), 0);
});

test('direction colours: green, amber, red', () => {
  assert.equal(directionState(0), 'good');
  assert.equal(directionState(-20), 'good');
  assert.equal(directionState(35), 'near');
  assert.equal(directionState(-61), 'bad');
  assert.equal(directionState(180), 'bad');
});

test('eta uses a sane speed range', () => {
  assert.ok(Math.abs(etaMinutes(780, 1.3) - 10) < 0.01);
  assert.equal(Math.round(etaMinutes(1000, 0)), Math.round(1000 / 1.3 / 60));
  assert.ok(etaMinutes(1000, 500) >= 1000 / 14 / 60 - 0.001);
});

test('speed falls back to walking when still or short of data', () => {
  assert.equal(estimateSpeed([]), 1.3);
  const still = [{ t: 0, ...A }, { t: 60_000, ...A }];
  assert.equal(estimateSpeed(still), 1.3);
  const moving = [{ t: 0, ...A }, { t: 60_000, lat: 51.5 + 0.0009, lng: -0.12 }];   // ~100 m in 60 s
  assert.ok(Math.abs(estimateSpeed(moving) - 100 / 60) < 0.2);
  assert.equal(estimateSpeed([{ t: 0, ...A }, { t: 10_000, lat: 51.51, lng: -0.12 }]), 1.3);   // < 25 s: not trusted
});

const base = { distM: 2000, etaMin: 25, movedFromOriginM: 0, accuracyM: 20, handled: [] as Stage[] };

test('nothing is due until they actually set off', () => {
  assert.equal(dueStage(base), null);
  assert.equal(dueStage({ ...base, movedFromOriginM: 40 }), null);
  assert.equal(dueStage({ ...base, etaMin: 8, movedFromOriginM: 10 }), null);   // close, but has not moved: no spam
});

test('stages fire in order, once each', () => {
  let handled: Stage[] = [];
  const step = (o: object) => { const s = dueStage({ ...base, handled, ...o }); if (s) handled = [...handled, s]; return s; };
  assert.equal(step({ movedFromOriginM: 90 }), 'left');
  assert.equal(step({ movedFromOriginM: 200 }), null);
  assert.equal(step({ movedFromOriginM: 900, etaMin: 9.5, distM: 700 }), 'm10');
  assert.equal(step({ movedFromOriginM: 900, etaMin: 9, distM: 650 }), null);
  assert.equal(step({ movedFromOriginM: 1300, etaMin: 4.9, distM: 300 }), 'm5');
  assert.equal(step({ movedFromOriginM: 1600, etaMin: 0.5, distM: 40 }), 'arrived');
  assert.equal(step({ movedFromOriginM: 1600, etaMin: 0.4, distM: 30 }), null);
});

test('jumping ahead skips the earlier stages rather than sending them late', () => {
  assert.equal(dueStage({ ...base, movedFromOriginM: 600, etaMin: 4, distM: 300 }), 'm5');
  assert.equal(dueStage({ ...base, movedFromOriginM: 600, etaMin: 4, distM: 300, handled: ['m5'] }), null);
  assert.equal(dueStage({ ...base, movedFromOriginM: 600, etaMin: 9, distM: 300, handled: ['m5'] }), null);   // never goes backwards
});

test('a vague GPS fix decides nothing; arrival allows for accuracy', () => {
  assert.equal(dueStage({ ...base, movedFromOriginM: 900, etaMin: 3, distM: 20, accuracyM: 160 }), null);
  assert.equal(arrivalRadiusM(10), 60);
  assert.equal(arrivalRadiusM(90), 90);
  assert.equal(arrivalRadiusM(400), 150);
  assert.equal(dueStage({ ...base, movedFromOriginM: 900, etaMin: 1, distM: 85, accuracyM: 90, handled: ['left', 'm10', 'm5'] }), 'arrived');
});

test('messages carry status only, never coordinates', () => {
  for (const s of ['left', 'm10', 'm5', 'arrived'] as Stage[]) assert.doesNotMatch(stageMessage(s, 'Timberyard'), /\d{2}\.\d{3}|lat|lng/i);
  assert.match(stageMessage('left', 'Timberyard'), /On my way to Timberyard/);
  assert.match(stageMessage('m10', 'x'), /10 minutes/);
  assert.match(stageMessage('m5', 'x'), /5 minutes/);
  assert.match(stageMessage('arrived', 'Timberyard'), /arrived at Timberyard/);
  assert.ok(distanceM(A, north) > 1000 && distanceM(A, north) < 1200);
});
