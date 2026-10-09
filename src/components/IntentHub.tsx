import React from 'react';
import { Clock3, EyeOff, Plus, Radio, Sparkles, UsersRound, X } from 'lucide-react';
import type { TopLevelIntentMode, UserActiveIntent } from '../types';
import { hapticLight } from '../services/hapticService';

interface IntentHubProps {
  isOpen: boolean;
  activeIntent?: UserActiveIntent | null;
  remainingMinutes?: number;
  onClose: () => void;
  onCreateIntent: (mode?: TopLevelIntentMode | null) => void;
  onManageIntent: () => void;
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
}) => {
  if (!isOpen) return null;

  const hasActive = Boolean(activeIntent);
  const isPrivate = activeIntent?.mode === 'private';

  return (
    <div
      className="g-intent-hub"
      role="dialog"
      aria-modal="true"
      aria-label="GAYZE intents"
      onClick={onClose}
    >
      <div className="g-intent-hub__scrim" aria-hidden="true" />

      <section
        className={`g-intent-hub__sheet ${hasActive ? 'g-intent-hub__sheet--live g-intent-hub__sheet--status' : ''}`}
        onClick={(event) => event.stopPropagation()}
      >
        <div className="g-intent-hub__grip" />

        <header className="g-intent-hub__header">
          <div className="g-intent-hub__heading">
            <span className="g-intent-hub__eyebrow">GAYZE · INTENTS</span>
            <h2>{hasActive ? 'Your intent is live' : 'What do you want to do?'}</h2>
            <p>
              {hasActive
                ? 'Your signal is visible on the map. You can manage it or create a new one.'
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
            <button type="button" className="g-intent-hub__manage" onClick={() => { hapticLight(); onManageIntent(); }}>
              Manage
            </button>
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
    </div>
  );
};
