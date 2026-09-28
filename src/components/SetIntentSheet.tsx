import React, { useState, useEffect } from 'react';
import {
  X,
  Check,
  Home,
  Radio,
} from 'lucide-react';
import { hapticLight, hapticSensitiveAction } from '../services/hapticService';
import {
  SafeHaven,
  TopLevelIntentMode,
  EncounterIntent,
  SocialIntent,
  PrivateIntent,
  UserActiveIntent,
} from '../types';

export { type UserActiveIntent };

interface SetIntentSheetProps {
  isOpen: boolean;
  onClose: () => void;
  onSaveIntent: (intentData: UserActiveIntent) => void;
  existingIntent?: UserActiveIntent | null;
  safeHavens?: SafeHaven[];
  userNeighborhood: string;
  defaultWhen?: string;
}

/* ------------------------------------------------------------------ */
/* Option vocabularies (stored values are shared across the product)   */
/* ------------------------------------------------------------------ */

const SOCIAL_OPTIONS: { value: SocialIntent; label: string; hint?: string }[] = [
  { value: 'Meet', label: 'Meet', hint: 'Coffee, a walk, a wander' },
  { value: 'Drinks', label: 'Drinks', hint: 'A drink nearby' },
  { value: 'Date', label: 'Date', hint: 'Something with chemistry' },
  { value: 'Chat', label: 'Chat', hint: 'Conversation first' },
  { value: 'Group', label: 'Group', hint: 'Company, not just two' },
];

const PRIVATE_OPTIONS: { value: PrivateIntent; label: string; hint?: string }[] = [
  { value: 'Hookup', label: 'Hookup', hint: 'Open, no fixed plan' },
  { value: 'Hookup · Host', label: 'Hookup Host', hint: 'You have the place' },
  { value: 'Hookup · Travel', label: 'Hookup Travel', hint: 'Happy to come to you' },
  { value: 'Hookup · Outdoor', label: 'Hookup Outdoor', hint: 'Out & discreet' },
  { value: 'Hookup · Car', label: 'Hookup Car', hint: 'A private vehicle' },
  { value: 'Other', label: 'Something else', hint: 'Say it in your words' },
];

const WHEN_OPTIONS: { value: string; label: string }[] = [
  { value: 'Now', label: 'Right now' },
  { value: 'Next 1 hour', label: '1 hour' },
  { value: 'Next 2 hours', label: '2 hours' },
  { value: 'Tonight', label: 'Tonight' },
];

const DURATION_OPTIONS = ['1 hr', '2 hrs'] as const;
const DISTANCE_OPTIONS = ['Walking distance', 'Within 2 km', 'Within 5 km', 'Willing to travel'];
const HOST_OPTIONS = ['Can host', 'Cannot host', 'Depends'] as const;
const TRAVEL_OPTIONS = ['Yes', 'Within reason', 'Car required'] as const;

const QUICK_SUGGESTIONS: Record<string, string[]> = {
  Meet: ['Quick coffee, easy conversation', 'Stroll around the neighbourhood', 'Open to meeting someone grounded nearby'],
  Drinks: ['Low-key cocktail after work', 'Quiet terrace drink nearby', 'One drink, see where it goes'],
  Date: ['Dinner or gallery together', 'Low-pressure evening out', 'Good conversation, mutual chemistry'],
  Chat: ['Tea and a long conversation', 'Walking chat, no agenda', 'Making a new friend in the area'],
  Group: ['Gym or bouldering session', 'Exhibition or park meetup', 'Joining something happening tonight'],
  Hookup: ['Spontaneous, discreet, respectful', 'Mutual vibes, clear boundaries', 'Low-key connection tonight'],
  'Hookup · Host': ['Hosting nearby — clean & discreet', 'My place, drinks chilled', 'Low-key hosting right now'],
  'Hookup · Travel': ['Mobile, can come to you', 'Within a reasonable radius', 'Discreet travel nearby'],
  'Hookup · Outdoor': ['Quiet secluded spot', 'Night walk, low-key', 'Discreet outdoors'],
  'Hookup · Car': ['Comfortable private car', 'Discreet car meetup', 'Respectful & safe'],
  Other: ['Discreet with clear boundaries', 'Open to a specific vibe', 'Respectful communication first'],
};

const optionLabel = (value: EncounterIntent): string => {
  const all = [...SOCIAL_OPTIONS, ...PRIVATE_OPTIONS];
  return all.find((o) => o.value === value)?.label ?? String(value);
};

/**
 * Intent composer — "set a live signal", not a profile form.
 * Progressive disclosure: WHAT ARE YOU UP FOR? → WHAT? → optional details.
 */
