/**
 * Intent model v2: a signal is three separate choices.
 *   availability  when (Right now / Later), stored as starts_at and expires_at
 *   activity      what the person is up for (a short list, one or more)
 *   connection    what kinds of connection they are open to
 * "Open to more" is a separate private flag and is deliberately not part of this file's public data.
 * The ids below are stored in the database (intents.activities / intents.connections) and checked there.
 */
export const ACTIVITIES = [
  { id: 'coffee', label: 'Coffee & conversation', hint: 'Relaxed, daytime' },
  { id: 'drinks', label: 'Drinks', hint: 'A pint or a cocktail' },
  { id: 'food', label: 'Food', hint: 'Eat out, street food, markets' },
  { id: 'walks', label: 'Walks & fresh air', hint: 'Park, river, a wander' },
  { id: 'music', label: 'Music & events', hint: 'Gigs, club nights, festivals' },
  { id: 'fitness', label: 'Fitness & sport', hint: 'Gym, run, swim, climb' },
  { id: 'explore', label: 'Explore the city', hint: 'Somewhere you have not been' },
  { id: 'culture', label: 'Culture & film', hint: 'Galleries, cinema, theatre' },
  { id: 'games', label: 'Games & hobbies', hint: 'Board games, making, crafts' },
  { id: 'chat', label: 'Just chatting', hint: 'Online first, no plans' },
  { id: 'spontaneous', label: 'Something spontaneous', hint: 'See what comes up' },
] as const;

export const CONNECTIONS = [
  { id: 'new', label: 'Meeting new people' },
  { id: 'friends', label: 'Making friends' },
  { id: 'dating', label: 'Dating' },
  { id: 'see', label: 'Open to seeing where things go' },
  { id: 'social', label: 'Just socialising' },
] as const;

export type ActivityId = (typeof ACTIVITIES)[number]['id'];
export type ConnectionId = (typeof CONNECTIONS)[number]['id'];

export const MAX_ACTIVITIES = 6;

export const activityLabel = (id: string): string => ACTIVITIES.find((a) => a.id === id)?.label ?? id;
export const connectionLabel = (id: string): string => CONNECTIONS.find((c) => c.id === id)?.label ?? id;

/** Only known ids, no duplicates, capped. What the app sends to the database. */
export function cleanActivities(values: readonly string[] | undefined): ActivityId[] {
  const known = new Set<string>(ACTIVITIES.map((a) => a.id));
  return [...new Set((values ?? []).filter((v) => known.has(v)))].slice(0, MAX_ACTIVITIES) as ActivityId[];
}
export function cleanConnections(values: readonly string[] | undefined): ConnectionId[] {
  const known = new Set<string>(CONNECTIONS.map((c) => c.id));
  return [...new Set((values ?? []).filter((v) => known.has(v)))] as ConnectionId[];
}

/** A short line for lists and chips: "Coffee & conversation +1". */
export function activitySummary(values: readonly string[] | undefined): string {
  const list = cleanActivities(values);
  if (list.length === 0) return '';
  return list.length === 1 ? activityLabel(list[0]) : `${activityLabel(list[0])} +${list.length - 1}`;
}

/** For older signals that have no activities saved yet (local/demo data): the closest activity. */
export function legacyActivityFor(intent: string | undefined | null): ActivityId[] {
  switch (intent) {
    case 'Drinks': case 'Date': return ['drinks'];
    case 'Chat': return ['chat'];
    case 'Hookup · Outdoor': return ['walks'];
    default: return ['spontaneous'];
  }
}
