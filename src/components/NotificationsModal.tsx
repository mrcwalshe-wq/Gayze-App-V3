import { notificationCopy, type NotificationInbox, type InboxNotification } from '../services/notificationInbox';
import type { ChatConnectionState } from '../services/realtimeRecovery';
import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  Bell,
  BellOff,
  Check,
  Loader2,
  MessageCircle,
  Radio,
  Share,
  ChevronRight,
  ChevronLeft,
  Shield,
  Sparkles,
  Timer,
  UserPlus,
  X,
} from 'lucide-react';
import { hapticLight, hapticSensitiveAction } from '../services/hapticService';
import { acceptIncomingInterest, declineIncomingInterest, loadIncomingInterests, type IncomingInterest } from '../services/supabaseService';
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
  currentUserId?: string | null;
  onClose: () => void;
  inbox?: NotificationInbox | null;
  inboxStatus?: ChatConnectionState;
  onOpenNotification?: (notice: InboxNotification) => void;
  onOpenPublicProfile?: (
    userId: string,
    fallback?: {
      fallbackName?: string;
      fallbackAge?: number;
      fallbackArea?: string;
      fallbackPhotoUrl?: string;
    },
  ) => void;
  onInterestAccepted?: (conversationId: string) => void;
  embedded?: boolean;
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

const notificationLabel = (notice: InboxNotification): string => {
  if (notice.event_key?.startsWith('interest:') && notice.event_key.endsWith(':received')) {
    return 'Someone sent you a Gayze';
  }
  if (notice.event_key?.startsWith('interest:') && notice.event_key.endsWith(':declined')) {
    return 'Your Gayze was declined';
  }
  return notificationCopy[notice.category] ?? 'GAYZE notification';
};

const CATEGORIES: { key: CategoryKey; icon: React.ReactNode; label: string; meta: string }[] = [
  { key: 'messages', icon: <MessageCircle className="w-4 h-4" />, label: 'Messages', meta: 'When someone messages you' },
  { key: 'intentActivity', icon: <Radio className="w-4 h-4" />, label: 'Gayzes', meta: 'When someone sends you a Gayze' },
  { key: 'connections', icon: <UserPlus className="w-4 h-4" />, label: 'Connections', meta: 'When interest is mutual' },
  { key: 'intentExpiry', icon: <Timer className="w-4 h-4" />, label: 'Intent expiry', meta: 'Before your intent lapses' },
  { key: 'safety', icon: <Shield className="w-4 h-4" />, label: 'Safety', meta: 'Genuine safety events only' },
];

