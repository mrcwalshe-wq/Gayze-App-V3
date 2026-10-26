import React, { useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { Check, Compass, MapPin, MessageCircle, Navigation, ShieldCheck, X } from 'lucide-react';
import type { SafeHaven } from '../types';
import type { LatLng } from '../services/geo';
import { withDistances } from '../services/havenDistance';
import { formatDistance, distanceKm } from '../services/geo';
import { PlacePicker } from './PlacePicker';
import { hapticLight, hapticSensitiveAction } from '../services/hapticService';

interface Destination { name: string; lat: number; lng: number; note?: string }
interface JourneySheetProps {
  isOpen: boolean;
  onClose: () => void;
  peerName: string;
  safeHavens: SafeHaven[];
  userLocation: LatLng | null;
  onStart: (dest: { venueName: string; dest: LatLng; share: boolean }) => void;
}

/** "I'm on my way": choose where you are heading. GAYZE then points you there and (optionally) keeps them posted. */
export const JourneySheet: React.FC<JourneySheetProps> = ({ isOpen, onClose, peerName, safeHavens, userLocation, onStart }) => {
  const [text, setText] = useState('');
  const [dest, setDest] = useState<Destination | null>(null);
  const [share, setShare] = useState(true);
  const nearby = useMemo(() => withDistances(safeHavens, userLocation).slice(0, 3), [safeHavens, userLocation?.lat, userLocation?.lng]);

  useEffect(() => {
    if (!isOpen) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [isOpen, onClose]);

  if (!isOpen) return null;
  const km = dest && userLocation ? distanceKm(userLocation, dest) : null;

  return createPortal(
    <div className="g-plan" role="dialog" aria-modal="true" aria-label={`Head to meet ${peerName}`} onClick={onClose}>
      <form className="g-plan__sheet" onClick={(e) => e.stopPropagation()} onSubmit={(e) => {
        e.preventDefault();
        if (!dest) return;
        hapticSensitiveAction();
        onStart({ venueName: dest.name, dest: { lat: dest.lat, lng: dest.lng }, share });
        onClose();
      }}>
        <span className="g-plan__grip" aria-hidden="true" />
        <header className="g-plan__head">
          <span className="g-plan__badge g-jr__badge"><Navigation className="w-5 h-5" /></span>
          <div className="g-plan__title"><small>On my way</small><h3>Meeting {peerName}</h3></div>
          <button type="button" className="g-plan__close" onClick={onClose} aria-label="Close"><X className="w-4 h-4" /></button>
        </header>

        <div className="g-plan__body">
          <section>
            <h4><MapPin className="w-3.5 h-3.5" aria-hidden="true" />Where are you heading?</h4>
            <PlacePicker
              value={text} near={userLocation} placeholder="Search for the place"
              className="g-field g-iset__field"
              onTextChange={(t) => { setText(t); if (dest && t !== dest.name) setDest(null); }}
              onPick={(p) => { setText(p.name); setDest({ name: p.name, lat: p.lat, lng: p.lng, note: [p.address, p.area].filter(Boolean).join(', ') }); }}
            />
            {nearby.length > 0 && (
              <div className="g-jr__quick" role="group" aria-label="Verified Safe Havens near you">
                {nearby.map((h) => (
                  <button key={h.id} type="button" className={dest?.name === h.name ? 'is-on' : ''}
                    onClick={() => { hapticLight(); setText(h.name); setDest({ name: h.name, lat: h.lat, lng: h.lng, note: h.neighborhood }); }}>
                    <ShieldCheck className="w-3.5 h-3.5" aria-hidden="true" /><span>{h.name}</span>{userLocation && <small>{formatDistance(h.approxDistanceKm)}</small>}
                  </button>
                ))}
              </div>
            )}
            {dest && (
              <p className="g-plan__note g-jr__chosen"><Check className="w-3.5 h-3.5" aria-hidden="true" />
                <span><strong>{dest.name}</strong>{km != null ? ` · ${formatDistance(km)} from you` : ''}</span></p>
            )}
            {!userLocation && <p className="g-plan__note">Turn on location so GAYZE can point you the right way. You can still pick a place.</p>}
          </section>

          <section className={`g-plan__timer ${share ? 'is-on' : ''}`}>
            <div className="g-plan__timer-top">
              <span className="g-plan__timer-icon" aria-hidden="true"><MessageCircle className="w-4 h-4" /></span>
              <div>
                <strong>Keep {peerName} posted</strong>
                <p>Sends four short messages in this chat: on your way, 10 minutes away, 5 minutes away, arrived. Never your exact location.</p>
              </div>
              <button type="button" role="switch" aria-checked={share} aria-label={`Send progress messages to ${peerName}`} className="g-plan__switch" onClick={() => { hapticLight(); setShare((v) => !v); }}><i /></button>
            </div>
          </section>

          <p className="g-plan__note g-jr__fine"><Compass className="w-3.5 h-3.5" aria-hidden="true" />
            The guide works while GAYZE is open and the screen is on, so we keep it awake. If you lock your phone or leave the app, updates pause and carry on when you come back. Hold your phone flat and facing the way you walk.</p>
        </div>

        <footer className="g-plan__foot">
          <button type="submit" className="g-plan__send" disabled={!dest}><span>{dest ? 'Start' : 'Choose a place to start'}</span><Navigation className="w-4 h-4" aria-hidden="true" /></button>
        </footer>
      </form>
    </div>,
    document.body,
  );
};
