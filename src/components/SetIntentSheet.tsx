import React, { useEffect, useRef, useState } from 'react';
import {
  CalendarClock, Check, ChevronLeft, Coffee, Compass, Dices, Dumbbell, Footprints, Heart, MessageCircle, Music, Palette, Radio, ShieldCheck, Sparkles, UsersRound, UtensilsCrossed, Wine, X,
  type LucideIcon,
} from 'lucide-react';
import { hapticLight, hapticSensitiveAction } from '../services/hapticService';
import { intentStartsAt, formatLaterAt } from '../services/intentTiming';
import { loadOpenToMore, setOpenToMore } from '../services/supabaseService';
import {
  ACTIVITIES, CONNECTIONS, MAX_ACTIVITIES, activityLabel, cleanActivities, cleanConnections, legacyActivityFor,
} from '../services/intentModel';
import { sparkBurst } from './SparkBorder';
import { PlacePicker } from './PlacePicker';
import { SafeHaven, TopLevelIntentMode, UserActiveIntent } from '../types';

export { type UserActiveIntent };

interface SetIntentSheetProps {
  isOpen: boolean;
  onClose: () => void;
  onSaveIntent: (intentData: UserActiveIntent) => Promise<boolean | void> | void;
  existingIntent?: UserActiveIntent | null;
  safeHavens?: SafeHaven[];
  userNeighborhood: string;
  userLocation?: { lat: number; lng: number } | null;
  defaultWhen?: string;
  /** Kept for callers; the new model no longer starts from a Social / Private choice. */
  initialMode?: TopLevelIntentMode | null;
  /** A quick plan you host that is live. While it is, only a Later intent can be posted. */
  liveQuickPlan?: { id: string; title: string; timestamp: number } | null;
  onCancelQuickPlan?: (gatheringId: string) => void | Promise<void>;
}

