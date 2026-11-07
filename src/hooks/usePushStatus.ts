import { useCallback, useEffect, useRef, useState } from 'react';
import {
  getPushEnvironment,
  isDeviceSubscribed,
  loadNotificationPreferences,
  saveNotificationPreferences,
  subscribeToPush,
} from '../services/pushService';

/**
 * The single answer to "what should the app say about notifications on this
 * device right now?". Every notification prompt (the Profile card and the
 * floating pill) reads this, so they can never disagree and there is exactly one
 * Enable code path.
 *
 *  - hidden        push cannot work here (unsupported browser / not configured)
 *  - needs-install iPhone Safari tab: must be added to the Home Screen first
 *  - blocked       permission denied at device level; only OS settings can fix it
 *  - off           can be enabled with one tap
 *  - on            this device has a live subscription
 */
export type PushStatus = 'checking' | 'hidden' | 'needs-install' | 'blocked' | 'off' | 'on';

export interface PushStatusState {
  status: PushStatus;
  busy: boolean;
  error: string | null;
  /** Must be called from a tap: iOS only allows the permission prompt from a gesture. */
  enable: () => Promise<boolean>;
  refresh: () => Promise<void>;
}

const RECHECK_MS = 30_000;
/** Fired after any in-app change so every mounted prompt re-checks at once. */
export const PUSH_STATUS_EVENT = 'gayze-push-status';
export const announcePushStatusChange = (): void => {
  if (typeof window !== 'undefined') window.dispatchEvent(new Event(PUSH_STATUS_EVENT));
};

export function usePushStatus(userId: string | null | undefined): PushStatusState {
  const [status, setStatus] = useState<PushStatus>('checking');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const mounted = useRef(true);

  const refresh = useCallback(async () => {
    try {
      const env = getPushEnvironment();
      if (env.blockedBy === 'unsupported' || env.blockedBy === 'not-configured') {
        if (mounted.current) setStatus('hidden');
        return;
      }
      if (env.blockedBy === 'ios-needs-install') {
        if (mounted.current) setStatus('needs-install');
        return;
      }
      if (env.blockedBy === 'permission-denied') {
        if (mounted.current) setStatus('blocked');
        return;
      }
      const subscribed = await isDeviceSubscribed();
      if (mounted.current) setStatus(subscribed ? 'on' : 'off');
    } catch {
      // Notification setup is optional and must never break the screen showing it.
    }
  }, []);

  useEffect(() => {
    mounted.current = true;
    void refresh();
    const onWake = () => { void refresh(); };
    // A subscription started elsewhere (OS settings, the Notifications sheet,
    // silent recovery) retires every prompt without a reload.
    window.addEventListener('focus', onWake);
    window.addEventListener('gayze-push-recovery', onWake);
    window.addEventListener(PUSH_STATUS_EVENT, onWake);
    document.addEventListener('visibilitychange', onWake);
    const id = window.setInterval(onWake, RECHECK_MS);
    return () => {
      mounted.current = false;
      window.clearInterval(id);
      window.removeEventListener('focus', onWake);
      window.removeEventListener('gayze-push-recovery', onWake);
      window.removeEventListener(PUSH_STATUS_EVENT, onWake);
      document.removeEventListener('visibilitychange', onWake);
    };
  }, [refresh, userId]);

  const enable = useCallback(async () => {
    if (!userId || (status !== 'off' && status !== 'checking')) return false;
    setBusy(true);
    setError(null);
    // subscribeToPush requests permission synchronously, so it must be the first
    // thing that runs inside the tap handler.
    const result = await subscribeToPush(userId);
    const ok = result.ok;
    if (result.ok) {
      try {
        const prefs = await loadNotificationPreferences();
        await saveNotificationPreferences({ ...prefs, pushEnabled: true }, userId);
      } catch {
        /* The device is registered; preferences can be retried from Notifications. */
      }
    } else {
      setError(result.reason ?? 'Enabling notifications failed.');
    }
    await refresh();
    if (mounted.current) setBusy(false);
    if (ok) announcePushStatusChange();
    return ok;
  }, [refresh, status, userId]);

  return { status, busy, error, enable, refresh };
}
