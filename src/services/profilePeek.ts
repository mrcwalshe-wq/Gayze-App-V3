/**
 * Pure helpers for the profile peek sheet: which photos to show and in what order,
 * which few facts are worth showing in the short view, and what two people share.
 * Kept free of UI and network code so the choices are testable.
 */

export interface PeerPhotoRow { id: string; storage_path: string; sort_order: number | null; is_primary: boolean | null; user_id?: string }

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const isUuid = (value: string | null | undefined): value is string => Boolean(value && UUID.test(value));

/** Primary photo first, then the owner's own order. Duplicates by path are dropped. */
export function orderPeerPhotos<T extends PeerPhotoRow>(rows: readonly T[]): T[] {
  const seen = new Set<string>();
  return [...rows]
    .sort((a, b) => Number(Boolean(b.is_primary)) - Number(Boolean(a.is_primary)) || (a.sort_order ?? 0) - (b.sort_order ?? 0))
    .filter((row) => (seen.has(row.storage_path) ? false : (seen.add(row.storage_path), true)));
}

const norm = (value: string) => value.trim().toLowerCase();

export interface HighlightInput { lookingFor: string[]; hobbies: string[] }
export interface Highlight { label: string; shared: boolean; kind: 'lookingFor' | 'hobby' }

/**
 * Up to `limit` chips for the short view. Anything the viewer also has comes first,
 * then what they are looking for, then interests, so the first thing you see is
 * what you have in common.
 */
export function pickHighlights(them: HighlightInput, me: HighlightInput | null, limit = 5): { chips: Highlight[]; sharedCount: number } {
  const mine = new Set([...(me?.lookingFor ?? []), ...(me?.hobbies ?? [])].map(norm));
  const all: Highlight[] = [
    ...them.lookingFor.map((label): Highlight => ({ label, shared: mine.has(norm(label)), kind: 'lookingFor' })),
    ...them.hobbies.map((label): Highlight => ({ label, shared: mine.has(norm(label)), kind: 'hobby' })),
  ];
  const unique: Highlight[] = [];
  const seen = new Set<string>();
  for (const item of all) {
    const key = norm(item.label);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    unique.push(item);
  }
  const sharedCount = unique.filter((item) => item.shared).length;
  const ordered = [...unique.filter((item) => item.shared), ...unique.filter((item) => !item.shared)];
  return { chips: ordered.slice(0, limit), sharedCount };
}

/** A single compact line: "he/him · 182 cm · Athletic". */
export function shortFacts(input: { pronouns?: string; heightCm?: number; bodyType?: string }): string[] {
  return [input.pronouns, input.heightCm ? `${input.heightCm} cm` : undefined, input.bodyType].filter((v): v is string => Boolean(v && v.trim()));
}

/** Short view keeps the bio to a sentence or two; the full text is behind "More". */
export function isLongBio(bio: string | undefined, limit = 140): boolean {
  return Boolean(bio && bio.length > limit);
}
