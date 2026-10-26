import React, { useEffect, useState } from 'react';
import { BusFront, Car, ChevronDown, ExternalLink, Footprints, Loader2, Route } from 'lucide-react';
import type { LatLng } from '../services/geo';
import { formatMeters } from '../services/journey';
import { fetchRoute, formatDuration, type RouteSummary } from '../services/directions';
import { isApplePlatform, routeUrl, type TravelMode } from '../services/routeLinks';
import { hapticLight } from '../services/hapticService';

type Mode = 'walk' | 'drive' | 'transit';
const MODES: { id: Mode; label: string; Icon: typeof Footprints }[] = [
  { id: 'walk', label: 'On foot', Icon: Footprints },
  { id: 'drive', label: 'Driving', Icon: Car },
  { id: 'transit', label: 'Public transport', Icon: BusFront },
];

interface DirectionsPanelProps { dest: LatLng; venueName: string; from: LatLng | null }

/** How to get there on foot, by car or by public transport. Foot and car are detailed here; transport opens the phone's maps app. */
export const DirectionsPanel: React.FC<DirectionsPanelProps> = ({ dest, venueName, from }) => {
  const [mode, setMode] = useState<Mode>('walk');
  const [route, setRoute] = useState<RouteSummary | null>(null);
  const [state, setState] = useState<'idle' | 'loading' | 'failed'>('idle');
  const [open, setOpen] = useState(false);
  const apple = typeof navigator !== 'undefined' && isApplePlatform(navigator.userAgent, navigator.maxTouchPoints);

  useEffect(() => {
    setRoute(null); setOpen(false);
    if (mode === 'transit' || !from) { setState('idle'); return; }
    const controller = new AbortController();
    setState('loading');
    fetchRoute(from, dest, mode, controller.signal)
      .then((r) => { if (!controller.signal.aborted) { setRoute(r); setState('idle'); } })
      .catch(() => { if (!controller.signal.aborted) setState('failed'); });
    return () => controller.abort();
  }, [mode, dest.lat, dest.lng, from ? Math.round(from.lat * 500) : null, from ? Math.round(from.lng * 500) : null]);

  const mapsMode: TravelMode = mode;
  return (
    <section className="g-dir g-gborder" aria-label={`Directions to ${venueName}`}>
      <div className="g-dir__modes" role="tablist" aria-label="How are you getting there?">
        {MODES.map(({ id, label, Icon }) => (
          <button key={id} type="button" role="tab" aria-selected={mode === id} className={mode === id ? 'is-on' : ''} onClick={() => { hapticLight(); setMode(id); }}>
            <Icon className="w-4 h-4" aria-hidden="true" /><span>{label}</span>
          </button>
        ))}
      </div>

      {mode === 'transit' ? (
        <p className="g-dir__note">Bus, train and tram times change by the minute, so GAYZE hands this one to your maps app for live departures and stops.</p>
      ) : !from ? (
        <p className="g-dir__note">Turn on location to see the route from where you are.</p>
      ) : state === 'loading' ? (
        <div className="g-dir__skeleton" aria-hidden="true"><i /><i /><i /></div>
      ) : state === 'failed' || !route ? (
        <p className="g-dir__note">Couldn't load the route just now. You can still open it in your maps app.</p>
      ) : (
        <>
          <div className="g-dir__sum">
            <strong>{formatDuration(route.durationS)}</strong><span>{formatMeters(route.distanceM)}</span>
            <small>{mode === 'walk' ? 'on foot' : 'by car, without traffic'}</small>
          </div>
          <button type="button" className="g-dir__toggle" aria-expanded={open} onClick={() => setOpen((v) => !v)}>
            <Route className="w-4 h-4" aria-hidden="true" />{open ? 'Hide' : 'Show'} turn-by-turn ({route.steps.length} steps)
            <ChevronDown className={`w-4 h-4 ${open ? 'is-open' : ''}`} aria-hidden="true" />
          </button>
          {open && (
            <ol className="g-dir__steps">
              {route.steps.map((s, i) => (
                <li key={i}><span>{i + 1}</span><p>{s.text}{s.distanceM > 0 && <small>{formatMeters(s.distanceM)}</small>}</p></li>
              ))}
            </ol>
          )}
        </>
      )}

      <a className="g-dir__open" href={routeUrl(dest, mapsMode, apple)} target="_blank" rel="noopener noreferrer">
        <ExternalLink className="w-4 h-4" aria-hidden="true" />Open in {apple ? 'Apple Maps' : 'Maps'}
      </a>
      {state === 'loading' && <Loader2 className="sr-only" aria-hidden="true" />}
    </section>
  );
};
