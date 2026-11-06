/** Canonical scheduling for the composer options; stored in starts_at.
 * Tonight means 19:00 device-local time, or now if tonight has already begun.
 * Later is an explicit device-local date and time chosen by the person.
 * Expiry is calculated from the scheduled start, not from the publish click.
 */
const HOUR_MS = 3_600_000;
const DAY_MS = 86_400_000;

/** A Later start must be beyond the quick options, and not absurdly far out. */
export const LATER_MIN_LEAD_MS = 2 * HOUR_MS + 60_000;
export const LATER_MAX_LEAD_MS = 7 * DAY_MS;

export function intentStartsAt(when: string, now = Date.now(), laterAt?: number): number {
  if (when === 'Next 1 hour') return now + HOUR_MS;
  if (when === 'Next 2 hours') return now + 2 * HOUR_MS;
  if (when === 'Tonight') {
    const tonight = new Date(now);
    tonight.setHours(19, 0, 0, 0);
    return Math.max(now, tonight.getTime());
  }
  if (when === 'Later') {
    // Never fall back to "now": a Later signal without a valid start must not go live.
    if (laterAt === undefined || !Number.isFinite(laterAt)) throw new Error('Later needs a start date and time.');
    return laterAt;
  }
  return now;
}

const isTonightSlot = (startsAt: number, now: number): boolean => {
  const start = new Date(startsAt);
  const today = new Date(now);
  return start.getFullYear() === today.getFullYear()
    && start.getMonth() === today.getMonth()
    && start.getDate() === today.getDate()
    && start.getHours() === 19 && start.getMinutes() === 0
    && start.getSeconds() === 0 && start.getMilliseconds() === 0;
};

/** Elapsed activation age must never turn an active NOW intent into LATER. */
export function intentWhenLabel(startsAt: number, now = Date.now()): string {
  const remaining = startsAt - now;
  if (remaining <= 0) return 'Now';
  if (remaining <= HOUR_MS) return 'Next 1 hour';
  if (remaining <= 2 * HOUR_MS) return 'Next 2 hours';
  return isTonightSlot(startsAt, now) ? 'Tonight' : 'Later';
}

/* ---- Later: date and time helpers (all device-local) ---- */

const pad = (n: number) => String(n).padStart(2, '0');

/** ms -> value for <input type="datetime-local"> (YYYY-MM-DDTHH:mm, local). */
export function toLocalInputValue(ts: number): string {
  const d = new Date(ts);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/** <input type="datetime-local"> value -> ms, or NaN when empty or malformed. */
export function parseLocalInputValue(value: string): number {
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/.exec(value);
  if (!m) return NaN;
  const [y, mo, d, h, mi] = m.slice(1).map(Number);
  const date = new Date(y, mo - 1, d, h, mi, 0, 0);
  // Reject rollovers such as 31 Feb or a non-existent DST hour.
  if (date.getFullYear() !== y || date.getMonth() !== mo - 1 || date.getDate() !== d
    || date.getHours() !== h || date.getMinutes() !== mi) return NaN;
  return date.getTime();
}

/** Earliest and latest acceptable Later start, as datetime-local values. */
export function laterBounds(now = Date.now()): { min: string; max: string } {
  const minTs = Math.ceil((now + LATER_MIN_LEAD_MS) / 60_000) * 60_000;
  return { min: toLocalInputValue(minTs), max: toLocalInputValue(now + LATER_MAX_LEAD_MS) };
}

/** Sensible starting point: about three hours out, on the next quarter hour. */
export function defaultLaterAt(now = Date.now()): number {
  return Math.ceil((now + 3 * HOUR_MS) / 900_000) * 900_000;
}

/** null when valid, otherwise the reason a Later start cannot be used. */
export function validateLaterAt(laterAt: number, now = Date.now()): string | null {
  if (!Number.isFinite(laterAt)) return 'Choose a date and time for Later.';
  if (laterAt < now + LATER_MIN_LEAD_MS) return 'Pick a start more than 2 hours from now, or use one of the quicker options.';
  if (laterAt > now + LATER_MAX_LEAD_MS) return 'Pick a start within the next 7 days.';
  return null;
}

/** "Today 15:00", "Tomorrow 09:30", "Sat 14 Nov, 19:30". */
export function formatIntentStart(startsAt: number, now = Date.now()): string {
  const d = new Date(startsAt);
  const time = `${pad(d.getHours())}:${pad(d.getMinutes())}`;
  const dayStart = (ts: number) => { const x = new Date(ts); x.setHours(0, 0, 0, 0); return x.getTime(); };
  const dayDiff = Math.round((dayStart(startsAt) - dayStart(now)) / DAY_MS);
  if (dayDiff === 0) return `Today ${time}`;
  if (dayDiff === 1) return `Tomorrow ${time}`;
  const date = d.toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' }).replace(/,/g, '');
  return `${date}, ${time}`;
}

/** Timing label for a signal: Later shows its real start, every other option keeps its stored name. */
export function intentWhenDisplay(intent: { when: string; activatedAt: number }, now = Date.now()): string {
  return intent.when === 'Later' ? formatIntentStart(intent.activatedAt, now) : intent.when;
}
