import React, { useCallback, useEffect, useState } from 'react';
import {
  Bell,
  BellOff,
  Check,
  Loader2,
  MessageCircle,
  Radio,
  Share,
  Shield,
  Sparkles,
  Timer,
  UserPlus,
  X,
} from 'lucide-react';
import { hapticLight, hapticSensitiveAction } from '../services/hapticService';
import {
  DEFAULT_NOTIFICATION_PREFERENCES,
  getPushEnvironment,
  isBadgingSupported,
  isDeviceSubscribed,
  loadNotificationPreferences,
  saveNotificationPreferences,
  sendTestNotification,
  subscribeToPush,
  unsubscribeFromPush,
  type NotificationPreferences,
  type PushEnvironment,
} from '../services/pushService';

interface NotificationsModalProps {
  isOpen: boolean;
  onClose: () => void;
}

/**
 * The test push is a developer/admin affordance only. It is available in a dev
 * build, or for an operator who has explicitly flipped the local admin flag.
 */
function isTestPushAvailable(): boolean {
  if (import.meta.env.DEV) return true;
  try {
    return window.localStorage.getItem('gayze_admin') === 'true';
  } catch {
    return false;
  }
}

type CategoryKey = Exclude<keyof NotificationPreferences, 'pushEnabled'>;

const CATEGORIES: { key: CategoryKey; icon: React.ReactNode; label: string; meta: string }[] = [
  { key: 'messages', icon: <MessageCircle className="w-4 h-4" />, label: 'Messages', meta: 'When someone messages you' },
  { key: 'intentActivity', icon: <Radio className="w-4 h-4" />, label: 'Intent activity', meta: 'When someone responds to your intent' },
  { key: 'connections', icon: <UserPlus className="w-4 h-4" />, label: 'Connections', meta: 'When interest is mutual' },
  { key: 'intentExpiry', icon: <Timer className="w-4 h-4" />, label: 'Intent expiry', meta: 'Before your intent lapses' },
  { key: 'safety', icon: <Shield className="w-4 h-4" />, label: 'Safety', meta: 'Genuine safety events only' },
];

