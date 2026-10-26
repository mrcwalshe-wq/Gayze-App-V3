import React, { useState } from 'react';
import { Calendar, Check, Clock, Compass, Footprints, MapPin, Navigation, Pencil, Route, ShieldAlert, ShieldCheck, X } from 'lucide-react';
import type { MeetingProposal } from '../types';
import { distanceM, etaMinutes, formatMeters } from '../services/journey';
import { isApplePlatform, routeUrl, TRAVEL_MODES } from '../services/routeLinks';
import { hapticLight, hapticSensitiveAction } from '../services/hapticService';

export type MeetupAction = 'accept' | 'decline' | 'cancel' | 'amend' | 'setoff' | 'compass';

interface MeetupCardProps {
  meeting: MeetingProposal;
  /** False for older messages about the same meetup: they collapse to a one-line note. */
  isLatest: boolean;
  /** Whether this person made the original proposal. */
  isProposer: boolean;
  peerName: string;
  userLocation?: { lat: number; lng: number } | null;
  /** A journey for this chat is already running. */
  journeyActive: boolean;
  onAction: (action: MeetupAction, meeting: MeetingProposal) => void;
}

const STATUS = {
  proposed: { label: 'Proposed', tone: 'gold' },
  accepted: { label: 'Confirmed', tone: 'green' },
  declined: { label: 'Declined', tone: 'red' },
  cancelled: { label: 'Cancelled', tone: 'red' },
} as const;

