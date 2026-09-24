import React, { useState, useEffect } from 'react';
import { X, ShieldCheck, Zap, Clock, MapPin, Eye, Check, ChevronRight } from 'lucide-react';
import { hapticLight, hapticSensitiveAction } from '../services/hapticService';
import { SafeHaven } from '../types';

export type EncounterIntentType = 'Meet' | 'Hookup' | 'Date' | 'Drinks' | 'Chat' | 'Group' | 'Explore';
export type IntentWhenType = 'Now' | 'Next 2 hours' | 'Tonight' | 'Tomorrow' | 'Choose time';
export type IntentOpenToType = 'Private' | 'Public' | 'Either';
export type IntentDurationType = '1 hr' | '2 hrs' | 'Tonight' | 'Flexible';

export interface UserActiveIntent {
  intent: EncounterIntentType;
  when: IntentWhenType;
  openTo: IntentOpenToType;
  duration: IntentDurationType;
  area: string;
  note?: string;
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
}

export const SetIntentSheet: React.FC<SetIntentSheetProps> = ({
  isOpen,
  onClose,
  onSaveIntent,
  existingIntent,
  safeHavens = [],
  userNeighborhood,
}) => {
  // Step 1: WHAT?
  const [intent, setIntent] = useState<EncounterIntentType>(existingIntent?.intent || 'Hookup');
  // Step 2: WHEN?
  const [when, setWhen] = useState<IntentWhenType>(existingIntent?.when || 'Now');
  // Step 3: OPTIONAL CONTEXT
  const [openTo, setOpenTo] = useState<IntentOpenToType>(existingIntent?.openTo || 'Either');
  const [duration, setDuration] = useState<IntentDurationType>(existingIntent?.duration || '2 hrs');
  const [area, setArea] = useState<string>(
    existingIntent?.area || `${userNeighborhood} (Approximate ±300m)`
  );
  const [note, setNote] = useState<string>(existingIntent?.note || '');
  const [showAdvancedContext, setShowAdvancedContext] = useState<boolean>(false);

  // Sync state whenever opened or existingIntent updates
  useEffect(() => {
    if (isOpen) {
      if (existingIntent) {
        setIntent(existingIntent.intent);
        setWhen(existingIntent.when);
        setOpenTo(existingIntent.openTo);
        setDuration(existingIntent.duration);
        setArea(existingIntent.area);
        setNote(existingIntent.note || '');
      } else {
        setIntent('Hookup');
        setWhen('Now');
        setOpenTo('Either');
        setDuration('2 hrs');
        setArea(`${userNeighborhood} (Approximate ±300m)`);
        setNote('');
      }
    }
  }, [isOpen, existingIntent, userNeighborhood]);

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
    else if (val === 'Tomorrow') setDuration('Flexible');
  };

  const handleSelectOpenTo = (val: IntentOpenToType) => {
    hapticLight();
    setOpenTo(val);
  };

  const handleSelectDuration = (val: IntentDurationType) => {
    hapticLight();
    setDuration(val);
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    hapticSensitiveAction();

    // Calculate duration in milliseconds
    let durationMs = 2 * 3600 * 1000;
    if (duration === '1 hr') durationMs = 1 * 3600 * 1000;
    else if (duration === '2 hrs') durationMs = 2 * 3600 * 1000;
    else if (duration === 'Tonight') durationMs = 4 * 3600 * 1000;
    else if (duration === 'Flexible') durationMs = 6 * 3600 * 1000;

    const activatedAt = Date.now();
    const expiresAt = activatedAt + durationMs;

    onSaveIntent({
      intent,
      when,
      openTo,
      duration,
      area,
      note: note.trim() || undefined,
      activatedAt,
      expiresAt,
    });

    onClose();
  };

  const intentOptions: { id: EncounterIntentType; label: string; desc: string }[] = [
    { id: 'Meet', label: 'Meet', desc: 'Spontaneous meetup & social chemistry' },
    { id: 'Hookup', label: 'Hookup', desc: 'Adult consensual intimate encounter' },
    { id: 'Date', label: 'Date', desc: 'Drinks, coffee or evening dinner' },
    { id: 'Drinks', label: 'Drinks', desc: 'Cocktails, wine or casual pub stop' },
    { id: 'Chat', label: 'Chat', desc: 'Low-key conversation & connection' },
    { id: 'Group', label: 'Group', desc: 'Shared activity, nightlife or gathering' },
    { id: 'Explore', label: 'Explore', desc: 'Spontaneous neighborhood discovery' },
  ];

  const whenOptions: IntentWhenType[] = [
    'Now',
    'Next 2 hours',
    'Tonight',
    'Tomorrow',
    'Choose time',
  ];

  const isEditing = Boolean(existingIntent);

  return (
    <div
      className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-0 sm:p-4 bg-black/85 backdrop-blur-sm animate-in fade-in duration-200"
      onClick={onClose}
    >
      <div
        className="relative w-full max-w-lg bg-[#0d0e14] border border-white/10 rounded-t-3xl sm:rounded-2xl p-5 sm:p-6 shadow-2xl space-y-5 max-h-[92vh] overflow-y-auto"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Top Handle for mobile gestures */}
        <div className="w-12 h-1.5 bg-white/20 rounded-full mx-auto -mt-1 mb-2 sm:hidden" />

        {/* Header */}
        <div className="flex items-center justify-between pb-3 border-b border-white/[0.08]">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-xl bg-[#C9A24D]/15 border border-[#C9A24D]/30 flex items-center justify-center text-[#C9A24D]">
              <Zap className="w-4 h-4 fill-current" />
            </div>
            <div>
              <h2 className="text-base sm:text-lg font-black tracking-tight text-white uppercase font-sans">
                {isEditing ? 'CHANGE YOUR INTENT' : 'SET MY INTENT'}
              </h2>
              <p className="text-[11px] text-zinc-400">
                Real intent · Real time · Approximate location protected
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="w-8 h-8 rounded-xl text-zinc-400 hover:text-white flex items-center justify-center hover:bg-white/[0.06] transition-colors cursor-pointer"
            aria-label="Close sheet"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="space-y-5">
          {/* STEP 1 — WHAT? Large, easy-to-tap choices */}
          <div>
            <div className="flex items-center justify-between mb-2">
              <span className="text-[11px] font-bold text-zinc-400 uppercase tracking-widest">
                STEP 1 — WHAT DO YOU WANT?
              </span>
              <span className="text-xs font-mono font-bold text-[#C9A24D] uppercase">
                {intent}
              </span>
            </div>

            <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
              {intentOptions.map((opt) => {
                const isSelected = intent === opt.id;
                return (
                  <button
                    key={opt.id}
                    type="button"
                    onClick={() => handleSelectIntent(opt.id)}
                    className={`h-14 px-3 rounded-xl text-left transition-all duration-150 cursor-pointer flex flex-col justify-center border relative ${
                      isSelected
                        ? 'bg-[#181a24] text-white border-[#C9A24D] shadow-[0_0_12px_rgba(201,162,77,0.25)] scale-[1.02]'
                        : 'bg-[#111219] text-zinc-300 border-white/[0.07] hover:border-white/20 hover:text-white'
                    }`}
                  >
                    <div className="flex items-center justify-between">
                      <span className="text-sm font-black tracking-wide font-sans uppercase">
                        {opt.label}
                      </span>
                      {isSelected && (
                        <span className="w-2 h-2 rounded-full bg-[#C9A24D] shadow-[0_0_6px_#C9A24D]" />
                      )}
                    </div>
                    <span className="text-[10px] text-zinc-400 truncate mt-0.5">
                      {opt.desc}
                    </span>
                  </button>
                );
              })}
            </div>
          </div>

          {/* STEP 2 — WHEN? When are you available? */}
          <div>
            <div className="flex items-center justify-between mb-2">
              <span className="text-[11px] font-bold text-zinc-400 uppercase tracking-widest">
                STEP 2 — WHEN ARE YOU AVAILABLE?
              </span>
              <span className="text-xs font-mono text-zinc-300">
                {when}
              </span>
            </div>

            <div className="grid grid-cols-2 sm:grid-cols-3 gap-1.5">
              {whenOptions.map((w) => {
                const isSelected = when === w;
                return (
                  <button
                    key={w}
                    type="button"
                    onClick={() => handleSelectWhen(w)}
                    className={`h-10 px-3 rounded-xl text-xs font-bold transition-all duration-150 cursor-pointer flex items-center justify-between border ${
                      isSelected
                        ? 'bg-[#181a24] text-[#C9A24D] border-[#C9A24D]/70 shadow-sm'
                        : 'bg-[#111219] text-zinc-400 border-white/[0.07] hover:text-zinc-200'
                    }`}
                  >
                    <span>{w}</span>
                    {isSelected && <Check className="w-3.5 h-3.5 text-[#C9A24D]" />}
                  </button>
                );
              })}
            </div>
          </div>

          {/* STEP 3 — OPTIONAL CONTEXT (Foldable or minimal, never forced) */}
          <div className="pt-2 border-t border-white/[0.06] space-y-3">
            <button
              type="button"
              onClick={() => setShowAdvancedContext(!showAdvancedContext)}
              className="w-full flex items-center justify-between text-left cursor-pointer group py-1"
            >
              <div className="flex items-center gap-2">
                <span className="text-[11px] font-bold text-zinc-400 uppercase tracking-widest group-hover:text-zinc-300 transition-colors">
                  OPTIONAL CONTEXT
                </span>
                <span className="text-[10px] text-zinc-400 font-mono">
                  (open to, area, duration)
                </span>
              </div>
              <span className="text-xs font-mono text-[#C9A24D] flex items-center gap-1">
                {showAdvancedContext ? 'Collapse' : 'Customize'}
                <ChevronRight
                  className={`w-3.5 h-3.5 transition-transform duration-200 ${
                    showAdvancedContext ? 'rotate-90' : ''
                  }`}
                />
              </span>
            </button>

            {showAdvancedContext && (
              <div className="p-3 bg-[#111219] border border-white/[0.06] rounded-xl space-y-3 animate-in fade-in duration-150">
                {/* Open to: Private | Public | Either */}
                <div>
                  <label className="block text-[10px] font-bold uppercase tracking-wider text-zinc-400 mb-1.5">
                    Open to
                  </label>
                  <div className="grid grid-cols-3 gap-1.5">
                    {(['Private', 'Public', 'Either'] as IntentOpenToType[]).map((o) => (
                      <button
                        key={o}
                        type="button"
                        onClick={() => handleSelectOpenTo(o)}
                        className={`h-8 text-xs font-semibold rounded-lg border transition-all cursor-pointer ${
                          openTo === o
                            ? 'bg-[#181a24] text-white border-[#C9A24D]/60 font-bold'
                            : 'bg-[#0d0e14] text-zinc-400 border-white/[0.06] hover:text-white'
                        }`}
                      >
                        {o}
                      </button>
                    ))}
                  </div>
                </div>

                {/* Duration */}
                <div>
                  <label className="block text-[10px] font-bold uppercase tracking-wider text-zinc-400 mb-1.5">
                    Duration
                  </label>
                  <div className="grid grid-cols-4 gap-1.5">
                    {(['1 hr', '2 hrs', 'Tonight', 'Flexible'] as IntentDurationType[]).map((d) => (
                      <button
                        key={d}
                        type="button"
                        onClick={() => handleSelectDuration(d)}
                        className={`h-8 text-xs font-semibold rounded-lg border transition-all cursor-pointer ${
                          duration === d
                            ? 'bg-[#181a24] text-white border-[#C9A24D]/60 font-bold'
                            : 'bg-[#0d0e14] text-zinc-400 border-white/[0.06] hover:text-white'
                        }`}
                      >
                        {d}
                      </button>
                    ))}
                  </div>
                </div>

                {/* Area: Approximate only */}
                <div>
                  <div className="flex items-center justify-between mb-1">
                    <label className="text-[10px] font-bold uppercase tracking-wider text-zinc-400">
                      Area (Approximate only)
                    </label>
                    <span className="text-[10px] text-zinc-400 flex items-center gap-1 font-mono">
                      <ShieldCheck className="w-3 h-3 text-[#C9A24D]" />
                      Cloaked ±300m
                    </span>
                  </div>
                  <input
                    type="text"
                    value={area}
                    onChange={(e) => setArea(e.target.value)}
                    placeholder="e.g. Soho Square, Seven Dials, or My Place"
                    className="w-full bg-[#0d0e14] border border-white/10 rounded-lg px-3 py-1.5 text-xs text-white placeholder-zinc-500 focus:border-[#C9A24D] focus:outline-none"
                  />
                  {safeHavens.length > 0 && (
                    <div className="flex items-center gap-1.5 mt-1.5 overflow-x-auto no-scrollbar">
                      {safeHavens.slice(0, 3).map((haven) => (
                        <button
                          key={haven.id}
                          type="button"
                          onClick={() => {
                            hapticLight();
                            setArea(`${haven.name} (Safe Haven)`);
                          }}
                          className="px-2 py-0.5 rounded-md bg-[#141620] hover:bg-[#1a1d2c] text-[10px] text-zinc-300 border border-white/[0.07] whitespace-nowrap cursor-pointer"
                        >
                          ★ {haven.name}
                        </button>
                      ))}
                    </div>
                  )}
                </div>

                {/* Note (optional) */}
                <div>
                  <label className="block text-[10px] font-bold uppercase tracking-wider text-zinc-400 mb-1">
                    Short Note (Optional)
                  </label>
                  <input
                    type="text"
                    value={note}
                    onChange={(e) => setNote(e.target.value)}
                    placeholder="e.g. Hosting or can travel nearby · relaxed & discreet"
                    className="w-full bg-[#0d0e14] border border-white/10 rounded-lg px-3 py-1.5 text-xs text-white placeholder-zinc-500 focus:border-[#C9A24D] focus:outline-none"
                  />
                </div>
              </div>
            )}
          </div>

          {/* FINAL CONFIRMATION SUMMARY */}
          <div className="p-3.5 bg-[#141620] border border-[#C9A24D]/30 rounded-2xl space-y-2">
            <div className="flex items-center justify-between text-[11px] uppercase tracking-wider text-zinc-400 font-bold">
              <span>YOUR INTENT</span>
              <span className="text-[#C9A24D] font-mono">CONFIRMATION</span>
            </div>

            <div className="flex items-baseline justify-between">
              <span className="text-xl font-black text-white font-sans tracking-wide uppercase">
                {intent}
              </span>
              <span className="text-xs font-bold text-[#C9A24D] uppercase">
                {when}
              </span>
            </div>

            <div className="flex items-center gap-2 text-xs text-zinc-300 pt-1 border-t border-white/[0.06]">
              <span>~{duration}</span>
              <span className="text-zinc-600">·</span>
              <span className="text-zinc-300">Open to: {openTo}</span>
              <span className="text-zinc-600">·</span>
              <span className="text-zinc-400 text-[11px] truncate">
                {area}
              </span>
            </div>

            <div className="flex items-center gap-1.5 text-[10px] text-zinc-400 pt-0.5">
              <ShieldCheck className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
              <span>Zero exact GPS exposed · Ends automatically when window finishes</span>
            </div>
          </div>

          {/* Primary CTA: GO LIVE (Visually dominant, GAYZE amber) */}
          <div className="flex items-center gap-3 pt-1">
            <button
              type="button"
              onClick={onClose}
              className="h-12 px-4 text-xs font-semibold text-zinc-400 hover:text-white cursor-pointer rounded-xl transition-colors"
            >
              Cancel
            </button>

            <button
              type="submit"
              className="flex-1 h-12 px-6 text-sm font-black text-black bg-[#C9A24D] hover:bg-[#b58f3b] active:scale-[0.98] rounded-xl transition-all duration-150 cursor-pointer shadow-lg flex items-center justify-center gap-2 tracking-wide uppercase font-sans"
            >
              <Zap className="w-4 h-4 fill-black" />
              <span>{isEditing ? 'Update My Intent' : 'Go Live'}</span>
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
