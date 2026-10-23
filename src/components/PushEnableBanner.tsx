import React, { useEffect, useState } from 'react';
import { Bell, BellOff } from 'lucide-react';
import {
  getPushEnvironment,
  isDeviceSubscribed,
  subscribeToPush,
  saveNotificationPreferences,
  loadNotificationPreferences,
  type PushBlockReason,
} from '../services/pushService';
import { hapticLight } from '../services/hapticService';

/**
 * Shown on the Messages screen while this device has no live push subscription.
 * iOS only lets a Home Screen app ask for notifications from a tap, and a freshly
 * (re)installed Home Screen app starts with no permission and no subscription,
 * so it must be offered here rather than only deep in Profile.
 */
export const PushEnableBanner: React.FC<{ userId: string | null }> = ({ userId }) => {
  const [visible, setVisible] = useState(false);
  const [reason, setReason] = useState<PushBlockReason>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    const check = async () => {
      try {
        const env = getPushEnvironment();
        if (env.blockedBy === 'unsupported' || env.blockedBy === 'not-configured') {
          if (!cancelled) setVisible(false);
          return;
        }
        const subscribed = await isDeviceSubscribed();
        if (cancelled) return;
        setReason(env.blockedBy);
        setVisible(!subscribed);
      } catch {
        // Notification setup is optional and must never affect Messages.
      }
    };
    void check();
    const onWake = () => { void check(); };
    window.addEventListener('focus', onWake);
    window.addEventListener('gayze-push-recovery', onWake);
    document.addEventListener('visibilitychange', onWake);
    const id = window.setInterval(onWake, 30000);
    return () => {
      cancelled = true;
      window.clearInterval(id);
      window.removeEventListener('focus', onWake);
      window.removeEventListener('gayze-push-recovery', onWake);
      document.removeEventListener('visibilitychange', onWake);
    };
  }, [userId]);

  if (!visible || !userId) return null;
  const blocked = reason === 'permission-denied';
  const needsInstall = reason === 'ios-needs-install';

  const enable = async () => {
    hapticLight();
    if (blocked || needsInstall) return;
    setBusy(true);
    setError(null);
    const result = await subscribeToPush(userId);
    if (result.ok) {
      try {
        const prefs = await loadNotificationPreferences();
        await saveNotificationPreferences({ ...prefs, pushEnabled: true }, userId);
      } catch { /* the device is registered; preferences can be retried from Notifications */ }
      setVisible(false);
    } else {
      setError(result.reason ?? 'Enabling notifications failed.');
    }
    setBusy(false);
  };

  return (
    <button
      type="button"
      className="g-profile-notification-banner w-full mb-2 text-left"
      onClick={() => { void enable(); }}
      disabled={busy}
      data-testid="push-enable-banner"
    >
      <span className="g-profile-notification-banner__icon" aria-hidden="true">
        {blocked ? <BellOff className="w-4 h-4" /> : <Bell className="w-4 h-4" />}
      </span>
      <span className="min-w-0 flex-1">
        <span className="block text-[13px] font-bold text-white">
          {needsInstall ? 'Add GAYZE to your Home Screen' : blocked ? 'Notifications are blocked' : 'Turn on notifications'}
        </span>
        <span className="block text-[11px] text-zinc-400 mt-0.5">
          {error ?? (needsInstall ? 'Required on iPhone for push notifications.'
            : blocked ? 'Enable GAYZE in iPhone Settings → Notifications.'
            : 'Get new messages and Gayzes on this phone.')}
        </span>
      </span>
      {!needsInstall && !blocked && (
        <span className="g-profile-notification-banner__action">{busy ? 'Enabling…' : 'Enable'}</span>
      )}
    </button>
  );
};
