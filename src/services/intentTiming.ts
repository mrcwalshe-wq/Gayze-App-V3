/** Canonical scheduling for the existing composer options; stored in starts_at.
 * Tonight means 19:00 device-local time, or now if tonight has already begun.
 * Expiry is calculated from the scheduled start, not from the publish click.
 */
export function intentStartsAt(when: string, now = Date.now()): number {
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
  return 'Tonight';
}
