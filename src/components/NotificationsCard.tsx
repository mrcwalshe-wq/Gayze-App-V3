import React from 'react';
import { Bell, BellOff, Check, ChevronRight, Loader2, Plus, Share } from 'lucide-react';
import type { PushStatus } from '../hooks/usePushStatus';
import { hapticLight } from '../services/hapticService';

interface NotificationsCardProps {
  status: PushStatus;
  busy: boolean;
  error: string | null;
  onEnable: () => void;
  /** Opens notification preferences and the activity log. */
  onManage?: () => void;
}

/**
 * THE place to turn notifications on. It lives on the Profile screen and is the
 * only component that renders an "Enable" action for push; the floating pill and
 * the Notifications sheet both point here or call the same hook.
 */
export const NotificationsCard: React.FC<NotificationsCardProps> = ({ status, busy, error, onEnable, onManage }) => {
  if (status === 'checking') return null;

  if (status === 'hidden') {
    // Push can't work in this browser; the inbox and preferences still can.
    return onManage ? (
      <button
        type="button"
        className="g-profile-notification-banner g-profile-notification-banner--on g-profile-notification-banner--top w-full mb-4 text-left"
        onClick={() => { hapticLight(); onManage(); }}
        data-testid="notifications-card"
        data-state="hidden"
      >
        <span className="g-profile-notification-banner__icon" aria-hidden="true"><Bell className="w-4 h-4" /></span>
        <span className="min-w-0 flex-1">
          <span className="block text-[13px] font-bold text-white">Notifications</span>
          <span className="block text-[11px] text-zinc-400 mt-0.5">Messages, Gayzes and activity.</span>
        </span>
        <ChevronRight className="w-4 h-4 text-zinc-600 shrink-0" aria-hidden="true" />
      </button>
    ) : null;
  }

  if (status === 'on') {
    return (
      <button
        type="button"
        className="g-profile-notification-banner g-profile-notification-banner--on g-profile-notification-banner--top w-full mb-4 text-left"
        onClick={() => { hapticLight(); onManage?.(); }}
        disabled={!onManage}
        data-testid="notifications-card"
        data-state="on"
      >
        <span className="g-profile-notification-banner__icon" aria-hidden="true"><Check className="w-4 h-4" /></span>
        <span className="min-w-0 flex-1">
          <span className="block text-[13px] font-bold text-white">Notifications are on</span>
          <span className="block text-[11px] text-zinc-400 mt-0.5">Manage what GAYZE can tell you.</span>
        </span>
        {onManage && <ChevronRight className="w-4 h-4 text-zinc-600 shrink-0" aria-hidden="true" />}
      </button>
    );
  }

  if (status === 'needs-install') {
    return (
      <div
        className="g-profile-notification-banner g-profile-notification-banner--top w-full mb-4 text-left !items-start"
        data-testid="notifications-card"
        data-state="needs-install"
      >
        <span className="g-profile-notification-banner__icon" aria-hidden="true"><Bell className="w-4 h-4" /></span>
        <span className="min-w-0 flex-1">
          <span className="block text-[13px] font-bold text-white">Add GAYZE to your Home Screen</span>
          <span className="block text-[11px] text-zinc-400 mt-0.5">iPhone only allows notifications from the installed app.</span>
          <span className="mt-2 flex flex-wrap items-center gap-1.5 text-[11.5px] text-zinc-300">
            <span className="inline-flex items-center gap-1 rounded-[7px] border border-white/10 bg-white/[0.05] px-1.5 py-0.5">
              <Share className="w-3 h-3 text-[#c9b0f5]" aria-hidden="true" /> Share
            </span>
            <span className="text-zinc-600" aria-hidden="true">→</span>
            <span className="inline-flex items-center gap-1 rounded-[7px] border border-white/10 bg-white/[0.05] px-1.5 py-0.5">
              <Plus className="w-3 h-3 text-[#e7c98a]" aria-hidden="true" /> Add to Home Screen
            </span>
            <span className="text-zinc-600" aria-hidden="true">→</span>
            <span>Open GAYZE from the icon</span>
          </span>
        </span>
      </div>
    );
  }

  if (status === 'blocked') {
    return (
      <div
        className="g-profile-notification-banner g-profile-notification-banner--top w-full mb-4 text-left"
        data-testid="notifications-card"
        data-state="blocked"
      >
        <span className="g-profile-notification-banner__icon" aria-hidden="true"><BellOff className="w-4 h-4" /></span>
        <span className="min-w-0 flex-1">
          <span className="block text-[13px] font-bold text-white">Notifications are blocked</span>
          <span className="block text-[11px] text-zinc-400 mt-0.5">Allow GAYZE in your device Settings → Notifications, then come back.</span>
        </span>
      </div>
    );
  }

  // status === 'off'
  return (
    <button
      type="button"
      className="g-profile-notification-banner g-profile-notification-banner--top w-full mb-4 text-left"
      onClick={() => { hapticLight(); onEnable(); }}
      disabled={busy}
      data-testid="notifications-card"
      data-state="off"
    >
      <span className="g-profile-notification-banner__icon" aria-hidden="true"><Bell className="w-4 h-4" /></span>
      <span className="min-w-0 flex-1">
        <span className="block text-[13px] font-bold text-white">Turn on notifications</span>
        <span className="block text-[11px] mt-0.5" style={{ color: error ? '#f0a0a0' : undefined }}>
          {error ?? <span className="text-zinc-400">Get messages, Gayzes and intent alerts.</span>}
        </span>
      </span>
      <span className="g-profile-notification-banner__action">
        {busy ? <Loader2 className="w-3.5 h-3.5 animate-spin" aria-label="Enabling" /> : 'Enable'}
      </span>
    </button>
  );
};
