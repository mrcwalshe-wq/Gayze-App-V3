import React, { useState } from 'react';
import { ShieldCheck, Lock, EyeOff } from 'lucide-react';
import { hapticLight } from '../services/hapticService';

interface Props {
  /** True when the person had agreed before and has withdrawn. */
  withdrawn?: boolean;
  onAgree: () => Promise<boolean>;
  onDecline: () => void;
}

/** Asked once before GAYZE is used: explicit consent to handle information that can reveal sexual orientation. Nothing is pre-ticked. */
export const ConsentGate: React.FC<Props> = ({ withdrawn, onAgree, onDecline }) => {
  const [checked, setChecked] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const agree = async () => {
    if (!checked || busy) return;
    hapticLight(); setBusy(true); setError(null);
    const ok = await onAgree();
    setBusy(false);
    if (!ok) setError('We could not save your choice. Please try again.');
  };

  return (
    <div className="cg" role="dialog" aria-modal="true" aria-labelledby="cg-title">
      <div className="cg__sheet">
        <span className="cg__icon"><ShieldCheck className="w-6 h-6" aria-hidden="true" /></span>
        <h1 id="cg-title">{withdrawn ? 'You withdrew your consent' : 'Your privacy, your choice'}</h1>
        <p>GAYZE is a dating and social app. Using it, and the profile and preferences you add, can reveal or let others work out your <strong>sexual orientation</strong>. That counts as sensitive information under UK data protection law, so we need your clear permission before we handle it.</p>
        <ul>
          <li><Lock className="w-4 h-4" aria-hidden="true" /><span>Your messages are end-to-end encrypted. We cannot read them.</span></li>
          <li><EyeOff className="w-4 h-4" aria-hidden="true" /><span>We never sell your information or use it for advertising.</span></li>
          <li><ShieldCheck className="w-4 h-4" aria-hidden="true" /><span>You can withdraw this or delete your account at any time in Profile.</span></li>
        </ul>
        <label className="cg__check">
          <input type="checkbox" checked={checked} onChange={(e) => setChecked(e.target.checked)} />
          <span>I agree that GAYZE may process information that can reveal my sexual orientation, as described in the <a href="/privacy.html" target="_blank" rel="noreferrer">Privacy Policy</a>.</span>
        </label>
        {error && <p role="alert" className="cg__err">{error}</p>}
        <button type="button" className="cg__go" disabled={!checked || busy} onClick={() => void agree()}>{busy ? 'Saving…' : 'Agree and continue'}</button>
        <button type="button" className="cg__no" onClick={() => { hapticLight(); onDecline(); }}>I do not agree. Sign me out.</button>
      </div>
    </div>
  );
};
