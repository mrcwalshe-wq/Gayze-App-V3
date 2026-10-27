import { useCallback, useEffect, useState } from 'react';
import { Loader2, ShieldCheck } from 'lucide-react';
import { checkAgeVerification, startAgeVerification, type AgeVerificationStatus } from '../services/ageVerification';

interface AgeGateProps {
  initialStatus: AgeVerificationStatus;
  onVerified: () => void;
  onSignOut?: () => void;
}

/**
 * Blocks the app until the member passes a Yoti age check (selfie age estimate, ID as fallback).
 * Checks again whenever the member returns to the app, since Yoti finishes in another window.
 */
export function AgeGate({ initialStatus, onVerified, onSignOut }: AgeGateProps) {
  const [status, setStatus] = useState<AgeVerificationStatus>(initialStatus);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const check = useCallback(async (quiet = false) => {
    if (!quiet) setBusy(true);
    try {
      const next = await checkAgeVerification();
      setStatus(next);
      if (next === 'verified') onVerified();
    } catch (e) {
      if (!quiet) setError(e instanceof Error ? e.message : 'Could not check your age verification.');
    } finally {
      if (!quiet) setBusy(false);
    }
  }, [onVerified]);

  // Returning from Yoti (web redirect or closing the in-app browser).
  useEffect(() => {
    if (status !== 'pending') return;
    void check(true);
    const onVisible = () => { if (document.visibilityState === 'visible') void check(true); };
    document.addEventListener('visibilitychange', onVisible);
    return () => document.removeEventListener('visibilitychange', onVisible);
  }, [status, check]);

  const start = async () => {
    setBusy(true);
    setError('');
    try {
      const next = await startAgeVerification();
      setStatus(next);
      if (next === 'verified') onVerified();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not start age verification.');
    } finally {
      setBusy(false);
    }
  };

  const failed = status === 'failed';

  return (
    <div className="fixed inset-0 z-[130] bg-[#090a0f]/98 backdrop-blur-xl overflow-y-auto px-4 py-8">
      <div className="mx-auto w-full max-w-lg g-panel !rounded-[26px] p-5 sm:p-7">
        <div className="text-[10px] uppercase tracking-[0.18em] text-[#C9A24D] font-semibold">18+ only</div>
        <h1 className="mt-2 text-2xl font-semibold">{failed ? 'We could not confirm you are 18+' : 'Confirm your age'}</h1>
        <p className="mt-1.5 text-sm text-zinc-400">
          {failed
            ? 'The check did not confirm that you are 18 or over. If you are an adult, you can try again and use an ID document instead.'
            : 'GAYZE is for adults. Take a quick selfie so Yoti can estimate your age, or use an ID document. It takes about a minute.'}
        </p>
        <ul className="mt-4 space-y-2 text-xs text-zinc-400">
          <li>GAYZE never sees or stores your selfie or ID. Yoti checks it and tells us only whether you are over 18.</li>
          <li>Yoti deletes the selfie straight after estimating your age.</li>
        </ul>
        {error && <div className="mt-4 rounded-xl border border-rose-400/25 bg-rose-400/5 px-3 py-2.5 text-xs text-rose-200">{error}</div>}
        <button type="button" onClick={start} disabled={busy} className="mt-5 w-full h-12 rounded-xl bg-[#6F3CC3] hover:bg-[#7b46d2] disabled:opacity-40 text-white font-semibold flex items-center justify-center gap-2">
          {busy ? <Loader2 className="w-4 h-4 animate-spin" aria-hidden="true" /> : <ShieldCheck className="w-4 h-4" aria-hidden="true" />}
          {failed ? 'Try again' : status === 'pending' ? 'Restart age check' : 'Verify my age'}
        </button>
        {status === 'pending' && (
          <button type="button" onClick={() => void check()} disabled={busy} className="mt-2 w-full h-11 rounded-xl border border-white/10 text-sm text-zinc-200 hover:bg-white/5 disabled:opacity-40">
            I have finished, check now
          </button>
        )}
        {onSignOut && (
          <button type="button" onClick={onSignOut} className="mt-3 w-full text-xs text-zinc-500 underline underline-offset-4">Sign out</button>
        )}
      </div>
    </div>
  );
}
