import React, { useEffect } from 'react';
import { createPortal } from 'react-dom';
import { Route, X } from 'lucide-react';
import type { LatLng } from '../services/geo';
import { DirectionsPanel } from './DirectionsPanel';

interface DirectionsSheetProps { isOpen: boolean; onClose: () => void; venueName: string; dest: LatLng | null; from: LatLng | null }

/** Directions to the place you are heading, opened from the guide bar while you are on your way. */
export const DirectionsSheet: React.FC<DirectionsSheetProps> = ({ isOpen, onClose, venueName, dest, from }) => {
  useEffect(() => {
    if (!isOpen) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [isOpen, onClose]);
  if (!isOpen || !dest) return null;
  return createPortal(
    <div className="g-plan" role="dialog" aria-modal="true" aria-label={`Directions to ${venueName}`} onClick={onClose}>
      <div className="g-plan__sheet" onClick={(e) => e.stopPropagation()}>
        <span className="g-plan__grip" aria-hidden="true" />
        <header className="g-plan__head">
          <span className="g-plan__badge g-jr__badge"><Route className="w-5 h-5" /></span>
          <div className="g-plan__title"><small>Directions</small><h3>{venueName}</h3></div>
          <button type="button" className="g-plan__close" onClick={onClose} aria-label="Close"><X className="w-4 h-4" /></button>
        </header>
        <div className="g-plan__body"><DirectionsPanel dest={dest} venueName={venueName} from={from} /></div>
      </div>
    </div>,
    document.body,
  );
};
