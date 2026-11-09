export type ImpactStyleName = 'LIGHT' | 'MEDIUM' | 'HEAVY';
export interface HapticStep { at: number; style: ImpactStyleName }

/**
 * Turns a vibration pattern (buzz, pause, buzz, pause ...) into timed native taps: one tap at the start of each buzz,
 * its strength chosen from how long that buzz was. iPhones cannot vibrate for a set time, so a long buzz becomes a firmer tap.
 */
export function hapticStepsFor(pattern: number | number[]): HapticStep[] {
  const steps = Array.isArray(pattern) ? pattern : [pattern];
  const out: HapticStep[] = [];
  let at = 0;
  steps.forEach((ms, index) => {
    if (index % 2 === 0 && ms > 0) out.push({ at, style: ms <= 40 ? 'LIGHT' : ms <= 100 ? 'MEDIUM' : 'HEAVY' });
    at += ms;
  });
  return out;
}