export const NotificationsModal: React.FC<NotificationsModalProps> = ({ isOpen, currentUserId, onClose, inbox, inboxStatus = 'connecting', onOpenNotification, onOpenPublicProfile, onInterestAccepted, embedded = false }) => {
  const [env, setEnv] = useState<PushEnvironment | null>(null);
  const [subscribed, setSubscribed] = useState(false);
  const [prefs, setPrefs] = useState<NotificationPreferences>(DEFAULT_NOTIFICATION_PREFERENCES);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [feedback, setFeedback] = useState<{ text: string; tone: 'ok' | 'error' | 'info' } | null>(null);
  const [incomingInterests, setIncomingInterests] = useState<IncomingInterest[]>([]);
  const [interestBusyId, setInterestBusyId] = useState<string | null>(null);
  const [photoViewer, setPhotoViewer] = useState<{ urls: string[]; index: number; name: string } | null>(null);
  const embeddedScrollRef = useRef<HTMLDivElement | null>(null);
  const incomingInterestsRef = useRef<HTMLElement | null>(null);
  const latestIncomingGayzeNoticeId = inbox?.rows.find((notice) =>
    notice.event_key.startsWith('interest:') && notice.event_key.endsWith(':received'),
  )?.id ?? null;

  const refresh = useCallback(async () => {
    setEnv(getPushEnvironment());
    const [device, loaded, interests] = await Promise.all([isDeviceSubscribed(), loadNotificationPreferences(), loadIncomingInterests()]);
    setSubscribed(device);
    setPrefs(loaded);
    setIncomingInterests(interests);
    setLoading(false);
  }, []);

  useEffect(() => {
    if (!isOpen) return;
    if (embedded) requestAnimationFrame(() => {
      if (embeddedScrollRef.current) embeddedScrollRef.current.scrollTop = 0;
    });
    setLoading(true);
    setFeedback(null);
    void refresh();
  }, [isOpen, refresh]);

  // The inbox is Realtime-backed. When a new incoming-Gayze notification lands
  // while this screen is already open, refresh the actionable request cards too;
  // otherwise the badge updates but Accept / Decline remains missing until reopen.
  useEffect(() => {
    if (!isOpen || !embedded || !latestIncomingGayzeNoticeId) return;
    let cancelled = false;
    void loadIncomingInterests().then((interests) => {
      if (!cancelled) {
        setIncomingInterests(interests);
        if (interests.length) requestAnimationFrame(() => incomingInterestsRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }));
      }
    }).catch((error) => {
      console.warn('[GAYZE] Could not refresh incoming Gayze cards:', error);
    });
    return () => { cancelled = true; };
  }, [isOpen, embedded, latestIncomingGayzeNoticeId]);

  useEffect(() => {
    const recovery = (event: Event) => {
      const detail = (event as CustomEvent).detail;
      if (!isOpen || detail?.userId !== currentUserId) return;
      if (detail.state === 'needs-enable') {
        setSubscribed(false);
        setFeedback({ text: 'This device needs notification registration renewed. Tap Enable notifications.', tone: 'info' });
      } else if (detail.state === 'ready') { void refresh(); }
      else if (detail.state === 'unavailable') setFeedback({ text: 'Notification registration could not be checked. Try again when connected.', tone: 'error' });
    };
    window.addEventListener('gayze-push-recovery', recovery);
    return () => window.removeEventListener('gayze-push-recovery', recovery);
  }, [isOpen, currentUserId, refresh]);

  if (!isOpen && !embedded) return null;

  const handleEnable = async () => {
    hapticSensitiveAction();
    setBusy(true);
    setFeedback(null);
    const result = await subscribeToPush(currentUserId ?? undefined);
    if (result.ok) {
      setSubscribed(true);
      const next = { ...prefs, pushEnabled: true };
      setPrefs(next);
      const saved = await saveNotificationPreferences(next, currentUserId ?? undefined);
      setFeedback(saved
        ? { text: 'Notifications are on for this device.', tone: 'ok' }
        : { text: 'Device registered, but notification preferences could not be saved. Please retry.', tone: 'error' });
    } else {
      setFeedback({ text: result.reason ?? 'Enabling notifications failed.', tone: 'error' });
    }
    setEnv(getPushEnvironment());
    setBusy(false);
  };

  const handleDisable = async () => {
    hapticSensitiveAction();
    setBusy(true);
    const ok = await unsubscribeFromPush(currentUserId ?? undefined);
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
    const ok = await saveNotificationPreferences(next, currentUserId ?? undefined);
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
        ? { text: 'Push provider accepted the test. Device delivery still needs confirmation.', tone: 'ok' }
        : { text: result.reason ?? 'Test notification failed.', tone: 'error' },
    );
    setBusy(false);
  };

  const needsInstall = env?.blockedBy === 'ios-needs-install';
  const denied = env?.blockedBy === 'permission-denied';
  const unsupported = env?.blockedBy === 'unsupported';
  const notConfigured = env?.blockedBy === 'not-configured';

  const statusTitle = needsInstall
    ? 'Finish setup on iPhone'
    : denied
      ? 'Notifications are blocked'
      : subscribed
        ? 'Notifications are on'
        : 'Notifications are off';

  const statusDescription = needsInstall
    ? 'Add GAYZE to your Home Screen first. iOS only enables web push for installed apps.'
    : denied
      ? 'Notification permission is blocked at device level. Re-enable GAYZE in iPhone Settings.'
      : subscribed
        ? 'This device is registered and ready to receive GAYZE alerts.'
        : 'Turn notifications on to hear about messages, Gayzes, connections and intent activity.';

  const statusTone = needsInstall || denied ? 'attention' : subscribed ? 'ready' : 'action';

  const recentRows = inbox?.rows.slice(0, 4) ?? [];

  return (
    <div ref={embedded ? embeddedScrollRef : undefined} className={embedded ? 'g-messages-notifications' : 'g-overlay g-notifications-overlay flex items-end sm:items-center justify-center sm:p-4'} onClick={embedded ? undefined : onClose}>
      <div className={embedded ? 'g-messages-notifications__panel' : 'g-sheet g-notifications-sheet'} onClick={embedded ? undefined : (e) => e.stopPropagation()}>
        <div className="g-sheet__grip" />

        <div className="g-sheet__head flex items-center gap-3">
          <span className="g-notifications-title-icon">
            <Bell className="w-4 h-4" />
          </span>
          <div className="min-w-0 flex-1">
            <h2 className="text-[15px] font-bold text-white leading-tight">Notifications</h2>
            <p className="text-[11.5px] text-zinc-500">Real Intent. Real Time.</p>
          </div>
          {!embedded && (
            <button type="button" className="g-icon-btn g-icon-btn--bare" onClick={onClose} aria-label="Close">
              <X className="w-4 h-4" />
            </button>
          )}
        </div>

        <div className="g-sheet__body g-notifications-body">
          {loading ? (
            <div className="g-notifications-loading">
              <Loader2 className="w-4 h-4 animate-spin" />
              Checking this device…
            </div>
          ) : (
            <>
              <section className={`g-notification-status g-notification-status--${statusTone}`} aria-live="polite">
                <div className="g-notification-status__top">
                  <div className="g-notification-status__icon">
                    {statusTone === 'ready' ? <Check className="w-5 h-5" /> : statusTone === 'attention' ? <BellOff className="w-5 h-5" /> : <Bell className="w-5 h-5" />}
                  </div>
                  <div className="min-w-0 flex-1">
                    <span className="g-label">Notification status</span>
                    <h3>{statusTitle}</h3>
                    <p>{statusDescription}</p>
                  </div>
                </div>

                {needsInstall && (
                  <div className="g-notification-steps">
                    <div><b>1</b><span>Tap Safari Share</span></div>
                    <div><b>2</b><span>Choose “Add to Home Screen”</span></div>
                    <div><b>3</b><span>Open GAYZE from the Home Screen</span></div>
                  </div>
                )}

                {denied && (
                  <div className="g-notification-device-note">
                    <BellOff className="w-3.5 h-3.5 shrink-0" />
                    <span>GAYZE can detect that permission is denied, but iOS must be changed in Settings.</span>
                  </div>
                )}

                {!needsInstall && !denied && !subscribed && env?.canSubscribe && (
                  <button type="button" className="g-btn g-btn--primary w-full mt-3" onClick={() => void handleEnable()} disabled={busy}>
                    {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Bell className="w-4 h-4" />}
                    Enable notifications
                  </button>
                )}

                {subscribed && (
                  <div className="g-notification-status__ready">
                    <Check className="w-3.5 h-3.5" />
                    <span>Push is active on this device</span>
                  </div>
                )}
              </section>

              {feedback && (
                <div className={`g-notification-feedback g-notification-feedback--${feedback.tone}`} role="status">
                  {feedback.text}
                </div>
              )}

              <section className="g-panel g-notification-preferences overflow-hidden">
                <div className="g-notification-section-head">
                  <div>
                    <span className="g-label">Preferences</span>
                    <h3>What GAYZE can notify you about</h3>
                  </div>
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
                    {index === 0 ? <hr className="g-divider" /> : <hr className="g-divider" />}
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

              {incomingInterests.length > 0 && (
                <section className="g-panel g-notification-inbox">
                  <div className="g-notification-section-head"><div><span className="g-label text-[#C9A24D]">Intent interests</span><h3>{incomingInterests.length} awaiting your response</h3></div></div>
                  {incomingInterests.map((interest) => (
                    <div key={interest.id} className="border-t border-white/[0.06] p-4">
                      <div className="flex items-start gap-3">
                        <button
                          type="button"
                          className="relative w-16 h-16 shrink-0 rounded-2xl overflow-hidden border border-[#C9A24D]/45 bg-[#171922] focus:outline-none focus:ring-2 focus:ring-[#C9A24D]/60"
                          aria-label={`View ${interest.fromDisplayName}'s profile`}
                          onClick={() => onOpenPublicProfile?.(interest.fromUserId, {
                            fallbackName: interest.fromDisplayName,
                            fallbackAge: interest.fromAge ?? undefined,
                            fallbackArea: interest.fromNeighborhood ?? undefined,
                            fallbackPhotoUrl: interest.fromAvatarUrl ?? undefined,
                          })}
                        >
                          <span className="absolute inset-0 flex items-center justify-center text-xl font-bold text-white">
                            {interest.fromDisplayName.slice(0, 1).toUpperCase()}
                          </span>
                          {interest.fromAvatarUrl && (
                            <img
                              src={interest.fromAvatarUrl}
                              alt=""
                              className="absolute inset-0 w-full h-full object-cover"
                              onError={(e) => { (e.currentTarget as HTMLImageElement).style.display = 'none'; }}
                            />
                          )}
                        </button>
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-2">
                            <div className="text-sm font-semibold text-white truncate">
                              {interest.fromDisplayName}{interest.fromAge ? `, ${interest.fromAge}` : ''}
                            </div>
                            {interest.fromSafetyVerified && <Shield className="w-3.5 h-3.5 text-emerald-400 shrink-0" />}
                          </div>
                          {interest.fromNeighborhood && (
                            <div className="text-[10.5px] text-zinc-500 mt-0.5 truncate">{interest.fromNeighborhood}</div>
                          )}
                          {interest.fromBio && (
                            <p className="text-[11.5px] text-zinc-300 mt-2 leading-relaxed line-clamp-2">{interest.fromBio}</p>
                          )}
                          {(interest.fromInterests?.length || interest.fromReliabilityScore || interest.fromVerifiedPeersCount) ? (
                            <div className="flex flex-wrap gap-1.5 mt-2">
                              {interest.fromInterests?.slice(0, 3).map((item) => (
                                <span key={item} className="px-2 py-1 rounded-full bg-white/[0.04] border border-white/[0.07] text-[9.5px] text-zinc-400">{item}</span>
                              ))}
                              {interest.fromReliabilityScore ? <span className="px-2 py-1 rounded-full bg-emerald-500/[0.07] border border-emerald-500/20 text-[9.5px] text-emerald-300">Reliability {interest.fromReliabilityScore}</span> : null}
                            </div>
                          ) : null}
                          <div className="text-[10.5px] text-zinc-500 mt-2">Intent interest · review their profile before deciding</div>
                        </div>
                      </div>
                      {interest.message && <div className="mt-3 rounded-xl bg-white/[0.04] px-3 py-2.5 text-[12px] text-zinc-200">{interest.message}</div>}
                      {interest.sharedPhotoUrls?.length ? (
                        <div className="mt-3">
                          <div className="flex items-center justify-between mb-2">
                            <span className="text-[10.5px] text-zinc-500">{interest.sharedPhotoUrls.length} shared photo{interest.sharedPhotoUrls.length === 1 ? '' : 's'}</span>
                            <button
                              type="button"
                              className="text-[10.5px] font-semibold text-[#C9A24D]"
                              onClick={() => setPhotoViewer({ urls: interest.sharedPhotoUrls!, index: 0, name: interest.fromDisplayName })}
                            >
                              Open album
                            </button>
                          </div>
                          <div className="grid grid-cols-4 gap-2">
                            {interest.sharedPhotoUrls.map((url, photoIndex) => (
                              <button
                                key={url}
                                type="button"
                                className="overflow-hidden rounded-xl border border-white/10 focus:outline-none focus:ring-2 focus:ring-[#C9A24D]/60"
                                aria-label={`Open shared photo ${photoIndex + 1} of ${interest.sharedPhotoUrls!.length}`}
                                onClick={() => setPhotoViewer({ urls: interest.sharedPhotoUrls!, index: photoIndex, name: interest.fromDisplayName })}
                              >
                                <img src={url} alt="" className="aspect-square object-cover w-full h-full" />
                              </button>
                            ))}
                          </div>
                        </div>
                      ) : null}
                      <div className="grid grid-cols-2 gap-2 mt-4">
                        <button type="button" disabled={interestBusyId===interest.id} onClick={async()=>{setInterestBusyId(interest.id);const result=await acceptIncomingInterest(interest.id);setInterestBusyId(null);if(result.accepted){setIncomingInterests(prev=>prev.filter(item=>item.id!==interest.id));onInterestAccepted?.(result.conversation_id!);setFeedback({text:'Intent interest accepted. Your encrypted chat is ready.',tone:'ok'});}else setFeedback({text:'Could not accept this interest. Try again.',tone:'error'});}} className="g-btn g-btn--primary min-h-[44px]">{interestBusyId===interest.id?'Working…':'Accept'}</button>
                        <button type="button" disabled={interestBusyId===interest.id} onClick={async()=>{setInterestBusyId(interest.id);const ok=await declineIncomingInterest(interest.id);setInterestBusyId(null);if(ok){setIncomingInterests(prev=>prev.filter(item=>item.id!==interest.id));setFeedback({text:'Declined. The sender will not be notified.',tone:'info'});}else setFeedback({text:'Could not decline this interest. Try again.',tone:'error'});}} className="g-btn g-btn--quiet min-h-[44px]">Decline</button>
                      </div>
                    </div>
                  ))}
                </section>
              )}

              <section className="g-panel g-notification-inbox">
                <div className="g-notification-section-head">
                  <div>
                    <span className="g-label">Activity</span>
                    <h3>{inbox?.unread ? `${inbox.unread} unread` : 'Recent notifications'}</h3>
                  </div>
                  {inboxStatus !== 'connected' && <span className="text-[10px] text-zinc-500">Reconnecting…</span>}
                </div>
                {recentRows.length === 0 ? (
                  <p className="text-xs text-zinc-500 px-4 pb-4">Nothing here yet. GAYZE will surface messages, Gayzes and connections here.</p>
                ) : (
                  recentRows.map((notice) => (
                    <button key={notice.id} type="button" onClick={() => onOpenNotification?.(notice)}
                      className="g-notification-row" aria-label={`${notice.read_at ? 'Read' : 'Unread'}: ${notificationLabel(notice)}`}>
                      <span className={`g-notification-row__dot ${notice.read_at ? 'is-read' : ''}`} />
                      <span className="min-w-0 flex-1">
                        <span className="block text-[13px] font-semibold text-white truncate">{notificationLabel(notice)}</span>
                        <time className="block mt-1 text-[10.5px] text-zinc-600" dateTime={notice.created_at}>{new Date(notice.created_at).toLocaleString()}</time>
                      </span>
                      <ChevronRight className="w-3.5 h-3.5 text-zinc-600" />
                    </button>
                  ))
                )}
              </section>

              {unsupported && (
                <p className="g-notification-footnote">This browser cannot receive web push. In-app notifications remain available while GAYZE is open.</p>
              )}
              {notConfigured && (
                <p className="g-notification-footnote">Push is not configured for this build.</p>
              )}
              {!isBadgingSupported() && (
                <p className="g-notification-footnote">Home Screen badge counts are not supported on this device.</p>
              )}

              {isTestPushAvailable() && (
                <section className="g-panel p-4 space-y-2.5">
                  <span className="g-label">Developer</span>
                  <button type="button" className="g-btn g-btn--quiet w-full" onClick={() => void handleTest()} disabled={busy || !subscribed}>
                    {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Bell className="w-4 h-4" />}
                    Send test notification
                  </button>
                </section>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );

};
