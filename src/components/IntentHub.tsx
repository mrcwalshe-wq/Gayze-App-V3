import React, { useEffect, useLayoutEffect, useState } from 'react';
import { Clock3, EyeOff, Pause, PencilLine, Play, Plus, Power, Radio, Sparkles, UsersRound, X } from 'lucide-react';
import type { TopLevelIntentMode, UserActiveIntent } from '../types';
import { hapticLight } from '../services/hapticService';

interface IntentHubProps {
  isOpen: boolean;
  activeIntent?: UserActiveIntent | null;
  remainingMinutes?: number;
  onClose: () => void;
  onCreateIntent: (mode?: TopLevelIntentMode | null) => void;
  onManageIntent: () => void;
  onTogglePause?: () => void;
  onEndIntent?: () => void;
}

const formatRemaining = (minutes: number) => {
  if (minutes <= 0) return 'Expiring';
  const hours = Math.floor(minutes / 60);
  return hours ? `${hours}h ${minutes % 60}m left` : `${minutes}m left`;
};

export const IntentHub: React.FC<IntentHubProps> = ({
  isOpen,
  activeIntent = null,
  remainingMinutes = 0,
  onClose,
  onCreateIntent,
  onManageIntent,
  onTogglePause,
  onEndIntent,
}) => {
  const [confirmEnd, setConfirmEnd] = useState(false);
  useEffect(() => { if (!isOpen) setConfirmEnd(false); }, [isOpen]);
  useEffect(() => {
    if (!confirmEnd) return;
    const t = window.setTimeout(() => setConfirmEnd(false), 4000);
    return () => window.clearTimeout(t);
  }, [confirmEnd]);
  const [navClearance, setNavClearance] = useState<number | null>(null);
  useLayoutEffect(() => {
    if (!isOpen) return;
    const measure = () => {
      const nav = document.querySelector('nav.g-tabbar');
      if (!nav) return setNavClearance(null);
      // Sit above the bar and the GAYZE dome that rises out of it.
      setNavClearance(Math.max(0, window.innerHeight - nav.getBoundingClientRect().top) + 26);
    };
    measure();
    window.addEventListener('resize', measure);
    return () => window.removeEventListener('resize', measure);
  }, [isOpen]);
  if (!isOpen) return null;

  const hasActive = Boolean(activeIntent);
  const isPrivate = activeIntent?.mode === 'private';
  const isPaused = Boolean(activeIntent?.isPaused);
  const total = activeIntent ? Math.max(1, activeIntent.expiresAt - activeIntent.activatedAt) : 1;
  const left = activeIntent ? Math.max(0, activeIntent.expiresAt - Date.now()) : 0;
  const progress = Math.min(1, left / total);

  return (
    <div
      className="g-intent-hub"
      role="dialog"
      aria-modal="true"
      aria-label="GAYZE intents"
      onClick={onClose}
    >
      <div className="g-intent-hub__scrim" aria-hidden="true" />

      {hasActive && activeIntent ? (
        <section
          className={`g-live-card ${isPrivate ? 'is-private' : 'is-social'} ${isPaused ? 'is-paused' : ''}`}
          style={navClearance != null ? { marginBottom: navClearance } : undefined}
          onClick={(event) => event.stopPropagation()}
        >
          <header className="g-live-card__head">
            <span className="g-live-card__mode">
              <i aria-hidden="true" />
              {isPaused ? 'PAUSED' : isPrivate ? 'PRIVATE · LIVE' : 'SOCIAL · LIVE'}
            </span>
            <button type="button" className="g-live-card__close" onClick={onClose} aria-label="Close">
              <X className="w-4 h-4" />
            </button>
          </header>

          <div className="g-live-card__body">
            <span className="g-live-card__icon" aria-hidden="true">
              {isPrivate ? <EyeOff className="w-5 h-5" /> : <Sparkles className="w-5 h-5" />}
            </span>
            <div className="g-live-card__copy">
              <strong>{(activeIntent.intent ?? '').replace(/^(private|social)\s*·\s*/i, '')}</strong>
              <span>{activeIntent.description || (isPaused ? 'Hidden from the map' : 'Visible on the map')}</span>
            </div>
            <div className="g-live-card__time">
              <b>{formatRemaining(remainingMinutes).replace(' left', '')}</b>
              <small>left</small>
            </div>
          </div>

          <div className="g-live-card__meter" role="progressbar" aria-label="Time remaining" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(progress * 100)}>
            <span style={{ width: `${progress * 100}%` }} />
          </div>

          <div className="g-live-card__actions">
            <button type="button" onClick={() => { hapticLight(); onManageIntent(); }}>
              <PencilLine className="w-4 h-4" /><span>Update</span>
            </button>
            {onTogglePause && (
              <button type="button" onClick={() => { hapticLight(); onTogglePause(); }}>
                {isPaused ? <Play className="w-4 h-4" /> : <Pause className="w-4 h-4" />}<span>{isPaused ? 'Resume' : 'Pause'}</span>
              </button>
            )}
            {onEndIntent && (
              <button
                type="button"
                className={`is-end ${confirmEnd ? 'is-armed' : ''}`}
                onClick={() => { if (confirmEnd) { onEndIntent(); } else { hapticLight(); setConfirmEnd(true); } }}
              >
                <Power className="w-4 h-4" /><span>{confirmEnd ? 'Tap to end' : 'End'}</span>
              </button>
            )}
          </div>
        </section>
      ) : (
      <section
        className={`g-gayze-menu-frame g-intent-hub__sheet ${hasActive ? 'g-intent-hub__sheet--live g-intent-hub__sheet--status' : ''}`}
        onClick={(event) => event.stopPropagation()}
      >
        <div className="g-intent-hub__grip" />

        <header className="g-intent-hub__header">
          <div className="g-intent-hub__heading">
            <span className="g-intent-hub__eyebrow">GAYZE · INTENTS</span>
            <h2>{hasActive ? (isPaused ? 'Your intent is paused' : 'Your intent is live') : 'What do you want to do?'}</h2>
            <p>
              {hasActive
                ? (isPaused ? 'Hidden from the map until you resume.' : 'Your signal is visible on the map.')
                : 'Create a time-bound signal and discover people around the same intent.'}
            </p>
          </div>
          <button type="button" className="g-intent-hub__close" onClick={onClose} aria-label="Close intents">
            <X className="w-4 h-4" />
          </button>
        </header>

        {hasActive ? (
          <div className={`g-intent-hub__live ${isPrivate ? 'is-private' : 'is-social'}`}>
            <div className="g-intent-hub__live-icon">
              {isPrivate ? <EyeOff className="w-5 h-5" /> : <Sparkles className="w-5 h-5" />}
            </div>
            <div className="min-w-0 flex-1">
              <div className="g-intent-hub__live-top">
                <span className="g-intent-hub__live-mode">{isPrivate ? 'PRIVATE' : 'SOCIAL'}</span>
                <span className="g-intent-hub__live-time"><Clock3 className="w-3 h-3" /> {formatRemaining(remainingMinutes)}</span>
              </div>
              <strong>{activeIntent?.intent?.replace(' · ', ' ')}</strong>
              <span>{activeIntent?.description || 'Your current GAYZE intent'}</span>
            </div>
          </div>
        ) : (
          <div className="g-intent-hub__choices">
            <button type="button" className="g-intent-hub__choice is-social" onClick={() => { hapticLight(); onCreateIntent('social'); }}>
              <span className="g-intent-hub__choice-icon"><UsersRound className="w-5 h-5" /></span>
              <span className="g-intent-hub__choice-copy">
                <strong>Social</strong>
                <span>Meet, drinks, date, chat or group</span>
              </span>
              <span className="g-intent-hub__choice-arrow">→</span>
            </button>

            <button type="button" className="g-intent-hub__choice is-private" onClick={() => { hapticLight(); onCreateIntent('private'); }}>
              <span className="g-intent-hub__choice-icon"><EyeOff className="w-5 h-5" /></span>
              <span className="g-intent-hub__choice-copy">
                <strong>Private</strong>
                <span>Hookup, host, travel, outdoor or car</span>
              </span>
              <span className="g-intent-hub__choice-arrow">→</span>
            </button>
          </div>
        )}

        {hasActive && (
          <>
            <div className="g-intent-hub__meter" role="progressbar" aria-label="Time remaining" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(progress * 100)}>
              <span style={{ width: `${progress * 100}%` }} />
            </div>
            <div className="g-intent-hub__controls">
              <button type="button" className="g-intent-hub__control" onClick={() => { hapticLight(); onManageIntent(); }}>
                <PencilLine className="w-[18px] h-[18px]" /><span>Update</span>
              </button>
              {onTogglePause && (
                <button type="button" className="g-intent-hub__control" onClick={() => { hapticLight(); onTogglePause(); }}>
                  {isPaused ? <Play className="w-[18px] h-[18px]" /> : <Pause className="w-[18px] h-[18px]" />}<span>{isPaused ? 'Resume' : 'Pause'}</span>
                </button>
              )}
              {onEndIntent && (
                <button
                  type="button"
                  className={`g-intent-hub__control g-intent-hub__control--end ${confirmEnd ? 'is-armed' : ''}`}
                  onClick={() => { if (confirmEnd) { onEndIntent(); } else { hapticLight(); setConfirmEnd(true); } }}
                >
                  <Power className="w-[18px] h-[18px]" /><span>{confirmEnd ? 'Tap to end' : 'End'}</span>
                </button>
              )}
            </div>
          </>
        )}

        <div className="g-intent-hub__map-note">
          <Radio className="w-3.5 h-3.5" />
          <span>The map stays live behind this panel — your intent controls what you send and what you discover.</span>
        </div>

        {!hasActive && (
          <button type="button" className="g-intent-hub__quick" onClick={() => { hapticLight(); onCreateIntent(null); }}>
            <Plus className="w-4 h-4" /> Create an intent
          </button>
        )}
      </section>
      )}
    </div>
  );
};
