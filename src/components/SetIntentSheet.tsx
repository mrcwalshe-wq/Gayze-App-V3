import React, { useState, useEffect } from 'react';
import { X, ShieldCheck, Zap, Check, MapPin } from 'lucide-react';
import { hapticLight, hapticSensitiveAction } from '../services/hapticService';
import { SafeHaven } from '../types';

export type EncounterIntentType = 'Meet' | 'Hookup' | 'Date' | 'Drinks' | 'Chat' | 'Group';
export type IntentWhenType = 'Now' | 'Next 2 hours' | 'Tonight';
export type IntentDurationType = '1 hr' | '2 hrs' | 'Tonight' | 'Flexible';
export type IntentContextType = 'Private' | 'Public' | 'Either';

export interface UserActiveIntent {
  intent: EncounterIntentType;
  when: IntentWhenType;
  duration: IntentDurationType;
  context?: IntentContextType;
  area: string;
  isNearSafeHaven?: boolean;
  safeHavenName?: string;
  activatedAt: number;
  expiresAt: number;
}

interface SetIntentSheetProps {
  isOpen: boolean;
  onClose: () => void;
  onSaveIntent: (intentData: UserActiveIntent) => void;
  existingIntent?: UserActiveIntent | null;
  safeHavens?: SafeHaven[];
  userNeighborhood: string;
  defaultWhen?: IntentWhenType;
}

