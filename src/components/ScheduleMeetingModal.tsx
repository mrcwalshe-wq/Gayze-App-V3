import React, { useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { SafeHaven } from '../types';
import { ArrowRight, CalendarClock, Check, Clock, Coffee, House, MapPin, Moon, ShieldCheck, Sun, Timer, TreePine, Wine, X, Zap } from 'lucide-react';
import { hapticLight, hapticSensitiveAction } from '../services/hapticService';
import { PlacePicker } from './PlacePicker';
import { withDistances } from '../services/havenDistance';
import { formatDistance, type LatLng } from '../services/geo';

interface ScheduleMeetingModalProps {
  isOpen: boolean;
  onClose: () => void;
  peerName: string;
  safeHavens: SafeHaven[];
  userLocation?: LatLng | null;
  onConfirmMeeting: (proposal: {
    venueName: string;
    address: string;
    timeStr: string;
    isSafeHaven: boolean;
    durationMinutes: number;
    startLocalCheckin: boolean;
    lat?: number;
    lng?: number;
  }) => void;
  /** Set when changing a plan that was already sent. */
  amend?: { id: string; venueName: string; timeStr: string } | null;
}

const TIMES = [
  { label: 'Now (~15 mins)', short: 'Now', hint: 'About 15 minutes', Icon: Zap },
  { label: 'In 1 hour', short: 'In 1 hour', hint: 'Time to get ready', Icon: Clock },
  { label: 'Tonight, 20:00', short: 'Tonight', hint: '20:00', Icon: Moon },
  { label: 'Tomorrow afternoon', short: 'Tomorrow', hint: 'Afternoon', Icon: Sun },
] as const;

/** The usual places people meet. Nothing is chosen for you: pick one, a verified Safe Haven, or search for somewhere else. */
const PLACE_KINDS = [
  { label: 'Café', Icon: Coffee }, { label: 'Bar', Icon: Wine }, { label: 'Park', Icon: TreePine }, { label: 'Home', Icon: House },
] as const;

/** A meetup proposal: where, when, and an optional safety timer. A bottom sheet above the tab bar. */
export const ScheduleMeetingModal: React.FC<ScheduleMeetingModalProps> = ({ isOpen, onClose, peerName, safeHavens, userLocation, onConfirmMeeting, amend }) => {
  const havens = useMemo(() => withDistances(safeHavens, userLocation), [safeHavens, userLocation?.lat, userLocation?.lng]);
  const [kind, setKind] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [custom, setCustom] = useState<{ name: string; address: string; lat: number; lng: number } | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [timeOption, setTimeOption] = useState<string>(TIMES[0].label);
  const [startLocalCheckin, setStartLocalCheckin] = useState(true);
  const [durationMinutes, setDurationMinutes] = useState(60);

  useEffect(() => {
    if (selectedId && !havens.some((h) => h.id === selectedId)) setSelectedId(null);
  }, [havens, selectedId]);

  // Changing a plan starts from what was agreed: same time and, when it is a known Safe Haven, the same place.
  useEffect(() => {
    if (!isOpen || !amend) return;
    if (TIMES.some((t) => t.label === amend.timeStr)) setTimeOption(amend.timeStr);
    const match = havens.find((h) => h.name === amend.venueName);
    if (match) { setSelectedId(match.id); setKind(null); setCustom(null); setSearch(''); }
    else if (PLACE_KINDS.some((k) => k.label === amend.venueName)) { setKind(amend.venueName); setSelectedId(null); setCustom(null); setSearch(''); }
  }, [isOpen, amend?.id]);   // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!isOpen) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [isOpen, onClose]);

  if (!isOpen) return null;
  const selected = custom ? null : havens.find((h) => h.id === selectedId) ?? null;
  const venueLabel = custom ? custom.name : selected ? selected.name : kind ?? '';

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!venueLabel) return;
    hapticSensitiveAction();
    onConfirmMeeting({
      venueName: venueLabel,
      address: custom ? custom.address : selected ? `${selected.address}, ${selected.neighborhood}` : '',
      timeStr: timeOption,
      isSafeHaven: Boolean(selected),
      lat: custom ? custom.lat : selected?.lat,
      lng: custom ? custom.lng : selected?.lng,
      durationMinutes,
      startLocalCheckin,
    });
    onClose();
  };

  // Portalled to <body>: the sheet must sit above the tab bar, whatever stacking context the chat is in.
  return createPortal(
    <div className="g-plan" role="dialog" aria-modal="true" aria-label={`Plan a meetup with ${peerName}`} onClick={onClose}>
      <form className="g-plan__sheet" onSubmit={handleSubmit} onClick={(e) => e.stopPropagation()}>
        <span className="g-plan__grip" aria-hidden="true" />
        <header className="g-plan__head">
          <span className="g-plan__badge" style={{ ['--h' as string]: (peerName.charCodeAt(0) * 37) % 360 }}>{peerName.charAt(0).toUpperCase()}</span>
          <div className="g-plan__title">
            <small>{amend ? 'Change the plan' : 'Plan a meetup'}</small>
            <h3>With {peerName}</h3>
          </div>
          <button type="button" className="g-plan__close" onClick={onClose} aria-label="Close"><X className="w-4 h-4" /></button>
        </header>

        <div className="g-plan__body">
          <section aria-labelledby="plan-where">
            <h4 id="plan-where"><MapPin className="w-3.5 h-3.5" aria-hidden="true" />Where</h4>
            <div className="g-plan__kinds" role="radiogroup" aria-label="Kind of place">
              {PLACE_KINDS.map(({ label, Icon }) => (
                <button key={label} type="button" role="radio" aria-checked={!custom && !selected && kind === label} className={!custom && !selected && kind === label ? 'is-on' : ''}
                  onClick={() => { hapticLight(); setKind(label); setSelectedId(null); setCustom(null); setSearch(''); }}>
                  <Icon className="w-5 h-5" aria-hidden="true" /><span>{label}</span>
                </button>
              ))}
            </div>
            {havens.length > 0 && <h5 className="g-plan__sub">Or a verified Safe Haven</h5>}
            <div className="g-plan__venues" role="radiogroup" aria-label="Verified Safe Havens">
              {havens.map((haven) => {
                const on = !custom && selected?.id === haven.id;
                return (
                  <button key={haven.id} type="button" role="radio" aria-checked={on} className={`g-plan__venue ${on ? 'is-on' : ''}`} onClick={() => { hapticLight(); setCustom(null); setSearch(''); setKind(null); setSelectedId(haven.id); }}>
                    <span className="g-plan__score" aria-label={`Safety score ${haven.safetyScore}`} style={{ ['--p' as string]: Math.max(0, Math.min(1, haven.safetyScore / 10)) }}>
                      <svg viewBox="0 0 48 48" aria-hidden="true"><circle cx="24" cy="24" r="20" className="g-plan__ring-bg" /><circle cx="24" cy="24" r="20" className="g-plan__ring" pathLength={1} /></svg>
                      <b>{haven.safetyScore}</b><small>safety</small>
                    </span>
                    <span className="g-plan__venue-main">
                      <strong>{haven.name}</strong>
                      <span>{haven.neighborhood}{haven.approxDistanceKm ? ` · ${userLocation ? formatDistance(haven.approxDistanceKm) : `${haven.approxDistanceKm} km`}` : ''}</span>
                    </span>
                    <span className="g-plan__tick" aria-hidden="true">{on && <Check className="w-3.5 h-3.5" strokeWidth={3} />}</span>
                  </button>
                );
              })}
            </div>
            {havens.length > 0 && <p className="g-plan__note"><ShieldCheck className="w-3.5 h-3.5" aria-hidden="true" />Verified Safe Havens are public places with trained staff.</p>}
            <div className="g-plan__else">
              <PlacePicker
                value={search} near={userLocation ?? null} placeholder="Or search for another place"
                className="g-field g-iset__field"
                onTextChange={(t) => { setSearch(t); if (custom && t !== custom.name) setCustom(null); }}
                onPick={(p) => { setSearch(p.name); setKind(null); setSelectedId(null); setCustom({ name: p.name, address: [p.address, p.area].filter(Boolean).join(', ') || p.name, lat: p.lat, lng: p.lng }); }}
              />
              {custom && <p className="g-plan__note g-plan__note--warn"><MapPin className="w-3.5 h-3.5" aria-hidden="true" />Not a verified Safe Haven. Choose a public, busy place and tell a friend.</p>}
            </div>
          </section>

          <section aria-labelledby="plan-when">
            <h4 id="plan-when"><CalendarClock className="w-3.5 h-3.5" aria-hidden="true" />When</h4>
            <div className="g-plan__times" role="radiogroup" aria-label="Proposed timing" data-tone={timeOption.startsWith('Tomorrow') ? 'gold' : 'purple'}>
              {TIMES.map(({ label, short, hint, Icon }) => (
                <button key={label} type="button" role="radio" aria-checked={timeOption === label} data-tone={short === 'Tomorrow' ? 'gold' : 'purple'} className={`g-plan__time ${timeOption === label ? 'is-on' : ''}`} onClick={() => { hapticLight(); setTimeOption(label); }}>
                  <Icon className="w-4 h-4" aria-hidden="true" />
                  <strong>{short}</strong>
                  <small>{hint}</small>
                </button>
              ))}
            </div>
          </section>

          <section className={`g-plan__timer ${startLocalCheckin ? 'is-on' : ''}`}>
            <div className="g-plan__timer-top">
              <span className="g-plan__timer-icon" aria-hidden="true"><Timer className="w-4 h-4" /></span>
              <div>
                <strong>Safety check-in timer</strong>
                <p>Starts on this device when you send. It does not alert anyone if you miss it.</p>
              </div>
              <button type="button" role="switch" aria-checked={startLocalCheckin} aria-label="Start a check-in timer" className="g-plan__switch" onClick={() => { hapticLight(); setStartLocalCheckin((v) => !v); }}><i /></button>
            </div>
            {startLocalCheckin && (
              <div className="g-plan__durations" role="radiogroup" aria-label="Timer length">
                {[45, 60, 90, 120].map((m) => (
                  <button key={m} type="button" role="radio" aria-checked={durationMinutes === m} className={durationMinutes === m ? 'is-on' : ''} onClick={() => { hapticLight(); setDurationMinutes(m); }}>{m}<small>min</small></button>
                ))}
              </div>
            )}
          </section>
        </div>

        <footer className="g-plan__foot">
          <p className="g-plan__sum"><span><MapPin className="w-3 h-3" aria-hidden="true" />{venueLabel || 'Choose a place'}</span><span><Clock className="w-3 h-3" aria-hidden="true" />{timeOption}</span>{startLocalCheckin && <span><Timer className="w-3 h-3" aria-hidden="true" />{durationMinutes} min</span>}</p>
          <button type="submit" className="g-plan__send" disabled={!venueLabel}><span>{amend ? 'Send update' : 'Send proposal'}</span><ArrowRight className="w-4 h-4" aria-hidden="true" /></button>
        </footer>
      </form>
    </div>,
    document.body,
  );
};