const STEPS = ['Availability', 'Activity', 'Connection'] as const;
const ACTIVITY_ICON: Record<string, LucideIcon> = {
  coffee: Coffee, drinks: Wine, food: UtensilsCrossed, walks: Footprints, music: Music, fitness: Dumbbell,
  explore: Compass, culture: Palette, games: Dices, chat: MessageCircle, spontaneous: Sparkles,
};
const CONNECTION_ICON: Record<string, LucideIcon> = { new: UsersRound, friends: UsersRound, dating: Heart, see: Sparkles, social: Wine };
const pad = (n: number) => String(n).padStart(2, '0');
const toLocalInput = (ms: number) => { const d = new Date(ms); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`; };
/** Tomorrow at 19:00, a sensible starting point for "later". */
const defaultLaterValue = () => { const d = new Date(); d.setDate(d.getDate() + 1); d.setHours(19, 0, 0, 0); return toLocalInput(d.getTime()); };

/**
 * Set a live signal, in three separate choices: when you are free, what you are up for, and what you are open to.
 * "Open to more" is a private, optional setting. It is never shown to anyone and never used as a filter.
 */
export const SetIntentSheet: React.FC<SetIntentSheetProps> = ({
  isOpen, onClose, onSaveIntent, existingIntent, safeHavens = [], userNeighborhood, userLocation, defaultWhen = 'Now', liveQuickPlan, onCancelQuickPlan,
}) => {
  const [cancellingPlan, setCancellingPlan] = useState(false);
  const [step, setStep] = useState(0);
  const [when, setWhen] = useState<string>(defaultWhen);
  const [laterValue, setLaterValue] = useState<string>(() => defaultLaterValue());
  const [duration, setDuration] = useState<'1 hr' | '2 hrs' | '4+ hrs'>('2 hrs');
  const [activities, setActivities] = useState<string[]>([]);
  const [connections, setConnections] = useState<string[]>([]);
  const [openMore, setOpenMore] = useState(false);
  const [openMoreWas, setOpenMoreWas] = useState(false);
  const [description, setDescription] = useState('');
  const [showDetail, setShowDetail] = useState(false);
  const [useSafeHaven, setUseSafeHaven] = useState(false);
  const [selectedHaven, setSelectedHaven] = useState<SafeHaven | null>(safeHavens[0] ?? null);
  const [placeText, setPlaceText] = useState('');
  const [place, setPlace] = useState<{ name: string; area: string } | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [dir, setDir] = useState<'fwd' | 'back'>('fwd');
  const initialised = useRef<string | null>(null);
  const isEditing = Boolean(existingIntent);
  const later = when === 'Later';
  const tone = later ? 'social' : 'private';

  useEffect(() => {
    if (!isOpen) { initialised.current = null; return; }
    const target = existingIntent?.remoteId ?? (existingIntent ? 'local-edit' : 'new');
    if (initialised.current === target) return;
    initialised.current = target;
    setStep(0); setDir('fwd'); setErrorMessage(null); setIsSubmitting(false); setShowDetail(false);
    if (existingIntent) {
      setWhen(existingIntent.when || defaultWhen);
      setLaterValue(existingIntent.when === 'Later' ? toLocalInput(existingIntent.activatedAt) : defaultLaterValue());
      setDuration(existingIntent.duration === '1 hr' ? '1 hr' : existingIntent.duration === '4+ hrs' ? '4+ hrs' : '2 hrs');
      const have = cleanActivities(existingIntent.activities);
      setActivities(have.length ? have : legacyActivityFor(String(existingIntent.intent)));
      setConnections(cleanConnections(existingIntent.connections));
      setDescription(existingIntent.description || '');
      setUseSafeHaven(Boolean(existingIntent.isNearSafeHaven));
    } else {
      setWhen(defaultWhen); setLaterValue(defaultLaterValue()); setDuration('2 hrs');
      setActivities([]); setConnections([]); setDescription(''); setUseSafeHaven(false);
    }
    setPlace(null); setPlaceText('');
    void loadOpenToMore().then((value) => { setOpenMore(value); setOpenMoreWas(value); });
  }, [isOpen, existingIntent, defaultWhen]);

  useEffect(() => {
    if (!selectedHaven && safeHavens.length) setSelectedHaven(safeHavens.find((h) => h.name === existingIntent?.safeHavenName) ?? safeHavens[0]);
  }, [safeHavens, selectedHaven, existingIntent?.safeHavenName]);

  useEffect(() => {
    if (!isOpen) return;
    const k = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', k);
    return () => window.removeEventListener('keydown', k);
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  const toggle = (list: string[], id: string, max = 99) => (list.includes(id) ? list.filter((x) => x !== id) : list.length >= max ? list : [...list, id]);
  // Hosting a live quick plan: only a Later intent (starting 2+ hours away) can be posted.
  const blockedByPlan = Boolean(liveQuickPlan) && !later;
  const canNext = step === 0 ? !blockedByPlan : step === 1 ? activities.length > 0 : true;
  const mainLabel = activities.length ? activityLabel(activities[0]) : '';

  const go = (delta: 1 | -1) => {
    hapticLight();
    setDir(delta === 1 ? 'fwd' : 'back');
    setErrorMessage(null);
    setStep((s) => Math.max(0, Math.min(2, s + delta)));
  };

  const submit = async () => {
    if (isSubmitting || activities.length === 0 || blockedByPlan) return;
    hapticSensitiveAction();
    setIsSubmitting(true);
    setErrorMessage(null);
    const laterAt = later ? Date.parse(laterValue) : undefined;
    const earliest = Date.now() + (liveQuickPlan ? 2 * 3600_000 : 5 * 60_000);
    if (later && (!Number.isFinite(laterAt) || (laterAt as number) < earliest)) {
      setErrorMessage(liveQuickPlan ? 'While your quick plan is live, pick a time at least 2 hours from now.' : 'Pick a date and time at least 5 minutes from now.');
      setIsSubmitting(false);
      setDir('back'); setStep(0);
      return;
    }
    const durationMs = (duration === '1 hr' ? 1 : duration === '2 hrs' ? 2 : 4) * 3600 * 1000;
    const activatedAt = intentStartsAt(when, Date.now(), laterAt);
    const meetPlace = !useSafeHaven ? place : null;
    const areaText = useSafeHaven && selectedHaven
      ? `${selectedHaven.name} (Safe Haven, ${userNeighborhood})`
      : meetPlace ? `${meetPlace.name}${meetPlace.area ? ` (${meetPlace.area})` : ''}` : `${userNeighborhood} (Approximate ±300m)`;
    const picked = cleanActivities(activities);
    const data: UserActiveIntent = {
      remoteId: existingIntent?.remoteId,
      mode: 'social',
      intent: activityLabel(picked[0]),
      activities: picked,
      connections: cleanConnections(connections),
      description: description.trim() || `Up for ${picked.map(activityLabel).join(', ').toLowerCase()} in ${userNeighborhood}`,
      when,
      duration,
      travelDistance: existingIntent?.travelDistance || 'Within 2 km',
      // Practical details from older signals are carried over untouched; new signals do not publish them.
      canHost: existingIntent?.canHost,
      travelWillingness: existingIntent?.travelWillingness,
      context: 'Public',
      area: areaText,
      isNearSafeHaven: useSafeHaven,
      safeHavenName: useSafeHaven && selectedHaven ? selectedHaven.name : undefined,
      activatedAt,
      expiresAt: activatedAt + durationMs,
      isPaused: false,
    };
    try {
      const res = await onSaveIntent(data);
      if (res === false) { setErrorMessage('Could not publish your intent. Please try again.'); return; }
      if (openMore !== openMoreWas) { const ok = await setOpenToMore(openMore); if (ok) setOpenMoreWas(openMore); }
      onClose();
    } catch (err: any) {
      setErrorMessage(err?.message || 'Failed to save your intent. Please try again.');
    } finally {
      setIsSubmitting(false);
    }
  };

  const summary = `${later && Number.isFinite(Date.parse(laterValue)) ? formatLaterAt(Date.parse(laterValue)) : 'Right now'} · ${activities.length ? activities.map(activityLabel).join(', ') : 'choose what you are up for'}`;

  return (
    <div className="g-overlay flex items-end sm:items-center justify-center sm:p-4" onClick={onClose} role="dialog" aria-modal="true" aria-labelledby="signal-title">
      <div
        className={`g-sheet g-sheet--above-nav ss ss--${later ? 'later' : 'now'}`}
        onClick={(e) => e.stopPropagation()}
        onClickCapture={(e) => {
          // Every choice and button throws sparks in the signal's colour: purple within the day, gold for later.
          const el = (e.target as HTMLElement).closest('.ss-tile, .ss-opt, .ss-seg button, .ss-go, .ss-back, .ss-chip') as HTMLElement | null;
          if (el) sparkBurst(el, tone, el.classList.contains('ss-go') ? 70 : 28);
        }}
      >
        <span className="ss-haze" aria-hidden="true" />
        <div className="ss-head">
          <div>
            <span className="ss-eyebrow">{isEditing ? 'Your live intent' : 'Set an intent'} · Step {step + 1} of 3</span>
            <h2 id="signal-title" className="ss-title">{step === 0 ? 'When are you free?' : step === 1 ? 'What are you up for?' : 'What are you open to?'}</h2>
          </div>
          <button type="button" className="ss-x" onClick={onClose} aria-label="Close"><X className="w-[18px] h-[18px]" /></button>
        </div>
        <div className="ss-progress" aria-label={STEPS[step]}>{STEPS.map((s, i) => <i key={s} className={i <= step ? 'on' : ''} />)}</div>

        <div className="ss-body">
          <div key={step} className={`ss-pane ss-pane--${dir}`}>
            {step === 0 && (
              <>
                <div className="ss-grid2">
                  <button type="button" className="ss-tile ss-tile--big" aria-pressed={!later} onClick={() => { hapticLight(); setWhen('Now'); }}>
                    <span className="ss-ico"><Radio className="w-[18px] h-[18px]" /></span><span className="ss-copy"><b>Right now</b><span>Available for the next few hours</span></span>
                  </button>
                  <button type="button" className="ss-tile ss-tile--big ss-tile--amber" aria-pressed={later} onClick={() => { hapticLight(); setWhen('Later'); }}>
                    <span className="ss-ico"><CalendarClock className="w-[18px] h-[18px]" /></span><span className="ss-copy"><b>Later</b><span>Planning ahead, up to 24 hours</span></span>
                  </button>
                </div>
                {blockedByPlan && liveQuickPlan && (
                  <div className="ss-plan-lock" role="alert">
                    <strong>You have a live quick plan</strong>
                    <p>“{liveQuickPlan.title}” is open for people to join, so you can't also be Right now. End it first, or set your intent for later.</p>
                    <div>
                      <button type="button" onClick={() => { hapticLight(); setWhen('Later'); }}>Set it for later</button>
                      {onCancelQuickPlan && <button type="button" className="is-danger" disabled={cancellingPlan} onClick={async () => { hapticLight(); setCancellingPlan(true); try { await onCancelQuickPlan(liveQuickPlan.id); } finally { setCancellingPlan(false); } }}>{cancellingPlan ? 'Cancelling…' : 'Cancel the quick plan'}</button>}
                    </div>
                  </div>
                )}
                {later && (
                  <label className="ss-field">
                    <span className="ss-eyebrow">Starts</span>
                    <input type="datetime-local" value={laterValue} min={toLocalInput(Date.now() + (liveQuickPlan ? 2 * 3600_000 : 5 * 60_000))} max={toLocalInput(Date.now() + 30 * 86_400_000)} onChange={(e) => setLaterValue(e.target.value)} />
                  </label>
                )}
                <div>
                  <span className="ss-eyebrow">How long</span>
                  <div className="ss-seg" role="group" aria-label="How long">
                    {(['1 hr', '2 hrs', '4+ hrs'] as const).map((d) => (
                      <button key={d} type="button" aria-pressed={duration === d} onClick={() => { hapticLight(); setDuration(d); }}>{d}</button>
                    ))}
                  </div>
                </div>
              </>
            )}

            {step === 1 && (
              <>
                <p className="ss-sub">Choose up to {MAX_ACTIVITIES}. Change it whenever you like.</p>
                <div className="ss-grid2">
                  {ACTIVITIES.map((a) => (
                    <button key={a.id} type="button" className={`ss-tile ${later ? 'ss-tile--amber' : ''}`} aria-pressed={activities.includes(a.id)} onClick={() => { hapticLight(); setActivities((l) => toggle(l, a.id, MAX_ACTIVITIES)); }}>
                      <span className="ss-ico">{React.createElement(ACTIVITY_ICON[a.id] ?? Sparkles, { className: 'w-[18px] h-[18px]' })}</span>
                      <span className="ss-copy"><b>{a.label}</b><span>{a.hint}</span></span>
                    </button>
                  ))}
                </div>
                <button type="button" className="ss-more" aria-expanded={showDetail} onClick={() => { hapticLight(); setShowDetail((v) => !v); }}>{showDetail ? 'Hide details' : 'Add a line or a place (optional)'}</button>
                {showDetail && (
                  <div className="ss-detail">
                    <label className="ss-field">
                      <span className="ss-eyebrow">In your words</span>
                      <input type="text" value={description} maxLength={100} placeholder="One line about what you have in mind" onChange={(e) => setDescription(e.target.value)} />
                    </label>
                    {safeHavens.length > 0 && (
                      <div className="ss-switch-row">
                        <div><b>Near a Safe Haven</b><span>Meet around a vetted public venue (others still see only your area)</span></div>
                        <button type="button" role="switch" aria-checked={useSafeHaven} aria-label="Near a Safe Haven" className="ss-sw" onClick={() => { hapticLight(); setUseSafeHaven((v) => !v); setPlace(null); setPlaceText(''); }}><i /></button>
                      </div>
                    )}
                    {useSafeHaven && safeHavens.length > 0 && (
                      <div className="ss-chips">{safeHavens.slice(0, 4).map((h) => <button key={h.id} type="button" className="ss-chip" aria-pressed={selectedHaven?.id === h.id} onClick={() => { hapticLight(); setSelectedHaven(h); }}>{h.name}</button>)}</div>
                    )}
                    {!useSafeHaven && (
                      <div>
                        <span className="ss-eyebrow">Where to meet (optional)</span>
                        <PlacePicker value={placeText} near={userLocation ?? null} placeholder="Search for a bar, café or park" className="g-field g-iset__field"
                          onTextChange={(t) => { setPlaceText(t); if (place && t !== place.name) setPlace(null); }}
                          onPick={(p) => { setPlaceText(p.name); setPlace({ name: p.name, area: p.area }); }} />
                        <p className="ss-fine">{place ? 'Only you see this place. Other members see your approximate area, and you can share the place in chat once you connect.' : 'Other members only ever see your approximate area.'}</p>
                      </div>
                    )}
                  </div>
                )}
              </>
            )}

            {step === 2 && (
              <>
                <p className="ss-sub">Choose any that fit. Others see your activity and availability, plus the connections you pick here.</p>
                <div className="ss-opts">
                  {CONNECTIONS.map((c) => (
                    <button key={c.id} type="button" className="ss-opt" aria-pressed={connections.includes(c.id)} onClick={() => { hapticLight(); setConnections((l) => toggle(l, c.id)); }}>
                      <span className="ss-ico ss-ico--sm">{React.createElement(CONNECTION_ICON[c.id] ?? Sparkles, { className: 'w-4 h-4' })}</span><b>{c.label}</b><span className="ss-box"><Check className="w-3 h-3" strokeWidth={3} /></span>
                    </button>
                  ))}
                </div>
                <div className="ss-switch-row ss-switch-row--strip">
                  <div>
                    <b>Open to more</b> <span className="ss-eyebrow">Optional</span>
                    <span className="ss-fine-block">Private. Never shown on the map, on your profile or in filters. It matters only if you both have it on, and then you each get a quiet prompt, nothing more.</span>
                  </div>
                  <button type="button" role="switch" aria-checked={openMore} aria-label="Open to more" className="ss-sw" onClick={() => { hapticLight(); setOpenMore((v) => !v); }}><i /></button>
                </div>
                <p className="ss-fine"><ShieldCheck className="inline w-3.5 h-3.5 mr-1" aria-hidden="true" />Your position stays approximate (±300 m) and the signal ends when it expires. Precise GPS never leaves this device.</p>
              </>
            )}
            {errorMessage && <div className="ss-error" role="alert">{errorMessage}</div>}
          </div>
        </div>

        <div className="ss-foot">
          <p className="ss-summary">{summary}</p>
          <div className="ss-actions">
            {step > 0 && <button type="button" className="ss-back" onClick={() => go(-1)} aria-label="Back"><ChevronLeft className="w-5 h-5" /></button>}
            {step < 2 ? (
              <button type="button" className="ss-go" disabled={!canNext} onClick={() => go(1)}>Next</button>
            ) : (
              <button type="button" className="ss-go" disabled={isSubmitting || activities.length === 0} onClick={() => void submit()}>{isSubmitting ? 'Publishing…' : isEditing ? 'Update signal' : 'Go live'}</button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};
