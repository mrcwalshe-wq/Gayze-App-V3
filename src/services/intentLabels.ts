/**
 * Display names for stored intent values. The stored values ('Hookup',
 * 'Hookup · Host', …) are shared with the database, profiles and matching, so
 * they never change — only what people read does.
 */
const LABELS: Record<string, string> = {
  Hookup: 'Intimate',
  'Hookup · Host': 'Intimate · Host',
  'Hookup · Travel': 'Intimate · Travel',
  'Hookup · Outdoor': 'Intimate · Outdoors',
  'Hookup · Car': 'Intimate · By car',
  Other: 'Other',
};

export const intentDisplayLabel = (value?: string | null): string => {
  if (!value) return '';
  return LABELS[value] ?? value.replace(/Hookup/g, 'Intimate');
};
