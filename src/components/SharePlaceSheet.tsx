import React, { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { MapPin, Send, X } from 'lucide-react';
import type { LatLng } from '../services/geo';
import { formatDistance, distanceKm } from '../services/geo';
import type { PlaceResult } from '../services/placeSearch';
import { PlacePicker } from './PlacePicker';
import { placeMessage } from '../services/placeMessage';
import { hapticSensitiveAction } from '../services/hapticService';

interface SharePlaceSheetProps {
  isOpen: boolean;
  onClose: () => void;
  peerName: string;
  userLocation: LatLng | null;
  /** Sends the text into the chat (end-to-end encrypted like any message). */
  onSend: (text: string) => Promise<void>;
}

export const SharePlaceSheet: React.FC<SharePlaceSheetProps> = ({ isOpen, onClose, peerName, userLocation, onSend }) => {
  const [text, setText] = useState('');
  const [place, setPlace] = useState<PlaceResult | null>(null);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!isOpen) { setText(''); setPlace(null); setError(null); return; }
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [isOpen, onClose]);

  if (!isOpen) return null;
  const km = place && userLocation ? distanceKm(userLocation, place) : null;

  return createPortal(
    <div className="g-plan" role="dialog" aria-modal="true" aria-label={`Share a place with ${peerName}`} onClick={onClose}>
      <form className="g-plan__sheet" onClick={(e) => e.stopPropagation()} onSubmit={async (e) => {
        e.preventDefault();
        if (!place || sending) return;
        hapticSensitiveAction(); setSending(true); setError(null);
        try { await onSend(placeMessage(place)); onClose(); }
        catch { setError('That did not send. Please try again.'); }
        finally { setSending(false); }
      }}>
        <span className="g-plan__grip" aria-hidden="true" />
        <header className="g-plan__head">
          <span className="g-plan__badge"><MapPin className="w-5 h-5" /></span>
          <div className="g-plan__title"><small>Share a place</small><h3>With {peerName}</h3></div>
          <button type="button" className="g-plan__close" onClick={onClose} aria-label="Close"><X className="w-4 h-4" /></button>
        </header>
        <div className="g-plan__body">
          <section>
            <PlacePicker value={text} near={userLocation} placeholder="Search for a place or address" className="g-field g-iset__field"
              onTextChange={(t) => { setText(t); if (place && t !== place.name) setPlace(null); }}
              onPick={(p) => { setText(p.name); setPlace(p); }} />
            {place && (
              <p className="g-plan__note g-jr__chosen"><MapPin className="w-3.5 h-3.5" aria-hidden="true" />
                <span><strong>{place.name}</strong>{[place.address, place.area].filter(Boolean).length ? ` · ${[place.address, place.area].filter(Boolean).join(', ')}` : ''}{km != null ? ` · ${formatDistance(km)} from you` : ''}</span></p>
            )}
            <p className="g-plan__note">This sends the place, not where you are. Your own location is never shared.</p>
            {error && <p className="g-plan__note g-plan__note--warn">{error}</p>}
          </section>
        </div>
        <footer className="g-plan__foot">
          <button type="submit" className="g-plan__send" disabled={!place || sending}><span>{sending ? 'Sending…' : place ? `Send to ${peerName}` : 'Choose a place'}</span><Send className="w-4 h-4" aria-hidden="true" /></button>
        </footer>
      </form>
    </div>,
    document.body,
  );
};