export const SetIntentSheet: React.FC<SetIntentSheetProps> = ({
  isOpen,
  onClose,
  onSaveIntent,
  existingIntent,
  safeHavens = [],
  userNeighborhood,
  defaultWhen = 'Now',
}) => {
  // Step 1: What are you open to?
  const [intent, setIntent] = useState<EncounterIntentType>(existingIntent?.intent || 'Hookup');
  
  // Step 2: When?
  const [when, setWhen] = useState<IntentWhenType>(existingIntent?.when || defaultWhen);
  
  // Step 3: Context & Duration (Optional)
  const [context, setContext] = useState<IntentContextType>(existingIntent?.context || 'Either');
  const [duration, setDuration] = useState<IntentDurationType>(existingIntent?.duration || '2 hrs');
  
  // Optional Location / Safe Haven
  const [useSafeHaven, setUseSafeHaven] = useState<boolean>(existingIntent?.isNearSafeHaven || false);
  const [selectedHaven, setSelectedHaven] = useState<SafeHaven | null>(
    safeHavens.length > 0 ? safeHavens[0] : null
  );

  useEffect(() => {
    if (isOpen) {
      if (existingIntent) {
        setIntent(existingIntent.intent);
        setWhen(existingIntent.when);
        setDuration(existingIntent.duration);
        setContext(existingIntent.context || 'Either');
        setUseSafeHaven(Boolean(existingIntent.isNearSafeHaven));
        if (existingIntent.safeHavenName) {
          const match = safeHavens.find((h) => h.name === existingIntent.safeHavenName);
          if (match) setSelectedHaven(match);
        }
      } else {
        setIntent('Hookup');
        setWhen(defaultWhen);
        setDuration('2 hrs');
        setContext('Either');
        setUseSafeHaven(false);
      }
    }
  }, [isOpen, existingIntent, defaultWhen, safeHavens]);

  if (!isOpen) return null;

  const handleSelectIntent = (val: EncounterIntentType) => {
    hapticLight();
    setIntent(val);
  };

  const handleSelectWhen = (val: IntentWhenType) => {
    hapticLight();
    setWhen(val);
    if (val === 'Now') setDuration('2 hrs');
    else if (val === 'Next 2 hours') setDuration('2 hrs');
    else if (val === 'Tonight') setDuration('Tonight');
  };

  const handleSelectDuration = (val: IntentDurationType) => {
    hapticLight();
    setDuration(val);
  };

  const handleSelectContext = (val: IntentContextType) => {
    hapticLight();
    setContext(val);
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
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

    onSaveIntent({
      intent,
      when,
      duration,
      context,
      area: areaText,
      isNearSafeHaven: useSafeHaven,
      safeHavenName: useSafeHaven && selectedHaven ? selectedHaven.name : undefined,
      activatedAt,
      expiresAt,
    });

    onClose();
  };

  const intentOptions: EncounterIntentType[] = [
    'Meet',
    'Hookup',
    'Date',
    'Drinks',
    'Chat',
    'Group',
  ];

  const whenOptions: IntentWhenType[] = [
    'Now',
    'Next 2 hours',
    'Tonight',
  ];

  const durationOptions: IntentDurationType[] = [
    '1 hr',
    '2 hrs',
    'Tonight',
    'Flexible',
  ];

  const contextOptions: IntentContextType[] = [
    'Private',
    'Public',
    'Either',
  ];

  const isEditing = Boolean(existingIntent);

  return (
    <div
      className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-0 sm:p-4 bg-black/85 backdrop-blur-sm animate-in fade-in duration-200"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-labelledby="set-intent-title"
    >
      <div
        className="relative w-full max-w-md bg-[#0d0e14] border border-white/10 rounded-t-3xl sm:rounded-2xl shadow-2xl flex flex-col max-h-[90dvh] sm:max-h-[85vh] overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Mobile Pull Handle Indicator */}
        <div className="w-12 h-1.5 bg-white/20 rounded-full mx-auto mt-2.5 mb-1 sm:hidden shrink-0" />

        {/* Pinned Header */}
        <div className="flex items-center justify-between px-5 pt-3 pb-3 border-b border-white/[0.08] shrink-0 bg-[#0d0e14]">
          <div>
            <h2
              id="set-intent-title"
              className="text-base sm:text-lg font-black tracking-tight text-white uppercase font-sans"
            >
              {isEditing ? 'CHANGE YOUR INTENT' : 'SET YOUR INTENT'}
            </h2>
            <p className="text-[11px] text-zinc-400">
              Real intent. Real time.
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="w-11 h-11 rounded-xl text-zinc-400 hover:text-white flex items-center justify-center hover:bg-white/[0.06] transition-colors cursor-pointer shrink-0"
            aria-label="Close"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Scrollable Form Content */}
        <form onSubmit={handleSubmit} className="flex-1 flex flex-col overflow-hidden">
          <div className="flex-1 overflow-y-auto overscroll-contain px-5 py-4 space-y-4">
            {/* STEP 1: What are you open to? */}
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <span className="text-[11px] font-bold text-zinc-400 uppercase tracking-widest font-mono">
                  STEP 1 — WHAT?
                </span>
                <span className="text-xs font-bold text-[#C9A24D] uppercase font-mono">
                  {intent}
                </span>
              </div>

              <div className="grid grid-cols-3 gap-2">
                {intentOptions.map((opt) => {
                  const isSelected = intent === opt;
                  return (
                    <button
                      key={opt}
                      type="button"
                      onClick={() => handleSelectIntent(opt)}
                      className={`h-12 min-h-[48px] px-2 rounded-xl text-xs font-bold transition-all duration-150 cursor-pointer flex items-center justify-center border relative ${
                        isSelected
                          ? 'bg-[#181524] text-[#C9A24D] border-[#C9A24D] shadow-[0_0_12px_rgba(201,162,77,0.25)] font-black uppercase tracking-wide scale-[1.02]'
                          : 'bg-[#101118] text-zinc-300 border-white/[0.08] hover:text-white hover:border-white/20'
                      }`}
                    >
                      <span>{opt}</span>
                      {isSelected && (
                        <span className="absolute top-1.5 right-1.5 w-1.5 h-1.5 rounded-full bg-[#C9A24D]" />
                      )}
                    </button>
                  );
                })}
              </div>
            </div>

            {/* STEP 2: WHEN? */}
            <div className="space-y-2 pt-2 border-t border-white/[0.06]">
              <div className="flex items-center justify-between">
                <span className="text-[11px] font-bold text-zinc-400 uppercase tracking-widest font-mono">
                  STEP 2 — WHEN?
                </span>
                <span className="text-xs text-zinc-300 font-mono">
                  {when}
                </span>
              </div>

              <div className="grid grid-cols-3 gap-2">
                {whenOptions.map((w) => {
                  const isSelected = when === w;
                  return (
                    <button
                      key={w}
                      type="button"
                      onClick={() => handleSelectWhen(w)}
                      className={`h-11 min-h-[44px] px-2 rounded-xl text-xs font-bold transition-all duration-150 cursor-pointer flex items-center justify-center gap-1 border ${
                        isSelected
                          ? 'bg-[#1a1b24] text-[#C9A24D] border-[#C9A24D]/70 shadow-sm'
                          : 'bg-[#101118] text-zinc-400 border-white/[0.08] hover:text-zinc-200'
                      }`}
                    >
                      <span>{w}</span>
                      {isSelected && <Check className="w-3.5 h-3.5 text-[#C9A24D]" />}
                    </button>
                  );
                })}
              </div>
            </div>

            {/* STEP 3: OPTIONAL CONTEXT & DURATION */}
            <div className="space-y-3 pt-2 border-t border-white/[0.06]">
              <div className="flex items-center justify-between">
                <span className="text-[11px] font-bold text-zinc-400 uppercase tracking-widest font-mono">
                  STEP 3 — OPTIONAL CONTEXT
                </span>
                <span className="text-[10px] text-zinc-400 font-mono">
                  (Optional)
                </span>
              </div>

              {/* Open to: Private / Public / Either */}
              <div className="space-y-1.5">
                <span className="text-[10px] text-zinc-400 uppercase tracking-wider font-mono">
                  Open to:
                </span>
                <div className="grid grid-cols-3 gap-2">
                  {contextOptions.map((c) => {
                    const isSelected = context === c;
                    return (
                      <button
                        key={c}
                        type="button"
                        onClick={() => handleSelectContext(c)}
                        className={`h-10 min-h-[40px] rounded-xl text-xs font-semibold transition-all cursor-pointer border ${
                          isSelected
                            ? 'bg-[#181a24] text-[#C9A24D] border-[#C9A24D]/60 font-bold'
                            : 'bg-[#101118] text-zinc-400 border-white/[0.06] hover:text-white'
                        }`}
                      >
                        {c}
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* Duration: 1 hr / 2 hrs / Tonight / Flexible */}
              <div className="space-y-1.5">
                <span className="text-[10px] text-zinc-400 uppercase tracking-wider font-mono">
                  Duration:
                </span>
                <div className="grid grid-cols-4 gap-1.5">
                  {durationOptions.map((d) => {
                    const isSelected = duration === d;
                    return (
                      <button
                        key={d}
                        type="button"
                        onClick={() => handleSelectDuration(d)}
                        className={`h-9 min-h-[38px] rounded-lg text-xs font-semibold transition-all cursor-pointer border ${
                          isSelected
                            ? 'bg-[#181a24] text-white border-[#C9A24D]/60 font-bold'
                            : 'bg-[#101118] text-zinc-400 border-white/[0.06] hover:text-white'
                        }`}
                      >
                        {d}
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* Safe Haven Meetup spot toggle */}
              {safeHavens.length > 0 && (
                <div className="p-2.5 bg-[#101118] border border-white/[0.06] rounded-xl flex items-center justify-between gap-2">
                  <div className="flex items-center gap-2 min-w-0">
                    <MapPin className="w-3.5 h-3.5 text-[#C9A24D] shrink-0" />
                    <span className="text-xs text-zinc-300 truncate">Meet near Safe Haven</span>
                  </div>
                  <button
                    type="button"
                    onClick={() => {
                      hapticLight();
                      setUseSafeHaven(!useSafeHaven);
                    }}
                    className={`h-8 px-3 text-xs font-bold rounded-lg transition-colors cursor-pointer border shrink-0 ${
                      useSafeHaven
                        ? 'bg-[#C9A24D] text-black border-[#C9A24D]'
                        : 'bg-transparent text-zinc-400 border-white/10 hover:text-white'
                    }`}
                  >
                    {useSafeHaven ? 'Selected' : 'Select'}
                  </button>
                </div>
              )}
            </div>

            {/* FINAL COMPACT PREVIEW */}
            <div className="p-3 bg-[#13141d] border border-[#C9A24D]/35 rounded-xl space-y-1">
              <div className="text-[10px] font-mono uppercase tracking-widest text-zinc-400 font-bold">
                YOUR INTENT
              </div>

              <div className="flex items-baseline justify-between">
                <span className="text-base sm:text-lg font-black text-white font-sans uppercase tracking-wide">
                  {intent}
                </span>
                <span className="text-xs font-mono font-bold text-[#C9A24D] uppercase">
                  {when} · ~{duration}
                </span>
              </div>

              <div className="flex items-center gap-1.5 text-[11px] text-zinc-400 pt-0.5">
                <ShieldCheck className="w-3.5 h-3.5 text-[#C9A24D] shrink-0" />
                <span>Approximate location protected (±300m)</span>
              </div>
            </div>
          </div>

          {/* PINNED BOTTOM CTA WITH SAFE-AREA INSET SUPPORT */}
          <div className="p-4 sm:p-5 pt-3 border-t border-white/[0.08] bg-[#0d0e14] shrink-0 pb-[max(1rem,env(safe-area-inset-bottom,16px))]">
            <button
              type="submit"
              className="w-full h-12 min-h-[48px] text-sm font-black text-black bg-[#C9A24D] hover:bg-[#b58f3b] active:scale-[0.98] rounded-xl transition-all duration-150 cursor-pointer shadow-lg flex items-center justify-center gap-2 uppercase tracking-wider font-sans"
            >
              <Zap className="w-4 h-4 fill-black" />
              <span>{isEditing ? 'Update Intent' : 'GO LIVE'}</span>
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
