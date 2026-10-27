/**
 * Display names for stored intent values. The stored values ('Hookup',
 * 'Hookup · Host', …) are shared with the database, profiles and matching, so
 * they never change — only what people read does. GAYZE is a social meeting app,
 * so older private values are shown with neutral wording.
 */
const LABELS: Record<string, string> = {
  Hookup: 'Meet up',
  'Hookup · Host': 'Meet up · Host',
  'Hookup · Travel': 'Meet up · Travel',
  'Hookup · Outdoor': 'Meet up · Outdoors',
  'Hookup · Car': 'Meet up · Out and about',
  Other: 'Other',
};

export const intentDisplayLabel = (value?: string | null): string => {
  if (!value) return '';
  return LABELS[value] ?? value.replace(/Hookup/g, 'Meet up');
};
