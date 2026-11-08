/** Events: the six categories, how older ones are read, and the times offered for a quick plan. */
export const EVENT_CATEGORIES = ['social', 'games', 'outdoor', 'music', 'food', 'fitness'] as const;

// Events saved before the six categories existed are read as their closest new category.
const LEGACY_CATEGORY: Record<string, string> = { active: 'outdoor', nightlife: 'music', arts: 'games', discussions: 'social' };
export const categoryKey = (category: string, known: readonly string[] = EVENT_CATEGORIES): string =>
  (known.includes(category) ? category : LEGACY_CATEGORY[category] ?? 'social');

export type QuickWhen = 'hour' | 'tonight' | 'tomorrow' | 'weekend' | 'sunday';

/** The start time (ms) for a quick plan. Always in the future: tonight rolls on if 19:30 has passed, and a day that is
 *  today but already gone moves to next week. */
export function quickTime(when: QuickWhen, from: Date = new Date()): number {
  const now = from.getTime();
  const d = new Date(now);
  if (when === 'hour') return now + 60 * 60_000;
  if (when === 'tonight') { d.setHours(19, 30, 0, 0); return d.getTime() < now + 30 * 60_000 ? now + 90 * 60_000 : d.getTime(); }
  if (when === 'tomorrow') { d.setDate(d.getDate() + 1); d.setHours(12, 0, 0, 0); return d.getTime(); }
  const target = when === 'sunday' ? 0 : 6; // Sunday 11:00, or Saturday 21:00
  d.setHours(when === 'sunday' ? 11 : 21, 0, 0, 0);
  let add = (target - d.getDay() + 7) % 7;
  if (add === 0 && d.getTime() < now + 30 * 60_000) add = 7;
  d.setDate(d.getDate() + add);
  return d.getTime();
}