/** The meetup as a card with everything you can do with it: answer, change, cancel, set off, compass, route. */
export const MeetupCard: React.FC<MeetupCardProps> = ({ meeting, isLatest, isProposer, peerName, userLocation, journeyActive, onAction }) => {
  const [confirmCancel, setConfirmCancel] = useState(false);
  const [routes, setRoutes] = useState(false);

  if (!isLatest) {
    return <p className="g-meet__old"><Calendar className="w-3 h-3" aria-hidden="true" />Earlier version: {meeting.venueName} · {meeting.timeStr}</p>;
  }

  const status = STATUS[meeting.status];
  const hasPos = meeting.lat !== undefined && meeting.lng !== undefined;
  const dest = hasPos ? { lat: meeting.lat!, lng: meeting.lng! } : null;
  const metres = dest && userLocation ? distanceM(userLocation, dest) : null;
  const walkMin = metres != null ? etaMinutes(metres, 1.3) : null;
  const apple = typeof navigator !== 'undefined' && isApplePlatform(navigator.userAgent, navigator.maxTouchPoints);
  const live = meeting.status === 'accepted';
  const act = (a: MeetupAction, sensitive = false) => () => { sensitive ? hapticSensitiveAction() : hapticLight(); setConfirmCancel(false); setRoutes(false); onAction(a, meeting); };

  return (
    <article className={`g-meet g-meet--${meeting.status}`} aria-label={`Meetup at ${meeting.venueName}, ${status.label}`}>
      <header className="g-meet__top">
        <span className="g-meet__eyebrow"><Calendar className="w-3.5 h-3.5" aria-hidden="true" />{meeting.isSafeHaven ? 'Safe meetup' : 'Meetup'}</span>
        <span className={`g-meet__pill g-meet__pill--${status.tone}`}>{meeting.event === 'amended' && meeting.status === 'proposed' ? 'Updated' : status.label}</span>
      </header>

      <h4 className="g-meet__venue">{meeting.venueName}</h4>
      <ul className="g-meet__facts">
        {meeting.address && <li><MapPin className="w-3.5 h-3.5" aria-hidden="true" />{meeting.address}</li>}
        <li className="g-meet__when"><Clock className="w-3.5 h-3.5" aria-hidden="true" />{meeting.timeStr}</li>
        {metres != null && live && (
          <li className="g-meet__away"><Footprints className="w-3.5 h-3.5" aria-hidden="true" />{formatMeters(metres)} from you{walkMin != null ? ` · about ${Math.max(1, Math.round(walkMin))} min on foot` : ''}</li>
        )}
      </ul>

      <p className={`g-meet__safety ${meeting.isSafeHaven ? 'is-haven' : ''}`}>
        {meeting.isSafeHaven ? <ShieldCheck className="w-3.5 h-3.5" aria-hidden="true" /> : <ShieldAlert className="w-3.5 h-3.5" aria-hidden="true" />}
        {meeting.isSafeHaven ? 'Verified Safe Haven' : 'Not a verified Safe Haven. Pick somewhere public and busy.'}
      </p>

      {meeting.status === 'proposed' && !isProposer && (
        <div className="g-meet__actions">
          <button type="button" className="g-meet__btn g-meet__btn--primary" onClick={act('accept', true)}><Check className="w-4 h-4" aria-hidden="true" />Accept</button>
          <button type="button" className="g-meet__btn" onClick={act('decline')}><X className="w-4 h-4" aria-hidden="true" />Can’t make it</button>
          <p className="g-meet__hint">Accepting starts a safety check-in timer on this device.</p>
        </div>
      )}

      {meeting.status === 'proposed' && isProposer && (
        <div className="g-meet__actions">
          <p className="g-meet__hint">Waiting for {peerName} to answer.</p>
          <button type="button" className="g-meet__btn" onClick={act('amend')}><Pencil className="w-4 h-4" aria-hidden="true" />Change plan</button>
          <button type="button" className="g-meet__btn g-meet__btn--danger" onClick={() => { hapticLight(); setConfirmCancel(true); }}>Cancel</button>
        </div>
      )}

      {live && (
        <div className="g-meet__actions">
          <button type="button" className="g-meet__btn g-meet__btn--go g-meet__btn--wide" disabled={!hasPos || journeyActive} onClick={act('setoff', true)}>
            <Navigation className="w-4 h-4" aria-hidden="true" />{journeyActive ? 'On your way…' : `Set off · keep ${peerName} posted`}
          </button>
          <button type="button" className="g-meet__btn" disabled={!hasPos || journeyActive} onClick={act('compass')}><Compass className="w-4 h-4" aria-hidden="true" />Compass</button>
          <button type="button" className="g-meet__btn" disabled={!hasPos} aria-expanded={routes} onClick={() => { hapticLight(); setRoutes((v) => !v); setConfirmCancel(false); }}><Route className="w-4 h-4" aria-hidden="true" />Plan route</button>
          {routes && dest && (
            <div className="g-meet__routes" role="group" aria-label="Open directions in your maps app">
              {TRAVEL_MODES.map((m) => (
                <a key={m.id} href={routeUrl(dest, m.id, apple)} target="_blank" rel="noopener noreferrer" className="g-meet__route">{m.label}</a>
              ))}
              <small>Opens {apple ? 'Apple Maps' : 'your maps app'} with the route to {meeting.venueName}.</small>
            </div>
          )}
          {!hasPos && <p className="g-meet__hint">This meetup has no map position, so the compass and routes are unavailable. Change the plan and pick the place from search.</p>}
          <button type="button" className="g-meet__btn g-meet__btn--quiet" onClick={act('amend')}><Pencil className="w-3.5 h-3.5" aria-hidden="true" />Change</button>
          <button type="button" className="g-meet__btn g-meet__btn--quiet g-meet__btn--danger" onClick={() => { hapticLight(); setConfirmCancel(true); setRoutes(false); }}>Cancel meetup</button>
        </div>
      )}

      {(meeting.status === 'declined' || meeting.status === 'cancelled') && (
        <div className="g-meet__actions">
          <p className="g-meet__hint">{meeting.status === 'declined' ? `${isProposer ? peerName : 'You'} can’t make it.` : 'This meetup was cancelled.'}</p>
          <button type="button" className="g-meet__btn" onClick={act('amend')}><Pencil className="w-4 h-4" aria-hidden="true" />Plan another time or place</button>
        </div>
      )}

      {confirmCancel && (
        <div className="g-meet__confirm" role="alertdialog" aria-label="Cancel this meetup?">
          <span>Cancel this meetup? {peerName} will be told.</span>
          <button type="button" className="g-meet__btn g-meet__btn--danger" onClick={act('cancel', true)}>Yes, cancel</button>
          <button type="button" className="g-meet__btn" onClick={() => setConfirmCancel(false)}>Keep it</button>
        </div>
      )}
    </article>
  );
};
