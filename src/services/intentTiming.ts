/** Canonical scheduling for the existing composer options; stored in starts_at.
 * Tonight means 19:00 device-local time, or now if tonight has already begun.
 * Expiry is calculated from the scheduled start, not from the publish click.
 */
export function intentStartsAt(when: string, now = Date.now(), laterAt?: number): number {
  if (when === 'Later') return typeof laterAt === 'number' && Number.isFinite(laterAt) ? Math.max(now, laterAt) : now;
  if (when === 'Next 1 hour') return now + 3_600_000;
  if (when === 'Next 2 hours') return now + 7_200_000;
  if (when === 'Tonight') {
    const tonight = new Date(now);
    tonight.setHours(19, 0, 0, 0);
    return Math.max(now, tonight.getTime());
  }
  return now;
}

/** Elapsed activation age must never turn an active NOW intent into LATER. */
export function intentWhenLabel(startsAt: number, now = Date.now()): string {
  const remaining = startsAt - now;
  if (remaining <= 0) return 'Now';
  if (remaining <= 3_600_000) return 'Next 1 hour';
  if (remaining <= 7_200_000) return 'Next 2 hours';
  // The standard "Tonight" start is 19:00 the same day; any other start more than two hours away is a date and time picked for later.
  const start = new Date(startsAt), today = new Date(now);
  const isTonight = start.getHours() === 19 && start.getMinutes() === 0 && start.toDateString() === today.toDateString();
  return isTonight ? 'Tonight' : 'Later';
}

/** "Sat 8 Nov, 19:30" for a signal planned for later. */
export function formatLaterAt(startsAt: number): string {
  return new Date(startsAt).toLocaleString([], { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
}

/**
 * Which colour an active signal wears across the whole app: purple for anything within a day (right now, 1 h, 2 h, tonight)
 * and gold for a signal planned for later. The existing styles call these "private" (purple) and "social" (gold).
 */
export function intentThemeMode(intent: { when: string } | null | undefined): 'private' | 'social' | null {
  if (!intent) return null;
  return intent.when === 'Later' ? 'social' : 'private';
}
