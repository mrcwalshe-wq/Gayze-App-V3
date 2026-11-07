import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Bell, BellOff, ChevronRight, Loader2 } from 'lucide-react';
import { InstallPrompt } from './InstallPrompt';
import { usePushStatus } from '../hooks/usePushStatus';
import { hapticLight } from '../services/hapticService';

interface SetupDockProps {
  userId: string | null;
  /** False when push cannot work for this build (no live backend). */
  enabled: boolean;
  /** Hide the pill where it would get in the way (Profile already has the card; an open chat has a composer). */
  suppressPill?: boolean;
  /** Takes the person to the Profile notifications card. */
  onOpenProfile: () => void;
}

/**
 * One floating slot above the tab bar for device-setup nudges: the iOS
 * "Add to Home Screen" reminder and, beside it, a persistent notifications pill.
 * The pill is deliberately compact and not dismissible; it disappears only when
 * notifications are actually on (or can never work on this device).
 */
export const SetupDock: React.FC<SetupDockProps> = ({ userId, enabled, suppressPill = false, onOpenProfile }) => {
  const push = usePushStatus(enabled ? userId : null);
  const [installVisible, setInstallVisible] = useState(false);
  const dockRef = useRef<HTMLDivElement | null>(null);
  const onInstallVisible = useCallback((v: boolean) => setInstallVisible(v), []);

  // The install reminder already explains why notifications are unavailable on
  // iPhone, so the pill steps aside while it is on screen.
  const showPill = enabled && !!userId && !suppressPill && (
    push.status === 'off'
    || push.status === 'blocked'
    || (push.status === 'needs-install' && !installVisible)
  );

  // Publish the dock's height so the map controls can sit above it instead of underneath it.
  useEffect(() => {
    const el = dockRef.current;
    const root = document.documentElement;
    const publish = () => { const h = el?.offsetHeight ?? 0; root.style.setProperty('--g-setup-h', h > 0 ? `${h + 8}px` : '0px'); };
    publish();
    const observer = typeof ResizeObserver !== 'undefined' && el ? new ResizeObserver(publish) : null;
    if (el) observer?.observe(el);
    return () => { observer?.disconnect(); root.style.setProperty('--g-setup-h', '0px'); };
  }, []);

  const label = push.status === 'blocked'
    ? 'Notifications blocked'
    : push.status === 'needs-install'
      ? 'Add to Home Screen for notifications'
      : push.busy ? 'Enabling…' : 'Turn on notifications';

  const onPillTap = () => {
    hapticLight();
    if (push.status === 'off') void push.enable();
    else onOpenProfile();
  };

  return (
    <div
      className="fixed left-3 right-3 z-50 flex flex-col items-stretch gap-2 pointer-events-none bottom-[calc(var(--g-tabbar-h,3.5rem)+env(safe-area-inset-bottom,0px)+12px)] md:left-auto md:right-6 md:bottom-6 md:w-[360px]"
      data-testid="setup-dock"
      ref={dockRef}
    >
      <div className="pointer-events-auto empty:hidden"><InstallPrompt onVisibleChange={onInstallVisible} /></div>
      {showPill && (
        <button
          type="button"
          className="g-float g-setup-pill pointer-events-auto"
          onClick={onPillTap}
          disabled={push.busy}
          data-testid="notifications-pill"
          data-state={push.status}
        >
          <span className="g-setup-pill__icon" aria-hidden="true">
            {push.busy ? <Loader2 className="w-3.5 h-3.5 animate-spin" />
              : push.status === 'blocked' ? <BellOff className="w-3.5 h-3.5" /> : <Bell className="w-3.5 h-3.5" />}
          </span>
          <span className="min-w-0 flex-1 truncate text-left">{push.error ?? label}</span>
          <ChevronRight className="w-3.5 h-3.5 text-zinc-500 shrink-0" aria-hidden="true" />
        </button>
      )}
    </div>
  );
};