export const SetIntentSheet: React.FC<SetIntentSheetProps> = ({
  isOpen,
  onClose,
  onSaveIntent,
  existingIntent,
  safeHavens = [],
  userNeighborhood,
  defaultWhen = 'Now',
}) => {
  const [mode, setMode] = useState<TopLevelIntentMode | null>(null);
  const [intent, setIntent] = useState<EncounterIntent | null>(null);
  const [description, setDescription] = useState('');
  const [when, setWhen] = useState<string>(defaultWhen);
  const [duration, setDuration] = useState<'1 hr' | '2 hrs'>('2 hrs');
  const [travelDistance, setTravelDistance] = useState('Within 2 km');
  const [canHost, setCanHost] = useState<'Can host' | 'Cannot host' | 'Depends'>('Can host');
  const [travelWillingness, setTravelWillingness] = useState<'Yes' | 'Within reason' | 'Car required'>('Yes');
  const [useSafeHaven, setUseSafeHaven] = useState(false);
  const [selectedHaven, setSelectedHaven] = useState<SafeHaven | null>(safeHavens[0] ?? null);

  const isEditing = Boolean(existingIntent);
  const isPrivateMode = mode === 'private';

  useEffect(() => {
    if (!isOpen) return;
    if (existingIntent) {
      setMode(existingIntent.mode);
      setIntent(existingIntent.intent);
      setDescription(existingIntent.description || '');
      setWhen(existingIntent.when || defaultWhen);
      setDuration(existingIntent.duration === '1 hr' ? '1 hr' : '2 hrs');
      setTravelDistance(existingIntent.travelDistance || 'Within 2 km');
      setCanHost(existingIntent.canHost || 'Can host');
      setTravelWillingness(existingIntent.travelWillingness || 'Yes');
      setUseSafeHaven(Boolean(existingIntent.isNearSafeHaven));
      if (existingIntent.safeHavenName) {
        const match = safeHavens.find((h) => h.name === existingIntent.safeHavenName);
        if (match) setSelectedHaven(match);
      }
    } else {
      setMode(null);
      setIntent(null);
      setDescription('');
      setWhen(defaultWhen);
      setDuration('2 hrs');
      setTravelDistance('Within 2 km');
      setCanHost('Can host');
      setTravelWillingness('Yes');
      setUseSafeHaven(false);
    }
  }, [isOpen, existingIntent, defaultWhen, safeHavens]);

  if (!isOpen) return null;

  const tone = isPrivateMode ? 'private' : 'social';
  const options = isPrivateMode ? PRIVATE_OPTIONS : SOCIAL_OPTIONS;

  const handleSelectMode = (next: TopLevelIntentMode) => {
    hapticLight();
    if (next !== mode) {
      setMode(next);
      setIntent(null);
      setDescription('');
    }
  };

  const handleSelectIntent = (value: EncounterIntent) => {
    hapticLight();
    setIntent(value);
    if (!description && QUICK_SUGGESTIONS[value]?.[0]) {
      setDescription(QUICK_SUGGESTIONS[value][0]);
    }
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!mode || !intent) return;
    hapticSensitiveAction();

    const durationMs = (duration === '1 hr' ? 1 : 2) * 3600 * 1000;
    const activatedAt = Date.now();
    const expiresAt = activatedAt + durationMs;

    const areaText = useSafeHaven && selectedHaven
      ? `${selectedHaven.name} (Safe Haven, ${userNeighborhood})`
      : `${userNeighborhood} (Approximate ±300m)`;

    const activeData: UserActiveIntent = {
      mode,
      intent,
      description: description.trim() || `Available for ${optionLabel(intent)} in ${userNeighborhood}`,
      when,
      duration,
      travelDistance,
      canHost: intent === 'Hookup · Host' ? canHost : undefined,
      travelWillingness: intent === 'Hookup · Travel' ? travelWillingness : undefined,
      context: mode === 'private' ? 'Private' : 'Public',
      area: areaText,
      isNearSafeHaven: useSafeHaven,
      safeHavenName: useSafeHaven && selectedHaven ? selectedHaven.name : undefined,
      activatedAt,
      expiresAt,
      isPaused: false,
    };

    onSaveIntent(activeData);
    onClose();
  };

  const suggestions = intent ? QUICK_SUGGESTIONS[intent] ?? [] : [];
  const showHosting = intent === 'Hookup · Host';
  const showTravel = intent === 'Hookup · Travel';

  return (
    <div
      className="g-overlay flex items-end sm:items-center justify-center sm:p-4"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-labelledby="set-intent-title"
    >
      <div
        className="g-sheet"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="g-sheet__grip" />

        {/* Header */}
        <div className="g-sheet__head">
          <div className="flex items-center gap-2.5 min-w-0">
            <span className={`flex items-center justify-center w-8 h-8 rounded-[11px] shrink-0 ${
              isEditing
                ? 'bg-[#6F3CC3]/18 border border-[#6F3CC3]/45 text-[#b796f0] shadow-[inset_0_1px_0_rgba(170,132,245,0.16)]'
                : 'bg-white/[0.04] border border-white/[0.09] text-zinc-400'
            }`}>
              <Radio className="w-4 h-4" />
            </span>
            <div className="min-w-0">
              <h2 id="set-intent-title" className="text-[15.5px] font-semibold tracking-[-0.015em] text-white leading-tight">
                {isEditing ? 'Your live signal' : 'Set a live signal'}
              </h2>
              <p className="text-[11px] text-zinc-500 leading-tight mt-0.5">
                {isEditing ? 'Update what you’re open to right now.' : 'Say what you’re up for — visible nearby until it expires.'}
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="g-icon-btn g-icon-btn--bare shrink-0"
            aria-label="Close"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="flex-1 flex flex-col overflow-hidden min-h-0">
          <div className="g-sheet__body">
            {/* STEP 1 — mode */}
            <div className="pt-1 pb-3">
              <span className="g-label">What are you up for?</span>
              <div className="grid grid-cols-2 gap-2.5 mt-2.5">
                <button
                  type="button"
                  className="g-opt"
                  data-tone="social"
                  data-active={mode === 'social'}
                  onClick={() => handleSelectMode('social')}
                >
                  <span className="g-opt__t">Social</span>
                  <span className="g-opt__d">Meet · Drinks · Dates · Groups</span>
                  {mode === 'social' && (
                    <span className="absolute top-2.5 right-2.5 w-5 h-5 rounded-full bg-[#C9A24D] flex items-center justify-center">
                      <Check className="w-3 h-3 text-black" strokeWidth={3} />
                    </span>
                  )}
                </button>

                <button
                  type="button"
                  className="g-opt"
                  data-tone="private"
                  data-active={mode === 'private'}
                  onClick={() => handleSelectMode('private')}
                >
                  <span className="g-opt__t">Private</span>
                  <span className="g-opt__d">Discreet · one-to-one</span>
                  {mode === 'private' && (
                    <span className="absolute top-2.5 right-2.5 w-5 h-5 rounded-full bg-[#6F3CC3] flex items-center justify-center">
                      <Check className="w-3 h-3 text-white" strokeWidth={3} />
                    </span>
                  )}
                </button>
              </div>
            </div>

            {/* STEP 2 — what */}
            {mode && (
              <div className="g-reveal pt-3 pb-3 border-t border-white/[0.07]">
                <span className="g-label">What?</span>
                <div className="grid grid-cols-2 sm:grid-cols-3 gap-2 mt-2.5">
                  {options.map((opt) => (
                    <button
                      key={opt.value}
                      type="button"
                      className="g-opt g-opt--sm"
                      data-tone={tone}
                      data-active={intent === opt.value}
                      onClick={() => handleSelectIntent(opt.value)}
                    >
                      <span className="g-opt__t">{opt.label}</span>
                      {opt.hint && <span className="g-opt__d hidden sm:block">{opt.hint}</span>}
                    </button>
                  ))}
                </div>
              </div>
            )}

            {/* STEP 3 — contextual details */}
            {mode && intent && (
              <div className="g-reveal pt-3 border-t border-white/[0.07] space-y-4 pb-2">
                <div>
                  <span className="g-label">When</span>
                  <div className="flex flex-wrap gap-2 mt-2.5">
                    {WHEN_OPTIONS.map((opt) => (
                      <button
                        key={opt.value}
                        type="button"
                        className="g-optpill"
                        data-active={when === opt.value}
                        onClick={() => { hapticLight(); setWhen(opt.value); }}
                      >
                        {opt.label}
                      </button>
                    ))}
                  </div>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div>
                    <span className="g-label">Time available</span>
                    <div className="flex flex-wrap gap-2 mt-2.5">
                      {DURATION_OPTIONS.map((d) => (
                        <button
                          key={d}
                          type="button"
                          className="g-optpill"
                          data-active={duration === d}
                          onClick={() => { hapticLight(); setDuration(d); }}
                        >
                          {d}
                        </button>
                      ))}
                    </div>
                  </div>

                  <div>
                    <span className="g-label">How far you’ll go</span>
                    <div className="flex flex-wrap gap-2 mt-2.5">
                      {DISTANCE_OPTIONS.map((d) => (
                        <button
                          key={d}
                          type="button"
                          className="g-optpill"
                          data-tone="amber"
                          data-active={travelDistance === d}
                          onClick={() => { hapticLight(); setTravelDistance(d); }}
                        >
                          {d}
                        </button>
                      ))}
                    </div>
                  </div>
                </div>

                {showHosting && (
                  <div className="g-reveal">
                    <span className="g-label flex items-center gap-1.5">
                      <Home className="w-3 h-3" /> Can you host?
                    </span>
                    <div className="flex flex-wrap gap-2 mt-2.5">
                      {HOST_OPTIONS.map((o) => (
                        <button
                          key={o}
                          type="button"
                          className="g-optpill"
                          data-active={canHost === o}
                          onClick={() => { hapticLight(); setCanHost(o); }}
                        >
                          {o}
                        </button>
                      ))}
                    </div>
                  </div>
                )}

                {showTravel && (
                  <div className="g-reveal">
                    <span className="g-label">Willing to travel?</span>
                    <div className="flex flex-wrap gap-2 mt-2.5">
                      {TRAVEL_OPTIONS.map((o) => (
                        <button
                          key={o}
                          type="button"
                          className="g-optpill"
                          data-active={travelWillingness === o}
                          onClick={() => { hapticLight(); setTravelWillingness(o); }}
                        >
                          {o}
                        </button>
                      ))}
                    </div>
                  </div>
                )}

                <div>
                  <span className="g-label">In your words</span>
                  <input
                    type="text"
                    value={description}
                    onChange={(e) => setDescription(e.target.value)}
                    maxLength={100}
                    placeholder="One line — what you’re actually open to"
                    className="g-field mt-2.5"
                  />
                  {suggestions.length > 0 && (
                    <div className="flex gap-1.5 overflow-x-auto no-scrollbar mt-2 pb-0.5">
                      {suggestions.map((s) => (
                        <button
                          key={s}
                          type="button"
                          onClick={() => { hapticLight(); setDescription(s); }}
                          className="shrink-0 h-8 px-3 rounded-lg text-[11px] font-medium text-zinc-400 bg-white/[0.04] border border-white/[0.07] hover:text-zinc-200 hover:border-white/15 transition-colors cursor-pointer"
                        >
                          {s}
                        </button>
                      ))}
                    </div>
                  )}
                </div>

                {safeHavens.length > 0 && (
                  <div className="flex items-center justify-between gap-3 py-3 px-3.5 rounded-[14px] bg-white/[0.03] border border-white/[0.07]">
                    <div className="min-w-0">
                      <span className="text-[13px] font-medium text-white block">Near a Safe Haven</span>
                      <span className="text-[11px] text-zinc-500 block truncate">
                        Show my signal around a vetted public venue
                      </span>
                    </div>
                    <button
                      type="button"
                      role="switch"
                      aria-checked={useSafeHaven}
                      aria-label="Show my signal near a Safe Haven"
                      className="g-toggle"
                      onClick={() => { hapticLight(); setUseSafeHaven((v) => !v); }}
                    />
                  </div>
                )}

                {useSafeHaven && safeHavens.length > 0 && (
                  <div className="g-reveal flex flex-wrap gap-2">
                    {safeHavens.slice(0, 4).map((h) => (
                      <button
                        key={h.id}
                        type="button"
                        className="g-optpill"
                        data-active={selectedHaven?.id === h.id}
                        onClick={() => { hapticLight(); setSelectedHaven(h); }}
                      >
                        {h.name}
                      </button>
                    ))}
                  </div>
                )}

                <p className="text-[11px] text-zinc-500 leading-relaxed">
                  Your position stays approximate (±300 m). The signal disappears when it expires. Precise GPS never leaves this device.
                </p>
              </div>
            )}
          </div>

          {/* Sticky footer: summary + go live */}
          <div className="g-sheet__foot">
            <div className="min-w-0 flex-1">
              <div className="text-[13px] font-medium text-white truncate">
                {intent ? optionLabel(intent) : 'Choose what you’re up for'}
              </div>
              <div className="text-[10.5px] font-mono text-zinc-500 truncate">
                {mode && intent
                  ? `${mode === 'private' ? 'Private' : 'Social'} · ${when === 'Now' ? 'Right now' : when} · ${duration} · ${userNeighborhood}`
                  : 'Two taps to go live'}
              </div>
            </div>
            <button
              type="submit"
              className="g-btn g-btn--primary min-w-[128px]"
              disabled={!mode || !intent}
            >
              {isEditing ? 'Update' : 'Go live'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
