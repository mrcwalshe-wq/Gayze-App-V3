import { distanceKm, type LatLng } from './geo';

/** Journey progress, shared with the other person as four short chat messages. Never coordinates. */
export type Stage = 'left' | 'm10' | 'm5' | 'arrived';
export const STAGES: Stage[] = ['left', 'm10', 'm5', 'arrived'];

export const WALKING_SPEED_MPS = 1.3;     // ~4.7 km/h, used until a real speed has been measured
export const LEFT_AFTER_M = 75;           // moved this far from where they started = "on my way"
export const GOOD_WITHIN_DEG = 20;        // pointing within this of the destination = green
export const BAD_BEYOND_DEG = 60;         // pointing further off than this = red (between = amber)

export const distanceM = (a: LatLng, b: LatLng) => distanceKm(a, b) * 1000;

/** Compass bearing from a to b, 0..360 (0 = north). */
export function bearingDeg(a: LatLng, b: LatLng): number {
  const rad = (d: number) => (d * Math.PI) / 180;
  const y = Math.sin(rad(b.lng - a.lng)) * Math.cos(rad(b.lat));
  const x = Math.cos(rad(a.lat)) * Math.sin(rad(b.lat)) - Math.sin(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.cos(rad(b.lng - a.lng));
  return (Math.atan2(y, x) * 180 / Math.PI + 360) % 360;
}

/** Signed turn needed from `heading` to face `bearing`, -180..180. Positive = turn right. */
export function turnNeeded(heading: number, bearing: number): number {
  return ((bearing - heading + 540) % 360) - 180;
}

export type Direction = 'good' | 'near' | 'bad';
export function directionState(turn: number): Direction {
  const a = Math.abs(turn);
  return a <= GOOD_WITHIN_DEG ? 'good' : a <= BAD_BEYOND_DEG ? 'near' : 'bad';
}

export function etaMinutes(distM: number, speedMps: number): number {
  const v = Math.min(14, Math.max(0.8, speedMps || WALKING_SPEED_MPS));
  return distM / v / 60;
}

/** How close counts as arrived: at least 60 m, wider when the GPS fix is poor (but not unlimited). */
export const arrivalRadiusM = (accuracyM: number) => Math.min(150, Math.max(60, accuracyM || 0));

export interface DueInput { distM: number; etaMin: number; movedFromOriginM: number; accuracyM: number; handled: Stage[] }

/** The most advanced stage reached that has not been handled yet. Earlier stages are skipped, not sent late. */
export function dueStage(i: DueInput): Stage | null {
  if (i.accuracyM > 100) return null;                        // a fix this vague cannot decide anything
  const reached: Stage[] = [];
  if (i.movedFromOriginM >= LEFT_AFTER_M || i.distM <= arrivalRadiusM(i.accuracyM)) reached.push('left');
  if (i.etaMin <= 10) reached.push('m10');
  if (i.etaMin <= 5) reached.push('m5');
  if (i.distM <= arrivalRadiusM(i.accuracyM)) reached.push('arrived');
  // 'left' only counts once they have really set off
  const top = reached.filter((s) => !(s === 'm10' || s === 'm5' || s === 'arrived') || i.movedFromOriginM >= LEFT_AFTER_M || s === 'arrived').pop();
  return top && !i.handled.includes(top) && STAGES.indexOf(top) > Math.max(-1, ...i.handled.map((h) => STAGES.indexOf(h))) ? top : null;
}

export function stageMessage(stage: Stage, venue: string): string {
  switch (stage) {
    case 'left': return `On my way to ${venue}.`;
    case 'm10': return 'About 10 minutes away.';
    case 'm5': return 'About 5 minutes away.';
    case 'arrived': return `I've arrived at ${venue}.`;
  }
}

/** Speed in m/s from recent fixes (needs ≥ 25 s of history and real movement), else the walking default. */
export function estimateSpeed(samples: { t: number; lat: number; lng: number }[]): number {
  if (samples.length < 2) return WALKING_SPEED_MPS;
  const last = samples[samples.length - 1];
  const first = samples.find((s) => last.t - s.t <= 90_000) ?? samples[0];
  const dt = (last.t - first.t) / 1000;
  if (dt < 25) return WALKING_SPEED_MPS;
  const v = distanceM(first, last) / dt;
  return v < 0.6 ? WALKING_SPEED_MPS : Math.min(14, v);
}

export const formatMeters = (m: number) => (m < 950 ? `${Math.max(10, Math.round(m / 10) * 10)} m` : `${(m / 1000).toFixed(m < 9950 ? 1 : 0)} km`);
