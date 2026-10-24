import React from 'react';
import { AlertTriangle, CheckCircle2, Info, PauseCircle } from 'lucide-react';

export type SnackKind = 'success' | 'error' | 'info' | 'paused';

/** The app only hands us a sentence, so the tone is read from its wording. */
export function snackKind(message: string): SnackKind {
  if (/\b(could not|couldn't|can't|cannot|failed|unavailable|error|unable|not saved|still live|unchanged)\b/i.test(message)) return 'error';
  if (/\bpaused\b/i.test(message)) return 'paused';
  if (/…|\.\.\.|\bending\b|\bsaving\b|\bsending\b|\bconnecting\b/i.test(message)) return 'info';
  return 'success';
}

const ICONS = { success: CheckCircle2, error: AlertTriangle, info: Info, paused: PauseCircle } as const;

/**
 * Transient feedback, dropped in under the status bar like a system banner.
 * Tone sets the colour of the icon orb and the timer line; tapping dismisses.
 */
export const Snack: React.FC<{ message: string; onDismiss: () => void }> = ({ message, onDismiss }) => {
  const kind = snackKind(message);
  const Icon = ICONS[kind];
  return (
    <div className="g-snack-wrap" role="status" aria-live="polite">
      <button type="button" className={`g-snack g-snack--${kind}`} onClick={onDismiss} key={message}>
        <span className="g-snack__orb" aria-hidden="true"><Icon className="w-[18px] h-[18px]" /></span>
        <span className="g-snack__text">{message}</span>
        <span className="g-snack__timer" aria-hidden="true" />
      </button>
    </div>
  );
};
