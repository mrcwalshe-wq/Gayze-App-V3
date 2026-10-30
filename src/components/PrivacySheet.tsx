import React, { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { Eye, MessageCircle, Radar, Clock, X } from 'lucide-react';
import { DEFAULT_PRIVACY, loadPrivacySettings, savePrivacySettings, type PrivacySettings } from '../services/serverPresence';

interface PrivacySheetProps { isOpen: boolean; onClose: () => void; userId: string | null }

const Row: React.FC<{ icon: React.ReactNode; title: string; body: string; on: boolean; onToggle: () => void }> = ({ icon, title, body, on, onToggle }) => (
  <div className="g-priv__row">
    <span className="g-priv__icon" aria-hidden="true">{icon}</span>
    <div><strong>{title}</strong><p>{body}</p></div>
    <button type="button" role="switch" aria-checked={on} aria-label={title} className="g-plan__switch" onClick={onToggle}><i /></button>
  </div>
);

/** Who can see that you are online, when you were last here, who can message you, and whether you appear in Discover. */
export const PrivacySheet: React.FC<PrivacySheetProps> = ({ isOpen, onClose, userId }) => {
  const [s, setS] = useState<PrivacySettings>(DEFAULT_PRIVACY);
  const [state, setState] = useState<'loading' | 'ready' | 'error'>('loading');
  const [saveError, setSaveError] = useState(false);

  useEffect(() => {
    if (!isOpen || !userId) return;
    let live = true;
    setState('loading');
    loadPrivacySettings(userId).then((v) => { if (live) { setS(v); setState('ready'); } }, () => { if (live) setState('error'); });
    return () => { live = false; };
  }, [isOpen, userId]);

  if (!isOpen) return null;
  const update = async (patch: Partial<PrivacySettings>) => {
    if (!userId) return;
    const prev = s, next = { ...s, ...patch };
    setS(next); setSaveError(false);
    if (!(await savePrivacySettings(userId, next))) { setS(prev); setSaveError(true); }
  };

  return createPortal(
    <div className="g-plan" role="dialog" aria-modal="true" aria-label="Privacy and visibility" onClick={onClose}>
      <div className="g-plan__sheet" onClick={(e) => e.stopPropagation()}>
        <span className="g-plan__grip" aria-hidden="true" />
        <header className="g-plan__head">
          <span className="g-plan__badge"><Eye className="w-5 h-5" /></span>
          <div className="g-plan__title"><small>Privacy</small><h3>Who sees what</h3></div>
          <button type="button" className="g-plan__close" onClick={onClose} aria-label="Close"><X className="w-4 h-4" /></button>
        </header>
        <div className="g-plan__body">
          {state === 'loading' && <p className="g-plan__note">Loading your settings…</p>}
          {state === 'error' && <p className="g-plan__note">Couldn't load your settings. Try again in a moment.</p>}
          {state === 'ready' && (<>
            <Row icon={<Radar className="w-4 h-4" />} title="Show when I'm online" body="Turn off to appear offline to everyone. You can still use GAYZE normally." on={s.showOnlineStatus} onToggle={() => void update({ showOnlineStatus: !s.showOnlineStatus })} />
            <Row icon={<Clock className="w-4 h-4" />} title="Show when I was last here" body="Hide your last-seen time while still showing you're online." on={s.showLastSeen} onToggle={() => void update({ showLastSeen: !s.showLastSeen })} />
            <Row icon={<Eye className="w-4 h-4" />} title="Appear in Discover" body="Turn off to stop appearing to people you haven't spoken to." on={s.discoverable} onToggle={() => void update({ discoverable: !s.discoverable })} />
            <Row icon={<MessageCircle className="w-4 h-4" />} title="Only connections can message me" body="People you've never chatted with would need to connect first." on={s.whoCanMessage === 'connections'} onToggle={() => void update({ whoCanMessage: s.whoCanMessage === 'connections' ? 'everyone' : 'connections' })} />
            {saveError && <p className="g-plan__note g-plan__note--warn">That change wasn't saved. Please try again.</p>}
          </>)}
        </div>
      </div>
    </div>,
    document.body,
  );
};
