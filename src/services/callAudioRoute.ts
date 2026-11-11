import { useEffect, useState } from 'react';
import { callLog } from './webrtcService';

/** Where the call sound is going, and a way to change it. Only inside the iPhone app; elsewhere `available` is false. */
export interface AudioRoute { kind: 'speaker' | 'receiver' | 'bluetooth' | 'headphones' | 'car' | 'other'; name: string }

const isIos = (): boolean => {
  if (typeof window === 'undefined') return false;
  const cap = (window as unknown as { Capacitor?: { isNativePlatform?: () => boolean; getPlatform?: () => string } }).Capacitor;
  return Boolean(cap?.isNativePlatform?.() && cap.getPlatform?.() === 'ios');
};

export const routeLabel = (r: AudioRoute | null): string => {
  if (!r) return 'Audio';
  if (r.kind === 'speaker') return 'Speaker';
  if (r.kind === 'receiver') return 'iPhone';
  if (r.kind === 'car') return r.name || 'Car';
  if (r.kind === 'bluetooth' || r.kind === 'headphones') return r.name || 'Headphones';
  return r.name || 'Audio';
};

export async function showAudioOutputPicker(): Promise<void> {
  if (!isIos()) return;
  try { const { GayzeCallKit } = await import('gayze-callkit'); await GayzeCallKit.showRoutePicker(); } catch { /* picker unavailable */ }
}

/** While a call is on: follows where the sound is going. It does not change the audio session; the web view owns the call audio. */
export function useCallAudioRoute(active: boolean, video: boolean): { available: boolean; route: AudioRoute | null } {
  const [route, setRoute] = useState<AudioRoute | null>(null);
  const available = isIos();
  useEffect(() => {
    if (!available || !active) { setRoute(null); return; }
    let cancelled = false;
    let remove: (() => void) | undefined;
    void (async () => {
      try {
        const { GayzeCallKit } = await import('gayze-callkit');
        const handle = await GayzeCallKit.addListener('audioRoute', (e) => { if (!cancelled) setRoute(e); });
        remove = () => { void handle.remove(); };
        const first = await GayzeCallKit.configureAudio({ video });
        callLog(`call audio route: ${first.kind} ${first.name}`);
        if (!cancelled) setRoute(first);
      } catch (error) {
        callLog(`call audio setup failed: ${String((error as { message?: string })?.message ?? error)}`);
        console.warn('[GAYZE] Call audio setup failed:', error);
      }
    })();
    return () => { cancelled = true; remove?.(); };
  }, [available, active, video]);
  return { available, route };
}
