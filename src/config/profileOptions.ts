/**
 * Shared vocabulary for the Profile / "About you" experience.
 *
 * Kept in `src/config` (not in a component) for the same reason as
 * `mapDefaults.ts`: tests and components import these without pulling a lazy
 * view chunk into the main bundle.
 *
 * Storage mapping (see BACKEND_REQUIREMENTS.md §10):
 * - "What I'm looking for" is stored in the EXISTING `profiles.interests`
 *   column. Existing rows already hold values from this vocabulary (Meet,
 *   Drinks, Date, Chat, Group, Hookup · …) — nothing is migrated or renamed.
 * - Everything else is stored in the additive columns added by
 *   `supabase/migrations/20261001090000_profile_about_you.sql`.
 */

/** "What I'm looking for" — multi-select. Stored in `profiles.interests`. */
export const LOOKING_FOR_OPTIONS = [
  'Chat',
  'Friends',
  'Drinks',
  'Date',
  'Hookup',
  'Regular connection',
  'Travel',
  'Outdoor',
  'Events',
] as const;

/**
 * Legacy onboarding values that live users already have in `profiles.interests`.
 * They stay selectable/deselectable so no existing data is lost or silently
 * re-worded.
 */
export const LEGACY_LOOKING_FOR_OPTIONS = [
  'Meet',
  'Group',
  'Hookup · Host',
  'Hookup · Travel',
  'Hookup · Outdoor',
  'Hookup · Car',
] as const;

/** Compact first view of the interests picker ("+ Add interests" reveals the rest). */
export const INTEREST_OPTIONS = [
  'Fitness',
  'Gym',
  'Travel',
  'Food',
  'Music',
  'Films',
  'Gaming',
  'Art',
  'Fashion',
  'Outdoors',
  'Nightlife',
  'Photography',
  'Coffee',
  'Dogs',
] as const;

/** How many interest chips to show before the "+ Add interests" affordance. */
export const INTERESTS_PREVIEW_COUNT = 8;

/** Role / position — single-select, completely optional. */
export const INTIMACY_ROLE_OPTIONS = [
  'Top',
  'Bottom',
  'Versatile',
  'Versatile top',
  'Versatile bottom',
  'Prefer not to say',
] as const;

/** Non-graphic intimacy preference categories — multi-select, optional. */
export const INTIMACY_PREFERENCE_OPTIONS = [
  'Kissing',
  'Cuddling',
  'Oral',
  'Toys',
  'Massage',
  'Roleplay',
  'Group',
  'Public/social settings',
  'Private settings',
] as const;

/** Experience / openness — single-select, optional. */
export const INTIMACY_EXPERIENCE_OPTIONS = [
  'Exploring',
  'Open to new things',
  'Prefer familiar',
  'Not specified',
] as const;

export type IntimacyVisibility = 'everyone' | 'connections' | 'private';

export const INTIMACY_VISIBILITY_OPTIONS: ReadonlyArray<{
  value: IntimacyVisibility;
  label: string;
  hint: string;
}> = [
  { value: 'everyone', label: 'Everyone', hint: 'Anyone discovering you' },
  { value: 'connections', label: 'Connections only', hint: 'After a mutual interest' },
  { value: 'private', label: 'Private', hint: 'Only you' },
];

/**
 * Privacy-preserving default for sensitive intimacy preferences.
 * Never defaults to public: the user must opt in to wider visibility.
 */
export const DEFAULT_INTIMACY_VISIBILITY: IntimacyVisibility = 'connections';

/** Boundaries — multi-select, optional, compatibility-not-judgement copy. */
export const BOUNDARY_OPTIONS = [
  'No drugs',
  'No smoking',
  'Safer sex',
  'Respect boundaries',
  'Discretion important',
  'Prefer verified users',
] as const;

/** My setup — multi-select compatibility tags. */
export const MY_SETUP_OPTIONS = [
  'Can host',
  'Cannot host',
  'Sometimes host',
  'Prefer to travel',
  'Can travel',
  'Depends',
] as const;

/**
 * Availability — multi-select. "Right now" / "Later" are the Intent system's
 * timing modes (see SetIntentSheet); selecting them here is a standing
 * preference, and the real broadcast stays the Intent system's job.
 */
export const AVAILABILITY_OPTIONS = [
  'Right now',
  'Later',
  'Weekdays',
  'Weekends',
  'Flexible',
] as const;

export const PRONOUN_OPTIONS = ['he/him', 'she/her', 'they/them', 'ze/zir'] as const;

export const BODY_TYPE_OPTIONS = [
  'Slim',
  'Athletic',
  'Average',
  'Muscular',
  'Curvy',
  'Stocky',
  'Prefer not to say',
] as const;

/** Ordered, most-material-first checklist for the completion indicator. */
export const COMPLETION_PRIORITIES = [
  { key: 'photo', label: 'Profile photo', section: 'identity' },
  { key: 'lookingFor', label: "What you're looking for", section: 'lookingFor' },
  { key: 'interests', label: 'Interests', section: 'interests' },
  { key: 'intimacy', label: 'Role or preferences', section: 'intimacy' },
  { key: 'setup', label: 'Hosting & travel', section: 'setup' },
  { key: 'bio', label: 'Short bio', section: 'identity' },
] as const;

export type EditSectionKey =
  | 'identity'
  | 'lookingFor'
  | 'intimacy'
  | 'interests'
  | 'setup'
  | 'boundaries'
  | 'privacy';

/**
 * Profile completion as a percentage plus the missing items, in priority
 * order. Pure function so the UI and the tests share one definition.
 */
export function computeProfileCompletion(input: {
  hasPhoto: boolean;
  lookingForCount: number;
  interestCount: number;
  hasIntimacy: boolean;
  setupCount: number;
  hasBio: boolean;
}): { percent: number; missing: typeof COMPLETION_PRIORITIES[number][] } {
  const filled: Record<string, boolean> = {
    photo: input.hasPhoto,
    lookingFor: input.lookingForCount > 0,
    interests: input.interestCount > 0,
    intimacy: input.hasIntimacy,
    setup: input.setupCount > 0,
    bio: input.hasBio,
  };
  const missing = COMPLETION_PRIORITIES.filter((item) => !filled[item.key]);
  return {
    percent: Math.round(((COMPLETION_PRIORITIES.length - missing.length) / COMPLETION_PRIORITIES.length) * 100),
    missing: [...missing],
  };
}

/** Chips a user still has selected that are no longer in the picker vocabulary. */
export function withLegacyValues(current: string[], options: readonly string[]): string[] {
  const extras = current.filter((value) => !options.includes(value));
  return [...options, ...extras];
}
