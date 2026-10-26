import { useCallback, useEffect, useRef, useState } from 'react';
import { bearingDeg, distanceM, dueStage, estimateSpeed, etaMinutes, stageMessage, turnNeeded, directionState, STAGES, type Direction, type Stage } from './journey';
import type { LatLng } from './geo';

export interface JourneyPlan {
  roomId: string;
  peerName: string;
  venueName: string;
  dest: LatLng;
  /** Send the four progress messages into the chat. Off = compass only. */
  share: boolean;
  /** The meetup this journey is for, when it was started from a meetup card. */
  meetingId?: string;
}
interface Stored extends JourneyPlan { startedAt: number; origin: LatLng | null; handled: Stage[] }

export type CompassState = 'ok' | 'course' | 'denied' | 'unavailable';
export interface JourneyLive {
  distM: number | null; etaMin: number | null; accuracyM: number | null;
  bearing: number | null; heading: number | null; turn: number | null; direction: Direction | 'unknown';
  compass: CompassState; arrived: boolean; gpsError: string | null; lastSent: Stage | null; sendError: boolean;
}
const EMPTY: JourneyLive = { distM: null, etaMin: null, accuracyM: null, bearing: null, heading: null, turn: null, direction: 'unknown', compass: 'unavailable', arrived: false, gpsError: null, lastSent: null, sendError: false };

const KEY = 'gayze_journey';
const MAX_AGE_MS = 4 * 3600_000;

const load = (): Stored | null => {
  try {
    const s = JSON.parse(localStorage.getItem(KEY) || 'null') as Stored | null;
    return s && Date.now() - s.startedAt < MAX_AGE_MS && !s.handled.includes('arrived') ? s : null;
  } catch { return null; }
};
const save = (s: Stored | null) => { try { s ? localStorage.setItem(KEY, JSON.stringify(s)) : localStorage.removeItem(KEY); } catch { /* storage unavailable */ } };

type OrientationCtor = typeof DeviceOrientationEvent & { requestPermission?: () => Promise<'granted' | 'denied'> };

/**
 * Tracks a walk to a place while the app is open: GPS for distance/ETA and the four progress messages, the compass for the
 * green/red "right direction" cue. A web app cannot track in the background, so everything pauses when the screen locks and
 * resumes when the app is visible again; the screen is kept awake while the journey is on.
 */
