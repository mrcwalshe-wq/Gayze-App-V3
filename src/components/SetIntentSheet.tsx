import React, { useState, useEffect } from 'react';
import { 
  X, 
  ShieldCheck, 
  Zap, 
  Check, 
  MapPin, 
  Sparkles, 
  Car, 
  Home, 
  Compass, 
  Clock, 
  Navigation,
  ArrowRight,
  Lock,
  MessageSquare
} from 'lucide-react';
import { hapticLight, hapticSensitiveAction } from '../services/hapticService';
import { 
  SafeHaven, 
  TopLevelIntentMode, 
  EncounterIntent, 
  SocialIntent, 
  PrivateIntent,
  SOCIAL_INTENTS, 
  PRIVATE_INTENTS, 
  UserActiveIntent 
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

// Available intents excluding 'All' for composer
const COMPOSER_SOCIAL_INTENTS: SocialIntent[] = [
  'Meet',
  'Drinks',
  'Date',
  'Chat',
  'Group',
];

const COMPOSER_PRIVATE_INTENTS: PrivateIntent[] = [
  'Hookup',
  'Hookup · Host',
  'Hookup · Travel',
  'Hookup · Outdoor',
  'Hookup · Car',
  'Other',
];

const QUICK_SUGGESTIONS: Record<string, string[]> = {
  Meet: [
    'Quick coffee & friendly conversation',
    'Open to meeting someone grounded nearby',
    'Casual stroll and exploring the area',
  ],
  Drinks: [
    'Grabbing a relaxed drink and seeing where it goes',
    'Low-key wine/cocktail after work',
    'Quiet terrace drink nearby',
  ],
  Date: [
    'Dinner or gallery visit together',
    'Nice evening out with mutual chemistry',
    'Low-pressure date and good conversation',
  ],
  Chat: [
    'Good conversation over tea or coffee',
    'Deep discussions, open to making friends',
    'Walking chat around the neighborhood',
  ],
  Group: [
    'Bouldering / gym partner session',
    'Heading to an exhibition or park meetup',
    'Looking for group activities tonight',
  ],
  Hookup: [
    'Spontaneous discreet encounter with chemistry',
    'Mutual vibes, respectful and clean',
    'Low-key connection tonight',
  ],
  'Hookup · Host': [
    'Clean private flat setup, drinks chilled',
    'Hosting in Seven Dials / Soho, discreet',
    'Low-key hosting available right now',
  ],
  'Hookup · Travel': [
    'Mobile and happy to travel to your place',
    'Can come to you within Central London',
    'Discreet travel nearby',
  ],
  'Hookup · Outdoor': [
    'Discreet evening stroll in quiet secluded area',
    'Night walk under the stars, low-key',
    'Private secluded encounter outdoors',
  ],
  'Hookup · Car': [
    'Discreet car meetup in comfortable vehicle',
    'Cruising around Central London tonight',
    'Private car encounter, respectful & safe',
  ],
  Other: [
    'Discreet connection with clear boundaries',
    'Open to specific vibe, message to connect',
    'Unique chemistry, respectful communication',
  ],
};

export const SetIntentSheet: React.FC<SetIntentSheetProps> = ({
  isOpen,
  onClose,
  onSaveIntent,
  existingIntent,
  safeHavens = [],
  userNeighborhood,
  defaultWhen = 'Now',
}) => {
  // Step 1: Mode (Social vs Private)
  const [mode, setMode] = useState<TopLevelIntentMode | null>(existingIntent?.mode || null);

  // Step 2: Specific Intent
  const [intent, setIntent] = useState<EncounterIntent | null>(existingIntent?.intent || null);

  // Step 3: Contextual Details
  const [description, setDescription] = useState<string>(existingIntent?.description || '');
  const [when, setWhen] = useState<string>(existingIntent?.when || defaultWhen);
  const [duration, setDuration] = useState<string>(existingIntent?.duration || '2 hrs');
  const [travelDistance, setTravelDistance] = useState<string>(
    existingIntent?.travelDistance || 'Within 2 km'
  );

  // Context-specific fields
  const [canHost, setCanHost] = useState<'Can host' | 'Cannot host' | 'Depends'>(
    existingIntent?.canHost || 'Can host'
  );
  const [travelWillingness, setTravelWillingness] = useState<'Yes' | 'Within reason' | 'Car required'>(
    existingIntent?.travelWillingness || 'Yes'
  );

  // Safe Haven / Location Cloaking
  const [useSafeHaven, setUseSafeHaven] = useState<boolean>(Boolean(existingIntent?.isNearSafeHaven));
  const [selectedHaven, setSelectedHaven] = useState<SafeHaven | null>(
    safeHavens.length > 0 ? safeHavens[0] : null
  );

  const isEditing = Boolean(existingIntent);

  // Sync state when opened
  useEffect(() => {
    if (isOpen) {
      if (existingIntent) {
        setMode(existingIntent.mode);
        setIntent(existingIntent.intent);
        setDescription(existingIntent.description || '');
        setWhen(existingIntent.when || defaultWhen);
        setDuration(existingIntent.duration || '2 hrs');
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
    }
  }, [isOpen, existingIntent, defaultWhen, safeHavens]);

  if (!isOpen) return null;

  const handleSelectMode = (selectedMode: TopLevelIntentMode) => {
    hapticLight();
    setMode(selectedMode);
    // If switching mode, reset intent unless it matches the mode
    if (selectedMode === 'social' && intent && !COMPOSER_SOCIAL_INTENTS.includes(intent as SocialIntent)) {
      setIntent(null);
    } else if (selectedMode === 'private' && intent && !COMPOSER_PRIVATE_INTENTS.includes(intent as PrivateIntent)) {
      setIntent(null);
    }
  };

  const handleSelectIntent = (selectedIntent: EncounterIntent) => {
    hapticLight();
    setIntent(selectedIntent);
    // Set a sensible default description if empty
    if (!description && QUICK_SUGGESTIONS[selectedIntent]?.[0]) {
      setDescription(QUICK_SUGGESTIONS[selectedIntent][0]);
    }
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!mode || !intent) return;

    hapticSensitiveAction();

    let durationMs = 2 * 3600 * 1000;
    if (duration === '1 hr') durationMs = 1 * 3600 * 1000;
    else if (duration === '2 hrs') durationMs = 2 * 3600 * 1000;
    else if (duration === 'Tonight') durationMs = 4 * 3600 * 1000;
    else if (duration === 'Flexible') durationMs = 6 * 3600 * 1000;

    const activatedAt = Date.now();
    const expiresAt = activatedAt + durationMs;

    const areaText = useSafeHaven && selectedHaven
      ? `${selectedHaven.name} (Safe Haven, ${userNeighborhood})`
      : `${userNeighborhood} (Approximate ±300m)`;

    const activeData: UserActiveIntent = {
      mode,
      intent,
      description: description.trim() || `Available for ${intent} in ${userNeighborhood}`,
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

  const whenOptions = ['Now', 'Next 1 hour', 'Next 2 hours', 'Tonight'];
  const durationOptions = ['1 hr', '2 hrs', 'Tonight', 'Flexible'];
  const distanceOptions = ['Walking distance', 'Within 2 km', 'Within 5 km', 'Willing to travel'];

  const isPrivateMode = mode === 'private';

  return (
    <div
      className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-0 sm:p-4 bg-black/85 backdrop-blur-md animate-in fade-in duration-200"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-labelledby="set-intent-title"
    >
      <div
        className="relative w-full max-w-lg bg-[#0c0d13] border border-white/10 rounded-t-3xl sm:rounded-2xl shadow-2xl flex flex-col max-h-[92dvh] sm:max-h-[88vh] overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Mobile Pull Handle Indicator */}
        <div className="w-12 h-1.5 bg-white/20 rounded-full mx-auto mt-2.5 mb-1 sm:hidden shrink-0" />

        {/* Header */}
        <div className="flex items-center justify-between px-5 pt-3 pb-3 border-b border-white/[0.08] shrink-0 bg-[#0c0d13]">
          <div>
            <div className="flex items-center gap-2">
              <span className="w-2 h-2 rounded-full bg-[#C9A24D] animate-pulse" />
              <h2
                id="set-intent-title"
                className="text-base sm:text-lg font-black tracking-tight text-white uppercase font-sans"
              >
                {isEditing ? 'EDIT RIGHT NOW INTENT' : 'SET MY RIGHT NOW INTENT'}
              </h2>
            </div>
            <p className="text-[11px] text-zinc-400 mt-0.5">
              What are you offering or available for right now?
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="w-10 h-10 min-h-[44px] min-w-[44px] rounded-xl text-zinc-400 hover:text-white flex items-center justify-center hover:bg-white/[0.06] transition-colors cursor-pointer shrink-0"
            aria-label="Close"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Scrollable Progressive Disclosure Form */}
        <form onSubmit={handleSubmit} className="flex-1 flex flex-col overflow-hidden">
          <div className="flex-1 overflow-y-auto overscroll-contain px-5 py-4 space-y-5">
            {/* =========================================================================
                STEP 1 — MODE: What are you looking for?
                Two primary modes: SOCIAL vs PRIVATE
               ========================================================================= */}
            <div className="space-y-2.5">
              <div className="flex items-center justify-between">
                <span className="text-[11px] font-bold text-zinc-400 uppercase tracking-widest font-mono">
                  STEP 1 — DISCOVERY CONTEXT
                </span>
                {mode && (
                  <span
                    className={`text-xs font-mono font-bold uppercase ${
                      mode === 'social' ? 'text-[#C9A24D]' : 'text-purple-400'
                    }`}
                  >
                    ✓ {mode}
                  </span>
                )}
              </div>

              <div className="grid grid-cols-2 gap-2.5">
                {/* Social Button */}
                <button
                  type="button"
                  onClick={() => handleSelectMode('social')}
                  className={`h-14 min-h-[56px] rounded-2xl p-3 flex items-center justify-between border transition-all cursor-pointer relative ${
                    mode === 'social'
                      ? 'bg-gradient-to-r from-[#C9A24D]/25 via-[#2a2215] to-[#14151e] border-[#C9A24D] shadow-[0_0_18px_rgba(201,162,77,0.3)] ring-1 ring-[#C9A24D]/40'
                      : 'bg-[#101118] border-white/[0.08] hover:border-white/20 text-zinc-300 hover:text-white'
                  }`}
                >
                  <div className="flex items-center gap-2.5">
                    <span className="w-2.5 h-2.5 rounded-full bg-[#C9A24D]" />
                    <div className="text-left">
                      <div className="text-xs sm:text-sm font-black uppercase tracking-wider text-white">
                        SOCIAL
                      </div>
                      <div className="text-[10px] text-zinc-400">Drinks, dates, friends</div>
                    </div>
                  </div>
                  {mode === 'social' && (
                    <Check className="w-4 h-4 text-[#C9A24D] shrink-0" />
                  )}
                </button>

                {/* Private Button */}
                <button
                  type="button"
                  onClick={() => handleSelectMode('private')}
                  className={`h-14 min-h-[56px] rounded-2xl p-3 flex items-center justify-between border transition-all cursor-pointer relative ${
                    mode === 'private'
                      ? 'bg-gradient-to-r from-[#6F3CC3]/35 via-[#231735] to-[#12111c] border-purple-500 shadow-[0_0_18px_rgba(111,60,195,0.4)] ring-1 ring-purple-500/40'
                      : 'bg-[#101118] border-white/[0.08] hover:border-white/20 text-zinc-300 hover:text-white'
                  }`}
                >
                  <div className="flex items-center gap-2.5">
                    <span className="w-2.5 h-2.5 rounded-full bg-purple-500" />
                    <div className="text-left">
                      <div className="text-xs sm:text-sm font-black uppercase tracking-wider text-white">
                        PRIVATE
                      </div>
                      <div className="text-[10px] text-zinc-400">Discreet & encounters</div>
                    </div>
                  </div>
                  {mode === 'private' && (
                    <Check className="w-4 h-4 text-purple-400 shrink-0" />
                  )}
                </button>
              </div>
            </div>

            {/* =========================================================================
                STEP 2 — INTENT: Select specific intent based on chosen mode
                Dynamically revealed when mode is selected
               ========================================================================= */}
            {mode && (
              <div className="space-y-2.5 pt-3 border-t border-white/[0.08] animate-in fade-in slide-in-from-top-2 duration-200">
                <div className="flex items-center justify-between">
                  <span className="text-[11px] font-bold text-zinc-400 uppercase tracking-widest font-mono">
                    STEP 2 — SPECIFIC INTENT
                  </span>
                  {intent && (
                    <span
                      className={`text-xs font-mono font-bold uppercase ${
                        isPrivateMode ? 'text-purple-400' : 'text-[#C9A24D]'
                      }`}
                    >
                      {intent}
                    </span>
                  )}
                </div>

                <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                  {(mode === 'social' ? COMPOSER_SOCIAL_INTENTS : COMPOSER_PRIVATE_INTENTS).map(
                    (opt) => {
                      const isSelected = intent === opt;
                      return (
                        <button
                          key={opt}
                          type="button"
                          onClick={() => handleSelectIntent(opt)}
                          className={`min-h-[46px] px-3 py-2 rounded-xl text-xs font-bold transition-all duration-150 cursor-pointer flex items-center justify-between border relative ${
                            isSelected
                              ? isPrivateMode
                                ? 'bg-[#231735] text-purple-300 border-purple-500 shadow-[0_0_12px_rgba(111,60,195,0.35)] scale-[1.02]'
                                : 'bg-[#1e1910] text-[#C9A24D] border-[#C9A24D] shadow-[0_0_12px_rgba(201,162,77,0.25)] scale-[1.02]'
                              : 'bg-[#101118] text-zinc-300 border-white/[0.08] hover:text-white hover:border-white/20'
                          }`}
                        >
                          <span className="truncate">{opt}</span>
                          {isSelected && (
                            <span
                              className={`w-2 h-2 rounded-full shrink-0 ${
                                isPrivateMode ? 'bg-purple-400' : 'bg-[#C9A24D]'
                              }`}
                            />
                          )}
                        </button>
                      );
                    }
                  )}
                </div>
              </div>
            )}

            {/* =========================================================================
                STEP 3 — CONTEXTUAL DETAILS:
                Revealed dynamically once intent is selected
               ========================================================================= */}
            {mode && intent && (
              <div className="space-y-4 pt-3 border-t border-white/[0.08] animate-in fade-in slide-in-from-top-2 duration-200">
                <div className="flex items-center justify-between">
                  <span className="text-[11px] font-bold text-zinc-400 uppercase tracking-widest font-mono">
                    STEP 3 — CONTEXTUAL DETAILS
                  </span>
                  <span className="text-[10px] text-zinc-500 font-mono">
                    Tailored for {intent}
                  </span>
                </div>

                {/* 1. DESCRIPTION: Short text input with quick suggestion chips */}
                <div className="space-y-2">
                  <label className="text-[10px] font-mono text-zinc-400 uppercase tracking-wider block">
                    Short Description
                  </label>
                  <input
                    type="text"
                    value={description}
                    onChange={(e) => setDescription(e.target.value)}
                    placeholder={`e.g. ${
                      QUICK_SUGGESTIONS[intent]?.[0] || 'Explain what you are open to...'
                    }`}
                    maxLength={100}
                    className="w-full h-11 px-3.5 bg-[#101118] border border-white/10 focus:border-[#C9A24D] rounded-xl text-xs text-white placeholder-zinc-500 focus:outline-none transition-colors"
                  />

                  {/* Quick Suggestion Chips */}
                  {QUICK_SUGGESTIONS[intent] && (
                    <div className="flex items-center gap-1.5 overflow-x-auto no-scrollbar py-0.5">
                      {QUICK_SUGGESTIONS[intent].map((promptText, idx) => (
                        <button
                          key={idx}
                          type="button"
                          onClick={() => {
                            hapticLight();
                            setDescription(promptText);
                          }}
                          className="text-[10px] px-2.5 py-1 rounded-lg bg-[#141620] hover:bg-[#1a1d2e] border border-white/[0.07] text-zinc-400 hover:text-zinc-200 transition-colors shrink-0 cursor-pointer"
                        >
                          "{promptText.substring(0, 32)}..."
                        </button>
                      ))}
                    </div>
                  )}
                </div>

                {/* 2. CONTEXT-SPECIFIC QUESTIONS: Host or Travel */}
                {intent === 'Hookup · Host' && (
                  <div className="p-3 bg-[#171424] border border-purple-500/40 rounded-xl space-y-2 animate-in fade-in">
                    <div className="flex items-center gap-2 text-xs font-bold text-purple-300">
                      <Home className="w-3.5 h-3.5 text-purple-400" />
                      <span>Can you host?</span>
                    </div>
                    <div className="grid grid-cols-3 gap-2">
                      {(['Can host', 'Cannot host', 'Depends'] as const).map((opt) => {
                        const isSelected = canHost === opt;
                        return (
                          <button
                            key={opt}
                            type="button"
                            onClick={() => {
                              hapticLight();
                              setCanHost(opt);
                            }}
                            className={`h-9 min-h-[38px] rounded-lg text-xs font-semibold transition-all cursor-pointer border ${
                              isSelected
                                ? 'bg-purple-950 text-white border-purple-400 font-bold'
                                : 'bg-[#101118] text-zinc-400 border-white/[0.06] hover:text-white'
                            }`}
                          >
                            {opt}
                          </button>
                        );
                      })}
                    </div>
                  </div>
                )}

                {intent === 'Hookup · Travel' && (
                  <div className="p-3 bg-[#171424] border border-purple-500/40 rounded-xl space-y-2 animate-in fade-in">
                    <div className="flex items-center gap-2 text-xs font-bold text-purple-300">
                      <Navigation className="w-3.5 h-3.5 text-purple-400" />
                      <span>Are you willing to travel?</span>
                    </div>
                    <div className="grid grid-cols-3 gap-2">
                      {(['Yes', 'Within reason', 'Car required'] as const).map((opt) => {
                        const isSelected = travelWillingness === opt;
                        return (
                          <button
                            key={opt}
                            type="button"
                            onClick={() => {
                              hapticLight();
                              setTravelWillingness(opt);
                            }}
                            className={`h-9 min-h-[38px] rounded-lg text-xs font-semibold transition-all cursor-pointer border ${
                              isSelected
                                ? 'bg-purple-950 text-white border-purple-400 font-bold'
                                : 'bg-[#101118] text-zinc-400 border-white/[0.06] hover:text-white'
                            }`}
                          >
                            {opt}
                          </button>
                        );
                      })}
                    </div>
                  </div>
                )}

                {/* 3. AVAILABILITY / TIME: When are you available? */}
                <div className="space-y-1.5">
                  <span className="text-[10px] text-zinc-400 uppercase tracking-wider font-mono flex items-center gap-1">
                    <Clock className="w-3 h-3 text-[#C9A24D]" />
                    <span>When are you available?</span>
                  </span>
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-1.5">
                    {whenOptions.map((opt) => {
                      const isSelected = when === opt;
                      return (
                        <button
                          key={opt}
                          type="button"
                          onClick={() => {
                            hapticLight();
                            setWhen(opt);
                          }}
                          className={`h-10 min-h-[40px] px-2 rounded-xl text-xs font-semibold transition-all cursor-pointer border ${
                            isSelected
                              ? isPrivateMode
                                ? 'bg-purple-950 text-purple-200 border-purple-500 font-bold'
                                : 'bg-[#1e1910] text-[#C9A24D] border-[#C9A24D] font-bold'
                              : 'bg-[#101118] text-zinc-400 border-white/[0.06] hover:text-white'
                          }`}
                        >
                          {opt}
                        </button>
                      );
                    })}
                  </div>
                </div>

                {/* 4. DURATION / REMAINING TIME */}
                <div className="space-y-1.5">
                  <span className="text-[10px] text-zinc-400 uppercase tracking-wider font-mono">
                    Keep active for:
                  </span>
                  <div className="grid grid-cols-4 gap-1.5">
                    {durationOptions.map((opt) => {
                      const isSelected = duration === opt;
                      return (
                        <button
                          key={opt}
                          type="button"
                          onClick={() => {
                            hapticLight();
                            setDuration(opt);
                          }}
                          className={`h-9 min-h-[38px] rounded-lg text-xs font-semibold transition-all cursor-pointer border ${
                            isSelected
                              ? 'bg-[#181a24] text-white border-white/40 font-bold'
                              : 'bg-[#101118] text-zinc-400 border-white/[0.06] hover:text-white'
                          }`}
                        >
                          {opt}
                        </button>
                      );
                    })}
                  </div>
                </div>

                {/* 5. TRAVEL DISTANCE: How far are you willing to go? */}
                <div className="space-y-1.5">
                  <span className="text-[10px] text-zinc-400 uppercase tracking-wider font-mono flex items-center gap-1">
                    <Compass className="w-3 h-3 text-[#C9A24D]" />
                    <span>Travel Distance</span>
                  </span>
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-1.5">
                    {distanceOptions.map((opt) => {
                      const isSelected = travelDistance === opt;
                      return (
                        <button
                          key={opt}
                          type="button"
                          onClick={() => {
                            hapticLight();
                            setTravelDistance(opt);
                          }}
                          className={`h-10 min-h-[40px] px-1.5 rounded-xl text-[11px] font-semibold transition-all cursor-pointer border ${
                            isSelected
                              ? 'bg-[#181a24] text-white border-[#C9A24D]/60 font-bold'
                              : 'bg-[#101118] text-zinc-400 border-white/[0.06] hover:text-white'
                          }`}
                        >
                          {opt}
                        </button>
                      );
                    })}
                  </div>
                </div>

                {/* 6. LOCATION & PRIVACY CONTROLS */}
                <div className="p-3 bg-[#101118] border border-white/[0.08] rounded-xl space-y-2">
                  <div className="flex items-center justify-between text-xs">
                    <div className="flex items-center gap-1.5 text-zinc-300 font-mono">
                      <Lock className="w-3.5 h-3.5 text-[#C9A24D]" />
                      <span>Location Privacy: Cloaked ±300m</span>
                    </div>
                    <span className="text-[10px] text-zinc-500 font-mono">Exact GPS hidden</span>
                  </div>

                  <p className="text-[11px] text-zinc-400 leading-relaxed">
                    Your intent is published near {userNeighborhood}. Your exact location is never broadcast.
                  </p>

                  {/* Safe Haven toggle if available */}
                  {safeHavens.length > 0 && (
                    <div className="pt-2 border-t border-white/[0.06] flex items-center justify-between gap-2">
                      <div className="flex items-center gap-2 min-w-0">
                        <MapPin className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
                        <span className="text-xs text-zinc-300 truncate">
                          Prefer verified Safe Haven ({safeHavens[0].name})
                        </span>
                      </div>
                      <button
                        type="button"
                        onClick={() => {
                          hapticLight();
                          setUseSafeHaven(!useSafeHaven);
                        }}
                        className={`h-8 min-h-[34px] px-3 text-xs font-bold rounded-lg transition-colors cursor-pointer border shrink-0 ${
                          useSafeHaven
                            ? 'bg-emerald-500 text-black border-emerald-400'
                            : 'bg-transparent text-zinc-400 border-white/10 hover:text-white'
                        }`}
                      >
                        {useSafeHaven ? 'Selected' : 'Select'}
                      </button>
                    </div>
                  )}
                </div>

                {/* SUMMARY INTENT CARD PREVIEW */}
                <div
                  className={`p-3.5 rounded-2xl border space-y-1.5 transition-colors ${
                    isPrivateMode
                      ? 'bg-[#151120] border-purple-500/50 shadow-[0_0_20px_rgba(111,60,195,0.25)]'
                      : 'bg-[#181510] border-[#C9A24D]/50 shadow-[0_0_20px_rgba(201,162,77,0.2)]'
                  }`}
                >
                  <div className="flex items-center justify-between text-[10px] font-mono uppercase tracking-widest font-bold text-zinc-400">
                    <span>MY RIGHT NOW INTENT</span>
                    <span className={isPrivateMode ? 'text-purple-400' : 'text-[#C9A24D]'}>
                      {mode} mode
                    </span>
                  </div>

                  <div className="flex items-baseline justify-between gap-2">
                    <span className="text-base sm:text-lg font-black text-white uppercase font-sans tracking-wide truncate">
                      {mode.toUpperCase()} · {intent}
                    </span>
                    <span className="text-xs font-mono font-bold text-zinc-300 shrink-0">
                      {when} · ~{duration}
                    </span>
                  </div>

                  {description && (
                    <p className="text-xs text-zinc-300 italic line-clamp-2">
                      "{description}"
                    </p>
                  )}

                  <div className="flex items-center justify-between text-[10px] text-zinc-400 font-mono pt-1">
                    <span>Range: {travelDistance}</span>
                    {intent === 'Hookup · Host' && <span className="text-purple-300">{canHost}</span>}
                    {intent === 'Hookup · Travel' && (
                      <span className="text-purple-300">Travel: {travelWillingness}</span>
                    )}
                  </div>
                </div>
              </div>
            )}
          </div>

          {/* PINNED BOTTOM SUBMIT CTA */}
          <div className="p-4 sm:p-5 pt-3 border-t border-white/[0.08] bg-[#0c0d13] shrink-0 pb-[max(1rem,env(safe-area-inset-bottom,16px))]">
            <button
              type="submit"
              disabled={!mode || !intent}
              className={`w-full h-12 min-h-[48px] text-xs sm:text-sm font-black rounded-xl transition-all duration-150 cursor-pointer shadow-lg flex items-center justify-center gap-2 uppercase tracking-wider font-sans ${
                !mode || !intent
                  ? 'bg-zinc-800 text-zinc-500 cursor-not-allowed border border-white/5'
                  : isPrivateMode
                  ? 'bg-purple-600 hover:bg-purple-500 active:scale-[0.98] text-white shadow-purple-900/40'
                  : 'bg-[#C9A24D] hover:bg-[#b58f3b] active:scale-[0.98] text-black shadow-amber-900/30'
              }`}
            >
              <Zap className={`w-4 h-4 ${!mode || !intent ? 'fill-zinc-500' : isPrivateMode ? 'fill-white' : 'fill-black'}`} />
              <span>
                {isEditing
                  ? 'Update Right Now Intent'
                  : mode && intent
                  ? `Publish ${mode.toUpperCase()} · ${intent} to Map`
                  : 'Select Intent to Publish'}
              </span>
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
