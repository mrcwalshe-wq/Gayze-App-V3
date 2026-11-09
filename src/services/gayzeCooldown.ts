/**
 * Gayzes are limited to one new request per sender every 24 hours (the server rule gayze_enforce_send_cooldown). The server
 * refuses the rest with GAYZE_COOLDOWN and says how long to wait; these helpers turn that into words and remember it for the
 * rest of the session so a profile card can say so before anyone taps.
 */
export const COOLDOWN_FALLBACK_SECONDS = 86_400;

/** What a send came back with: sent, or refused (with the wait, when the refusal was the cooldown). */
export interface GayzeOutcome { sent: boolean; cooldownSeconds?: number }

/** "5h 12m", "42m", or "under a minute". */
export function formatCooldown(seconds: number): string {
  const total = Math.max(0, Math.ceil(seconds));
  if (total < 60) return 'under a minute';
  const hours = Math.floor(total / 3600);
  const minutes = Math.ceil((total % 3600) / 60);
  if (minutes === 60) return `${hours + 1}h 0m`;
  return hours > 0 ? `${hours}h ${minutes}m` : `${minutes}m`;
}

let waitUntil = 0;
/** Remember the wait the server just reported. Kept in memory only: the server is the truth and the rule may change. */
export function noteGayzeCooldown(seconds: number, now: number = Date.now()): void { waitUntil = now + Math.max(0, seconds) * 1000; }
/** Seconds left on the last reported wait, or 0. */
export function gayzeCooldownRemaining(now: number = Date.now()): number { return Math.max(0, Math.ceil((waitUntil - now) / 1000)); }