export function useJourney(send: (roomId: string, text: string) => Promise<void>) {
  const [journey, setJourney] = useState<Stored | null>(() => load());
  const [live, setLive] = useState<JourneyLive>(EMPTY);
  const journeyRef = useRef<Stored | null>(journey);
  const sendRef = useRef(send);
  sendRef.current = send;
  const samples = useRef<{ t: number; lat: number; lng: number }[]>([]);
  const pos = useRef<{ lat: number; lng: number; accuracy: number; course: number | null; speed: number | null } | null>(null);
  const headingRef = useRef<number | null>(null);
  const compassRef = useRef<CompassState>('unavailable');
  const pending = useRef<Stage | null>(null);
  const sending = useRef(false);
  const retryAt = useRef(0);
  const sendFailed = useRef(false);

  const evaluate = useCallback(() => {
    const j = journeyRef.current, p = pos.current;
    if (!j || !p) return;
    const here = { lat: p.lat, lng: p.lng };
    const distM = distanceM(here, j.dest);
    // Prefer the phone's measured speed, then speed from recent fixes, then walking pace.
    const speed = p.speed && p.speed > 0.6 ? p.speed : estimateSpeed(samples.current);
    const etaMin = etaMinutes(distM, speed);
    const bearing = bearingDeg(here, j.dest);
    let heading = headingRef.current, compass = compassRef.current;
    if (heading == null && p.course != null && (p.speed ?? 0) > 0.8) { heading = p.course; compass = 'course'; }
    const turn = heading == null ? null : turnNeeded(heading, bearing);
    const moved = j.origin ? distanceM(j.origin, here) : 0;
    const due = j.share ? dueStage({ distM, etaMin, movedFromOriginM: moved, accuracyM: p.accuracy, handled: j.handled }) : (distM <= Math.max(60, p.accuracy) && p.accuracy <= 100 ? 'arrived' : null);

    // A stage has to be seen on two readings in a row before it is sent (GPS jitter), and a failed send is retried later.
    if (due && due === pending.current && !sending.current && Date.now() >= retryAt.current) {
      sending.current = true;
      const finish = (ok: boolean) => {
        sending.current = false;
        if (ok) {
          sendFailed.current = false;
          const next: Stored = { ...journeyRef.current!, handled: [...journeyRef.current!.handled, ...STAGES.slice(0, STAGES.indexOf(due) + 1).filter((s) => !journeyRef.current!.handled.includes(s))] };
          journeyRef.current = next; save(next); setJourney(next);
          setLive((l) => ({ ...l, lastSent: due, sendError: false, arrived: due === 'arrived' }));
        } else { sendFailed.current = true; retryAt.current = Date.now() + 30_000; setLive((l) => ({ ...l, sendError: true })); }
      };
      if (j.share) sendRef.current(j.roomId, stageMessage(due, j.venueName)).then(() => finish(true), () => finish(false));
      else finish(true);
    }
    pending.current = due;
    setLive((l) => ({ ...l, distM, etaMin, accuracyM: p.accuracy, bearing, heading, turn, direction: turn == null ? 'unknown' : directionState(turn), compass, arrived: l.arrived || j.handled.includes('arrived') || (j.share === false && due === 'arrived'), gpsError: null }));
  }, []);

  const active = Boolean(journey);
  useEffect(() => {
    if (!active || !navigator.geolocation) return;
    journeyRef.current = journey;
    const watch = navigator.geolocation.watchPosition((g) => {
      const here = { lat: g.coords.latitude, lng: g.coords.longitude };
      pos.current = { ...here, accuracy: g.coords.accuracy, course: Number.isFinite(g.coords.heading ?? NaN) ? g.coords.heading : null, speed: Number.isFinite(g.coords.speed ?? NaN) ? g.coords.speed : null };
      samples.current = [...samples.current.filter((s) => g.timestamp - s.t < 180_000), { t: g.timestamp, ...here }];
      const j = journeyRef.current;
      if (j && !j.origin && g.coords.accuracy <= 100) { const next = { ...j, origin: here }; journeyRef.current = next; save(next); setJourney(next); }
      evaluate();
    }, (err) => setLive((l) => ({ ...l, gpsError: err.code === 1 ? 'Location is switched off for GAYZE. Turn it on to use the guide.' : 'Waiting for a location fix…' })),
    { enableHighAccuracy: true, maximumAge: 4000, timeout: 20000 });

    const onOrient = (e: DeviceOrientationEvent) => {
      const ios = (e as DeviceOrientationEvent & { webkitCompassHeading?: number }).webkitCompassHeading;
      let h: number | null = null;
      if (typeof ios === 'number' && Number.isFinite(ios)) h = ios;
      else if (e.absolute && typeof e.alpha === 'number') h = (360 - e.alpha) % 360;
      if (h == null) return;
      h = (h + (screen.orientation?.angle ?? 0)) % 360;
      const prev = headingRef.current;
      headingRef.current = prev == null ? h : (prev + (((h - prev + 540) % 360) - 180) * 0.3 + 360) % 360;   // smooth, wrap-safe
      compassRef.current = 'ok';
      evaluate();
    };
    window.addEventListener('deviceorientationabsolute', onOrient as EventListener, true);
    window.addEventListener('deviceorientation', onOrient as EventListener, true);

    let lock: WakeLockSentinel | null = null;
    const keepAwake = () => { if (document.visibilityState === 'visible') navigator.wakeLock?.request('screen').then((l) => { lock = l; }).catch(() => undefined); };
    keepAwake();
    document.addEventListener('visibilitychange', keepAwake);
    const tick = window.setInterval(evaluate, 5000);

    return () => {
      navigator.geolocation.clearWatch(watch);
      window.removeEventListener('deviceorientationabsolute', onOrient as EventListener, true);
      window.removeEventListener('deviceorientation', onOrient as EventListener, true);
      document.removeEventListener('visibilitychange', keepAwake);
      window.clearInterval(tick);
      lock?.release().catch(() => undefined);
    };
  }, [active, evaluate]);   // eslint-disable-line react-hooks/exhaustive-deps

  const stop = useCallback(() => {
    journeyRef.current = null; save(null); setJourney(null); setLive(EMPTY);
    samples.current = []; pos.current = null; headingRef.current = null; pending.current = null; sending.current = false;
  }, []);

  /** Must run from a tap: iOS only shows the motion-and-orientation prompt for a user gesture. */
  const start = useCallback(async (plan: JourneyPlan) => {
    const O = (window as unknown as { DeviceOrientationEvent?: OrientationCtor }).DeviceOrientationEvent;
    let compass: CompassState = O ? 'unavailable' : 'unavailable';
    if (O?.requestPermission) {
      try { compass = (await O.requestPermission()) === 'granted' ? 'unavailable' : 'denied'; } catch { compass = 'denied'; }
    }
    compassRef.current = compass; headingRef.current = null; samples.current = []; pos.current = null; pending.current = null;
    const stored: Stored = { ...plan, startedAt: Date.now(), origin: null, handled: [] };
    journeyRef.current = stored; save(stored); setJourney(stored); setLive({ ...EMPTY, compass });
  }, []);

  // Wrap up a moment after arriving so the card is seen, then clear it.
  useEffect(() => {
    if (!live.arrived) return;
    const t = window.setTimeout(stop, 25_000);
    return () => window.clearTimeout(t);
  }, [live.arrived, stop]);

  /** Pause or resume the automatic messages to the other person. The guide itself keeps running. */
  const setShare = useCallback((share: boolean) => {
    const j = journeyRef.current;
    if (!j || j.share === share) return;
    const next: Stored = { ...j, share };
    journeyRef.current = next; save(next); setJourney(next);
    pending.current = null; retryAt.current = 0;
    setLive((l) => ({ ...l, sendError: false }));
  }, []);

  return { journey, live, start, stop, setShare };
}