export const NotificationsModal: React.FC<NotificationsModalProps> = ({ isOpen, onClose }) => {
  const [env, setEnv] = useState<PushEnvironment | null>(null);
  const [subscribed, setSubscribed] = useState(false);
  const [prefs, setPrefs] = useState<NotificationPreferences>(DEFAULT_NOTIFICATION_PREFERENCES);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [feedback, setFeedback] = useState<{ text: string; tone: 'ok' | 'error' | 'info' } | null>(null);

  const refresh = useCallback(async () => {
    setEnv(getPushEnvironment());
    const [device, loaded] = await Promise.all([isDeviceSubscribed(), loadNotificationPreferences()]);
    setSubscribed(device);
    setPrefs(loaded);
    setLoading(false);
  }, []);

  useEffect(() => {
    if (!isOpen) return;
    setLoading(true);
    setFeedback(null);
    void refresh();
  }, [isOpen, refresh]);

  if (!isOpen) return null;

  const handleEnable = async () => {
    hapticSensitiveAction();
    setBusy(true);
    setFeedback(null);
    const result = await subscribeToPush();
    if (result.ok) {
      setSubscribed(true);
      // Turning push on from a disabled master state should also re-enable it.
      const next = { ...prefs, pushEnabled: true };
      setPrefs(next);
      await saveNotificationPreferences(next);
      setFeedback({ text: 'Notifications are on for this device.', tone: 'ok' });
    } else {
      setFeedback({ text: result.reason ?? 'Enabling notifications failed.', tone: 'error' });
    }
    setEnv(getPushEnvironment());
    setBusy(false);
  };

  const handleDisable = async () => {
    hapticSensitiveAction();
    setBusy(true);
    const ok = await unsubscribeFromPush();
    if (ok) {
      setSubscribed(false);
      setFeedback({ text: 'Notifications are off for this device.', tone: 'info' });
    } else {
      setFeedback({ text: 'Could not turn notifications off. Try again.', tone: 'error' });
    }
    setBusy(false);
  };

  const updatePrefs = async (patch: Partial<NotificationPreferences>) => {
    hapticLight();
    const next = { ...prefs, ...patch };
    setPrefs(next);
    const ok = await saveNotificationPreferences(next);
    if (!ok) {
      setPrefs(prefs);
      setFeedback({ text: 'Could not save that preference.', tone: 'error' });
    }
  };

  const handleTest = async () => {
    setBusy(true);
    setFeedback(null);
    const result = await sendTestNotification();
    setFeedback(
      result.ok
        ? { text: 'Test push sent. Lock your device to see it on the Lock Screen.', tone: 'ok' }
        : { text: result.reason ?? 'Test notification failed.', tone: 'error' },
    );
    setBusy(false);
  };

  const needsInstall = env?.blockedBy === 'ios-needs-install';
  const denied = env?.blockedBy === 'permission-denied';
  const unsupported = env?.blockedBy === 'unsupported';
  const notConfigured = env?.blockedBy === 'not-configured';

  return (
    <div className="g-overlay flex items-end sm:items-center justify-center sm:p-4" onClick={onClose}>
      <div className="g-sheet" onClick={(e) => e.stopPropagation()}>
        <div className="g-sheet__grip" />

        <div className="g-sheet__head flex items-center gap-3">
          <span className="flex items-center justify-center w-9 h-9 rounded-[11px] border border-[#6F3CC3]/40 bg-[#6F3CC3]/15 text-[#c9b0f5] shrink-0">
            <Bell className="w-4 h-4" />
          </span>
          <div className="min-w-0 flex-1">
            <h2 className="text-[15px] font-bold text-white leading-tight">Notifications</h2>
            <p className="text-[11.5px] text-zinc-500 truncate">Real Intent. Real Time.</p>
          </div>
          <button type="button" className="g-icon-btn g-icon-btn--bare" onClick={onClose} aria-label="Close">
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="g-sheet__body space-y-4">
          {loading ? (
            <div className="flex items-center justify-center gap-2 py-10 text-[12px] text-zinc-400">
              <Loader2 className="w-4 h-4 animate-spin" />
              Checking this device…
            </div>
          ) : (
            <>
              {/* --- iOS: must be installed to the Home Screen first --- */}
              {needsInstall && (
                <section className="g-panel p-4 space-y-3">
                  <div className="flex items-start gap-3">
                    <span className="flex items-center justify-center w-8 h-8 rounded-[10px] border border-[#C9A24D]/30 bg-[#C9A24D]/10 text-[#e7c98a] shrink-0">
                      <Share className="w-4 h-4" />
                    </span>
                    <div className="min-w-0">
                      <h3 className="text-[13.5px] font-bold text-white">Add Gayze to your Home Screen</h3>
                      <p className="mt-1 text-[12px] leading-relaxed text-zinc-400">
                        iPhone and iPad only deliver notifications to installed apps. Add Gayze to your Home
                        Screen to enable notifications.
                      </p>
                    </div>
                  </div>
                  <ol className="space-y-1.5 pl-1 text-[12px] text-zinc-300">
                    <li><span className="text-[#c9b0f5] font-semibold">1.</span> Tap the Share button in Safari.</li>
                    <li><span className="text-[#c9b0f5] font-semibold">2.</span> Choose “Add to Home Screen”.</li>
                    <li><span className="text-[#c9b0f5] font-semibold">3.</span> Open Gayze from your Home Screen, then return here.</li>
                  </ol>
                </section>
              )}

              {/* --- Permission previously denied --- */}
              {denied && (
                <section className="g-panel p-4">
                  <div className="flex items-start gap-3">
                    <span className="flex items-center justify-center w-8 h-8 rounded-[10px] border border-rose-500/25 bg-rose-500/10 text-rose-300 shrink-0">
                      <BellOff className="w-4 h-4" />
                    </span>
                    <div className="min-w-0">
                      <h3 className="text-[13.5px] font-bold text-white">Notifications are blocked</h3>
                      <p className="mt-1 text-[12px] leading-relaxed text-zinc-400">
                        Gayze cannot re-ask once notifications are blocked. Enable them for Gayze in your device
                        settings, then reopen this screen.
                      </p>
                    </div>
                  </div>
                </section>
              )}

              {unsupported && (
                <section className="g-panel p-4 text-[12px] leading-relaxed text-zinc-400">
                  This browser does not support web push notifications. Gayze will keep showing in-app alerts
                  while you have it open.
                </section>
              )}

              {notConfigured && (
                <section className="g-panel p-4 text-[12px] leading-relaxed text-zinc-400">
                  Push notifications are not configured for this build. No VAPID public key was provided at
                  build time.
                </section>
              )}

              {/* --- Primary opt-in --- */}
              {!subscribed && env?.canSubscribe && (
                <section className="g-panel p-4 space-y-3.5">
                  <div className="flex items-start gap-3">
                    <span className="flex items-center justify-center w-9 h-9 rounded-[11px] border border-[#6F3CC3]/40 bg-[#6F3CC3]/15 text-[#c9b0f5] shrink-0">
                      <Sparkles className="w-4 h-4" />
                    </span>
                    <div className="min-w-0">
                      <h3 className="text-[14px] font-bold text-white">Stay connected</h3>
                      <p className="mt-1 text-[12.5px] leading-relaxed text-zinc-400">
                        Enable notifications to know when someone messages you or interacts with your intent.
                      </p>
                    </div>
                  </div>
                  <div className="flex gap-2">
                    <button type="button" className="g-btn g-btn--primary flex-1" onClick={() => void handleEnable()} disabled={busy}>
                      {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Bell className="w-4 h-4" />}
                      Enable notifications
                    </button>
                    <button type="button" className="g-btn g-btn--quiet" onClick={onClose} disabled={busy}>
                      Not now
                    </button>
                  </div>
                </section>
              )}

              {/* --- Enabled state --- */}
              {subscribed && (
                <section className="g-panel p-4 flex items-center gap-3">
                  <span className="flex items-center justify-center w-8 h-8 rounded-[10px] border border-emerald-500/25 bg-emerald-500/10 text-emerald-400 shrink-0">
                    <Check className="w-4 h-4" />
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="text-[13px] font-bold text-white">Notifications are on</p>
                    <p className="text-[11.5px] text-zinc-500">This device is subscribed.</p>
                  </div>
                  <button type="button" className="g-btn g-btn--quiet" onClick={() => void handleDisable()} disabled={busy}>
                    Turn off
                  </button>
                </section>
              )}

              {/* --- Categories --- */}
              <section className="g-panel overflow-hidden">
                <div className="px-4 pt-3.5 pb-1 flex items-center justify-between gap-3">
                  <span className="g-label">Push notifications</span>
                  <button
                    type="button"
                    role="switch"
                    aria-checked={prefs.pushEnabled}
                    aria-label="Push notifications"
                    className="g-toggle"
                    onClick={() => void updatePrefs({ pushEnabled: !prefs.pushEnabled })}
                  />
                </div>

                {CATEGORIES.map((category, index) => (
                  <React.Fragment key={category.key}>
                    {index === 0 ? <hr className="g-divider mt-2.5" /> : <hr className="g-divider" />}
                    <div className={`g-row ${prefs.pushEnabled ? '' : 'opacity-45'}`}>
                      <span className="flex items-center justify-center w-8 h-8 rounded-[10px] border border-white/10 bg-white/[0.05] text-zinc-400 shrink-0">
                        {category.icon}
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="block text-[13.5px] font-bold text-white">{category.label}</span>
                        <span className="block text-[11px] text-zinc-500 truncate">{category.meta}</span>
                      </span>
                      <button
                        type="button"
                        role="switch"
                        aria-checked={prefs[category.key]}
                        aria-label={category.label}
                        className="g-toggle"
                        disabled={!prefs.pushEnabled}
                        onClick={() => void updatePrefs({ [category.key]: !prefs[category.key] } as Partial<NotificationPreferences>)}
                      />
                    </div>
                  </React.Fragment>
                ))}
              </section>

              {!isBadgingSupported() && (
                <p className="px-1 text-[11px] leading-relaxed text-zinc-600">
                  This device does not support Home Screen badge counts. Notifications still arrive normally.
                </p>
              )}

              {/* --- Developer / admin test --- */}
              {isTestPushAvailable() && (
                <section className="g-panel p-4 space-y-2.5">
                  <span className="g-label">Developer</span>
                  <button type="button" className="g-btn g-btn--quiet w-full" onClick={() => void handleTest()} disabled={busy || !subscribed}>
                    {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Bell className="w-4 h-4" />}
                    Send test notification
                  </button>
                  {!subscribed && (
                    <p className="text-[11px] text-zinc-600">Enable notifications on this device first.</p>
                  )}
                </section>
              )}

              {feedback && (
                <p
                  className={`px-1 text-[12px] leading-relaxed ${
                    feedback.tone === 'error'
                      ? 'text-rose-300'
                      : feedback.tone === 'ok'
                        ? 'text-emerald-300'
                        : 'text-zinc-400'
                  }`}
                >
                  {feedback.text}
                </p>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
};
