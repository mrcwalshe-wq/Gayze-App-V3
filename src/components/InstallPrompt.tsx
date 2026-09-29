import React, { useEffect, useState } from 'react';
import { Share, X, Plus } from 'lucide-react';
import { hapticLight } from '../services/hapticService';
import { isIosDevice, isSafariBrowser, isStandalonePwa } from '../services/pushService';

const DISMISS_KEY = 'gayze_install_prompt_dismissed_at';
const DISMISS_COUNT_KEY = 'gayze_install_prompt_dismiss_count';

/** Re-ask after a week, and never more than three times in total. */
const REPROMPT_AFTER_MS = 7 * 24 * 60 * 60 * 1000;
const MAX_DISMISSALS = 3;

function readNumber(key: string): number {
  try {
    return Number(window.localStorage.getItem(key)) || 0;
  } catch {
    return 0;
  }
}

/** True when the polished install nudge should be shown right now. */
export function shouldShowInstallPrompt(): boolean {
  if (typeof window === 'undefined') return false;
  if (isStandalonePwa()) return false;
  // Only iOS Safari genuinely requires installation before push works.
  if (!isIosDevice() || !isSafariBrowser()) return false;

  const dismissals = readNumber(DISMISS_COUNT_KEY);
  if (dismissals >= MAX_DISMISSALS) return false;

  const dismissedAt = readNumber(DISMISS_KEY);
  if (dismissedAt && Date.now() - dismissedAt < REPROMPT_AFTER_MS) return false;

  return true;
}

function recordDismissal(): void {
  try {
    window.localStorage.setItem(DISMISS_KEY, String(Date.now()));
    window.localStorage.setItem(DISMISS_COUNT_KEY, String(readNumber(DISMISS_COUNT_KEY) + 1));
  } catch {
    /* Private mode — the prompt simply reappears next session. */
  }
}

/**
 * A small, Gayze-native banner explaining Home Screen installation on iOS.
 * It never blocks the UI and stops asking once dismissed repeatedly.
 */
export const InstallPrompt: React.FC = () => {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    // Let the shell settle before nudging.
    const timer = window.setTimeout(() => setVisible(shouldShowInstallPrompt()), 2500);
    return () => window.clearTimeout(timer);
  }, []);

  if (!visible) return null;

  const dismiss = () => {
    hapticLight();
    recordDismissal();
    setVisible(false);
  };

  return (
    <div
      className="g-float fixed left-3 right-3 z-50 rounded-[16px] px-3.5 py-3 bottom-[calc(var(--g-tabbar-h,3.5rem)+env(safe-area-inset-bottom,0px)+12px)] md:left-auto md:right-6 md:bottom-6 md:w-[360px]"
      role="dialog"
      aria-label="Install Gayze"
    >
      <div className="flex items-start gap-3">
        <span className="flex items-center justify-center w-9 h-9 rounded-[11px] border border-[#6F3CC3]/40 bg-[#6F3CC3]/15 shrink-0">
          <img src="/icons/gayze-192.png" alt="" width={22} height={22} className="rounded-[6px]" />
        </span>

        <div className="min-w-0 flex-1">
          <p className="text-[13px] font-bold text-white leading-tight">
            Install Gayze on your Home Screen
          </p>
          <p className="mt-1 text-[11.5px] leading-relaxed text-zinc-400">
            Install Gayze on your Home Screen to receive notifications.
          </p>
          <p className="mt-2 flex flex-wrap items-center gap-1.5 text-[11.5px] text-zinc-300">
            <span className="inline-flex items-center gap-1 rounded-[7px] border border-white/10 bg-white/[0.05] px-1.5 py-0.5">
              <Share className="w-3 h-3 text-[#c9b0f5]" /> Share
            </span>
            <span className="text-zinc-600">→</span>
            <span className="inline-flex items-center gap-1 rounded-[7px] border border-white/10 bg-white/[0.05] px-1.5 py-0.5">
              <Plus className="w-3 h-3 text-[#e7c98a]" /> Add to Home Screen
            </span>
          </p>
        </div>

        <button
          type="button"
          className="g-icon-btn g-icon-btn--bare shrink-0"
          onClick={dismiss}
          aria-label="Dismiss install prompt"
        >
          <X className="w-4 h-4" />
        </button>
      </div>
    </div>
  );
};
