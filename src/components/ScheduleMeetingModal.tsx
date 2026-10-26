import React, { useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { SafeHaven } from '../types';
import { ArrowRight, CalendarClock, Check, Clock, MapPin, Moon, ShieldCheck, Sun, Timer, X, Zap } from 'lucide-react';
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

const FALLBACK_HAVEN: SafeHaven = {
  id: 'default_sh', name: 'Timberyard Community Cafe', address: '7 Upper St Martin’s Ln', neighborhood: 'Seven Dials',
  safetyScore: 9.7, features: [], lat: 51.5126, lng: -0.1268, openHours: '08:00 - 20:00', approxDistanceKm: 0.3, staffTrained: true, type: 'cafe',
};

/** A meetup proposal: where, when, and an optional safety timer. A bottom sheet above the tab bar. */
export const ScheduleMeetingModal: React.FC<ScheduleMeetingModalProps> = ({ isOpen, onClose, peerName, safeHavens, userLocation, onConfirmMeeting, amend }) => {
  const havens = useMemo(() => withDistances(safeHavens.length > 0 ? safeHavens : [FALLBACK_HAVEN], userLocation), [safeHavens, userLocation?.lat, userLocation?.lng]);
  const [search, setSearch] = useState('');
  const [custom, setCustom] = useState<{ name: string; address: string; lat: number; lng: number } | null>(null);
  const [selectedId, setSelectedId] = useState<string>(havens[0].id);
  const [timeOption, setTimeOption] = useState<string>(TIMES[0].label);
  const [startLocalCheckin, setStartLocalCheckin] = useState(true);
  const [durationMinutes, setDurationMinutes] = useState(60);

  useEffect(() => {
    if (!havens.some((h) => h.id === selectedId)) setSelectedId(havens[0].id);
  }, [havens, selectedId]);

  // Changing a plan starts from what was agreed: same time and, when it is a known Safe Haven, the same place.
  useEffect(() => {
    if (!isOpen || !amend) return;
    if (TIMES.some((t) => t.label === amend.timeStr)) setTimeOption(amend.timeStr);
    const match = havens.find((h) => h.name === amend.venueName);
    if (match) { setSelectedId(match.id); setCustom(null); setSearch(''); }
  }, [isOpen, amend?.id]);   // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!isOpen) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [isOpen, onClose]);

  if (!isOpen) return null;
  const selected = havens.find((h) => h.id === selectedId) ?? havens[0];
  const venueLabel = custom ? custom.name : selected.name;

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    hapticSensitiveAction();
    onConfirmMeeting({
      venueName: venueLabel,
      address: custom ? custom.address : `${selected.address}, ${selected.neighborhood}`,
      timeStr: timeOption,
      isSafeHaven: !custom,
      lat: custom ? custom.lat : selected.lat,
      lng: custom ? custom.lng : selected.lng,
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
            <div className="g-plan__venues" role="radiogroup" aria-label="Verified Safe Havens">
              {havens.map((haven) => {
                const on = !custom && haven.id === selected.id;
                return (
                  <button key={haven.id} type="button" role="radio" aria-checked={on} className={`g-plan__venue ${on ? 'is-on' : ''}`} onClick={() => { hapticLight(); setCustom(null); setSearch(''); setSelectedId(haven.id); }}>
                    <span className="g-plan__score" aria-label={`Safety score ${haven.safetyScore}`}><b>{haven.safetyScore}</b><small>safety</small></span>
                    <span className="g-plan__venue-main">
                      <strong>{haven.name}</strong>
                      <span>{haven.neighborhood}{haven.approxDistanceKm ? ` · ${userLocation ? formatDistance(haven.approxDistanceKm) : `${haven.approxDistanceKm} km`}` : ''}</span>
                    </span>
                    <span className="g-plan__tick" aria-hidden="true">{on && <Check className="w-3.5 h-3.5" strokeWidth={3} />}</span>
                  </button>
                );
              })}
            </div>
            <p className="g-plan__note"><ShieldCheck className="w-3.5 h-3.5" aria-hidden="true" />Verified Safe Havens are public places with trained staff.</p>
            <div className="g-plan__else">
              <PlacePicker
                value={search} near={userLocation ?? null} placeholder="Or search for another place"
                className="g-field g-iset__field"
                onTextChange={(t) => { setSearch(t); if (custom && t !== custom.name) setCustom(null); }}
                onPick={(p) => { setSearch(p.name); setCustom({ name: p.name, address: [p.address, p.area].filter(Boolean).join(', ') || p.name, lat: p.lat, lng: p.lng }); }}
              />
              {custom && <p className="g-plan__note g-plan__note--warn"><MapPin className="w-3.5 h-3.5" aria-hidden="true" />Not a verified Safe Haven. Choose a public, busy place and tell a friend.</p>}
            </div>
          </section>

          <section aria-labelledby="plan-when">
            <h4 id="plan-when"><CalendarClock className="w-3.5 h-3.5" aria-hidden="true" />When</h4>
            <div className="g-plan__times" role="radiogroup" aria-label="Proposed timing">
              {TIMES.map(({ label, short, hint, Icon }) => (
                <button key={label} type="button" role="radio" aria-checked={timeOption === label} className={`g-plan__time ${timeOption === label ? 'is-on' : ''}`} onClick={() => { hapticLight(); setTimeOption(label); }}>
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
          <p><strong>{venueLabel}</strong> · {timeOption}</p>
          <button type="submit" className="g-plan__send"><span>{amend ? 'Send update' : 'Send proposal'}</span><ArrowRight className="w-4 h-4" aria-hidden="true" /></button>
        </footer>
      </form>
    </div>,
    document.body,
  );
};
