import React, { useState, useEffect } from 'react';
import { X, ShieldCheck, Zap, Check, ChevronDown, MapPin } from 'lucide-react';
import { hapticLight, hapticSensitiveAction } from '../services/hapticService';
import { SafeHaven } from '../types';

export type EncounterIntentType = 'Meet' | 'Hookup' | 'Date' | 'Drinks' | 'Chat' | 'Group';
export type IntentWhenType = 'Now' | 'Next 2 hours' | 'Tonight';
export type IntentDurationType = '1 hr' | '2 hrs' | 'Tonight' | 'Flexible';

export interface UserActiveIntent {
  intent: EncounterIntentType;
  when: IntentWhenType;
  duration: IntentDurationType;
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
  
  // How long? (Optional)
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
        setUseSafeHaven(Boolean(existingIntent.isNearSafeHaven));
        if (existingIntent.safeHavenName) {
          const match = safeHavens.find((h) => h.name === existingIntent.safeHavenName);
          if (match) setSelectedHaven(match);
        }
      } else {
        setIntent('Hookup');
        setWhen(defaultWhen);
        setDuration('2 hrs');
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
        className="relative w-full max-w-md bg-[#0d0e14] border border-white/10 rounded-t-3xl sm:rounded-2xl p-5 sm:p-6 shadow-2xl space-y-4 max-h-[92vh] overflow-y-auto"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Mobile Pull Indicator */}
        <div className="w-12 h-1.5 bg-white/20 rounded-full mx-auto -mt-1 mb-2 sm:hidden" />

        {/* Header */}
        <div className="flex items-start justify-between pb-3 border-b border-white/[0.08]">
          <div>
            <h2
              id="set-intent-title"
              className="text-base sm:text-lg font-black tracking-tight text-white uppercase font-sans"
            >
              {isEditing ? 'CHANGE YOUR INTENT' : 'SET YOUR INTENT'}
            </h2>
            <p className="text-xs text-zinc-400 mt-0.5">
              Tell nearby people what you’re open to.
            </p>
          </div>
          <button
            onClick={onClose}
            className="w-9 h-9 rounded-xl text-zinc-400 hover:text-white flex items-center justify-center hover:bg-white/[0.06] transition-colors cursor-pointer"
            aria-label="Close"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          {/* STEP 1: What are you open to? */}
          <div className="space-y-1.5">
            <div className="flex items-center justify-between">
              <span className="text-[11px] font-bold text-zinc-400 uppercase tracking-widest font-mono">
                STEP 1 — WHAT ARE YOU OPEN TO?
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
                    className={`h-12 px-2 rounded-xl text-xs font-bold transition-all duration-150 cursor-pointer flex items-center justify-center border relative ${
                      isSelected
                        ? 'bg-[#1a1b24] text-white border-[#C9A24D] shadow-[0_0_12px_rgba(201,162,77,0.2)] font-black uppercase tracking-wide'
                        : 'bg-[#101118] text-zinc-400 border-white/[0.08] hover:text-zinc-200 hover:border-white/20'
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
          <div className="space-y-1.5 pt-2 border-t border-white/[0.06]">
            <div className="flex items-center justify-between">
              <span className="text-[11px] font-bold text-zinc-400 uppercase tracking-widest font-mono">
                WHEN?
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
                    className={`h-11 px-2 rounded-xl text-xs font-bold transition-all duration-150 cursor-pointer flex items-center justify-center gap-1.5 border ${
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

          {/* OPTIONAL: HOW LONG? */}
          <div className="space-y-1.5 pt-2 border-t border-white/[0.06]">
            <div className="flex items-center justify-between">
              <span className="text-[11px] font-bold text-zinc-400 uppercase tracking-widest font-mono">
                HOW LONG? <span className="text-[10px] text-zinc-400 font-sans font-normal">(Optional)</span>
              </span>
              <span className="text-xs text-zinc-300 font-mono">
                {duration}
              </span>
            </div>

            <div className="grid grid-cols-4 gap-1.5">
              {durationOptions.map((d) => {
                const isSelected = duration === d;
                return (
                  <button
                    key={d}
                    type="button"
                    onClick={() => handleSelectDuration(d)}
                    className={`h-9 rounded-lg text-xs font-semibold transition-all cursor-pointer border ${
                      isSelected
                        ? 'bg-[#1a1b24] text-white border-[#C9A24D]/60 font-bold'
                        : 'bg-[#101118] text-zinc-400 border-white/[0.06] hover:text-white'
                    }`}
                  >
                    {d}
                  </button>
                );
              })}
            </div>
          </div>

          {/* OPTIONAL LOCATION */}
          <div className="pt-2 border-t border-white/[0.06] space-y-2">
            <div className="flex items-center justify-between text-xs text-zinc-300">
              <div className="flex items-center gap-1.5">
                <ShieldCheck className="w-3.5 h-3.5 text-[#C9A24D]" />
                <span className="font-medium">Approximate area</span>
              </div>
              <span className="text-[11px] text-zinc-400 font-mono">Protected automatically (±300m)</span>
            </div>

            {/* Meet near a Safe Haven toggle */}
            {safeHavens.length > 0 && (
              <div className="p-2.5 bg-[#101118] border border-white/[0.06] rounded-xl flex items-center justify-between gap-2">
                <div className="flex items-center gap-2">
                  <MapPin className="w-3.5 h-3.5 text-[#C9A24D] shrink-0" />
                  <span className="text-xs text-zinc-200">Meet near a Safe Haven</span>
                </div>
                <button
                  type="button"
                  onClick={() => {
                    hapticLight();
                    setUseSafeHaven(!useSafeHaven);
                  }}
                  className={`px-3 py-1 text-xs font-bold rounded-lg transition-colors cursor-pointer border ${
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
          <div className="p-3 bg-[#13141d] border border-[#C9A24D]/35 rounded-xl space-y-1.5">
            <div className="text-[10px] font-mono uppercase tracking-widest text-zinc-400 font-bold">
              YOUR INTENT
            </div>

            <div className="flex items-baseline justify-between">
              <span className="text-lg font-black text-white font-sans uppercase tracking-wide">
                {intent}
              </span>
              <span className="text-xs font-mono font-bold text-[#C9A24D] uppercase">
                {when} · ~{duration}
              </span>
            </div>

            <div className="flex items-center gap-1.5 text-[11px] text-zinc-400 pt-0.5">
              <ShieldCheck className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
              <span>Approximate location protected</span>
            </div>
          </div>

          {/* CONFIDENT FINAL CTA: GO LIVE */}
          <div className="pt-1">
            <button
              type="submit"
              className="w-full h-12 text-sm font-black text-black bg-[#C9A24D] hover:bg-[#b58f3b] active:scale-[0.98] rounded-xl transition-all duration-150 cursor-pointer shadow-lg flex items-center justify-center gap-2 uppercase tracking-wider font-sans"
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
