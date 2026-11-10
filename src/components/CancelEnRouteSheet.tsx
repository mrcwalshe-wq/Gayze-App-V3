import React from 'react';
import { createPortal } from 'react-dom';
import { ShieldAlert, CalendarX, X } from 'lucide-react';
import { hapticLight } from '../services/hapticService';

interface Props {
  isOpen: boolean;
  peerName: string;
  venueName: string;
  onChoose: (reason: 'safety' | 'changed_plans') => void;
  onKeepGoing: () => void;
}

/** Shown only when someone cancels a meetup after they have set off for it. A safety reason is never held against them. */
export const CancelEnRouteSheet: React.FC<Props> = ({ isOpen, peerName, venueName, onChoose, onKeepGoing }) => {
  if (!isOpen) return null;
  return createPortal(
    <div className="g-plan" role="dialog" aria-modal="true" aria-label="Cancel this meetup" onClick={onKeepGoing}>
      <div className="g-plan__sheet g-cer" onClick={(e) => e.stopPropagation()}>
        <div className="g-plan__grip" aria-hidden="true" />
        <header className="g-plan__head">
          <div className="g-plan__title"><small>You have already set off</small><h3>Cancel with {peerName}?</h3></div>
          <button type="button" className="g-plan__close" aria-label="Keep going" onClick={() => { hapticLight(); onKeepGoing(); }}><X className="w-4 h-4" /></button>
        </header>
        <div className="g-cer__body">
          <p>{peerName} is expecting you at {venueName}. Tell us why, so your reliability stays fair.</p>
          <button type="button" className="g-cer__opt g-cer__opt--safe" onClick={() => { hapticLight(); onChoose('safety'); }}>
            <ShieldAlert className="w-5 h-5" aria-hidden="true" />
            <span><strong>I don’t feel safe</strong><small>Never counts against your reliability</small></span>
          </button>
          <button type="button" className="g-cer__opt" onClick={() => { hapticLight(); onChoose('changed_plans'); }}>
            <CalendarX className="w-5 h-5" aria-hidden="true" />
            <span><strong>My plans changed</strong><small>Counts as cancelled after setting off</small></span>
          </button>
          <button type="button" className="g-cer__keep" onClick={() => { hapticLight(); onKeepGoing(); }}>Keep going</button>
        </div>
      </div>
    </div>,
    document.body,
  );
};
