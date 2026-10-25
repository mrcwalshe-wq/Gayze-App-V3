import React, { useCallback, useEffect, useRef, useState } from 'react';
import { AlertTriangle, Loader2, RefreshCw, ShieldAlert, X } from 'lucide-react';
import { getAuthRedirectUrl, supabase } from '../../services/supabaseClient';
import { AdminApiError } from '../../services/adminApi';

export const fmt = (iso: string | null | undefined) => (iso ? new Date(iso).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' }) : '—');
export const num = (n: number | null | undefined) => (typeof n === 'number' ? n.toLocaleString() : null);

/** Turns a failed call into words a person can act on. Never shows server internals. */
export const humanise = (e: unknown): string => {
  if (!(e instanceof AdminApiError)) return 'Something went wrong. Try again.';
  switch (e.code) {
    case 'network': return e.message;
    case 'rate_limited': return 'Too many requests. Wait a moment and try again.';
    case 'invalid_request': return e.message;
    case 'conflict': return e.message;
    case 'not_found': return e.message;
    case 'reauth_required': return 'For safety, sign in again to continue.';
    case 'unauthenticated': return 'Your session has ended. Sign in again.';
    default: return 'The request could not be completed. Try again shortly.';
  }
};

export function useAsync<T>(fn: () => Promise<T>, deps: React.DependencyList) {
  const [state, setState] = useState<{ loading: boolean; data: T | null; error: unknown }>({ loading: true, data: null, error: null });
  const seq = useRef(0);
  const run = useCallback(() => {
    const id = ++seq.current;
    setState((s) => ({ ...s, loading: true, error: null }));
    fn().then((data) => { if (id === seq.current) setState({ loading: false, data, error: null }); })
      .catch((error) => { if (id === seq.current) setState({ loading: false, data: null, error }); });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
  useEffect(() => { run(); }, [run]);
  return { ...state, reload: run };
}

export const Spinner: React.FC<{ label?: string }> = ({ label = 'Loading' }) => (
  <div className="ga-state" role="status"><Loader2 className="ga-spin" aria-hidden="true" /><span>{label}…</span></div>
);
export const ErrorState: React.FC<{ error: unknown; onRetry?: () => void }> = ({ error, onRetry }) => (
  <div className="ga-state ga-state--error" role="alert">
    <AlertTriangle aria-hidden="true" /><span>{humanise(error)}</span>
    {onRetry && <button type="button" className="ga-btn" onClick={onRetry}><RefreshCw aria-hidden="true" />Retry</button>}
  </div>
);
export const Empty: React.FC<{ children: React.ReactNode }> = ({ children }) => <div className="ga-state ga-state--empty">{children}</div>;

export const Pill: React.FC<{ tone?: 'ok' | 'warn' | 'bad' | 'muted' | 'purple'; children: React.ReactNode }> = ({ tone = 'muted', children }) => (
  <span className={`ga-pill ga-pill--${tone}`}>{children}</span>
);

/** Re-authentication banner for sensitive actions. */
export const ReauthBar: React.FC = () => {
  const go = async () => {
    if (!supabase) return;
    await supabase.auth.signInWithOAuth({ provider: 'google', options: { redirectTo: getAuthRedirectUrl('/admin'), queryParams: { prompt: 'login' } } });
  };
  return (
    <div className="ga-reauth" role="alert">
      <ShieldAlert aria-hidden="true" />
      <p>This action needs a fresh sign-in. Confirm it is you, then repeat the action.</p>
      <button type="button" className="ga-btn ga-btn--primary" onClick={() => void go()}>Sign in again</button>
    </div>
  );
};

/** Modal dialog with focus handling and Escape to close. */
export const Dialog: React.FC<{ title: string; onClose: () => void; children: React.ReactNode; wide?: boolean }> = ({ title, onClose, children, wide }) => {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    ref.current?.focus();
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', onKey);
    return () => { document.removeEventListener('keydown', onKey); previous?.focus?.(); };
  }, [onClose]);
  return (
    <div className="ga-scrim" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className={`ga-dialog${wide ? ' ga-dialog--wide' : ''}`} role="dialog" aria-modal="true" aria-label={title} tabIndex={-1} ref={ref}>
        <header><h3>{title}</h3><button type="button" className="ga-icon" onClick={onClose} aria-label="Close"><X aria-hidden="true" /></button></header>
        <div className="ga-dialog__body">{children}</div>
      </div>
    </div>
  );
};

/* ------------------------------------------------------------------ Dashboard */

export const Stat: React.FC<{ label: string; value: number | null | undefined; hint?: string }> = ({ label, value, hint }) => {
  const v = num(value);
  return (
    <div className="ga-stat">
      <span className="ga-stat__label">{label}</span>
      <strong className={v === null ? 'is-na' : ''}>{v ?? 'Unavailable'}</strong>
      {hint && <small>{hint}</small>}
    </div>
  );
};

