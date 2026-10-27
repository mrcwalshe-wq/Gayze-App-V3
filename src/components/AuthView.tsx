import React, { useState } from 'react';
import { Mail, Lock, ArrowRight, Loader2, ShieldCheck, ArrowLeft, Eye, EyeOff } from 'lucide-react';
import { AUTH_REDIRECT_PATHS, getAuthRedirectUrl, supabase } from '../services/supabaseClient';
import { analytics } from '../services/analyticsService';
import { isNativeApp, startNativeGoogleSignIn } from '../services/nativeAuth';
import { checkPassword, describeAuthError, isPlausibleEmail, type AuthContext, type AuthIssue } from '../services/authMessages';

/** The multi-colour Google "G", as required by Google's sign-in branding guidelines. */
const GoogleG: React.FC = () => (
  <svg width="18" height="18" viewBox="0 0 48 48" aria-hidden="true" focusable="false">
    <path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z" />
    <path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z" />
    <path fill="#FBBC05" d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z" />
    <path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z" />
  </svg>
);

export type AuthMode = 'signin' | 'signup' | 'forgot' | 'reset' | 'confirm_pending';

interface AuthViewProps {
  onAuthenticated: () => void;
  /** Forced mode from App (e.g. password recovery callback). */
  forcedMode?: AuthMode | null;
  /** Email shown on confirmation-pending screen. */
  pendingEmail?: string | null;
  onClearForcedMode?: () => void;
  onPasswordResetComplete?: () => void;
  /** Something the person should know on arrival (expired link, cancelled Google, suspended, signed out). */
  notice?: AuthIssue | { kind: 'info' | 'signed_out' | 'suspended'; message: string; action?: undefined } | null;
}

const NEUTRAL_RESET_SUCCESS =
  "Check your email. If an account exists for this address, we've sent instructions to reset your password.";

export const AuthView: React.FC<AuthViewProps> = ({
  onAuthenticated,
  forcedMode = null,
  pendingEmail = null,
  onClearForcedMode,
  onPasswordResetComplete,
  notice = null,
}) => {
  const [mode, setMode] = useState<AuthMode>(forcedMode || 'signin');
  const [email, setEmail] = useState(pendingEmail || '');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [messageTone, setMessageTone] = useState<'error' | 'success' | 'info'>('info');
  const [followUp, setFollowUp] = useState<AuthIssue['action'] | null>(null);
  const [touched, setTouched] = useState<Record<string, boolean>>({});
  const [showPassword, setShowPassword] = useState(false);
  const touch = (field: string) => setTouched((t) => ({ ...t, [field]: true }));

  // Arrival notices from the callback (expired link, cancelled Google, suspended account...).
  React.useEffect(() => {
    if (!notice) return;
    setMessage(notice.message);
    setMessageTone(notice.kind === 'info' || notice.kind === 'signed_out' ? 'info' : 'error');
    setFollowUp(notice.action ?? null);
  }, [notice]);

  const emailError = touched.email && email.trim() && !isPlausibleEmail(email) ? 'Enter a valid email address.' : null;
  const passwordCheck = checkPassword(password);
  const passwordError = touched.password && mode !== 'signin' && password && !passwordCheck.ok ? passwordCheck.problems.join(' · ') : null;
  const confirmError = touched.confirm && confirmPassword && password !== confirmPassword ? 'Passwords do not match.' : null;

  React.useEffect(() => {
    if (forcedMode) {
      setMode(forcedMode);
      // Keep any arrival notice (e.g. "this link has expired") that came with the forced mode.
      if (!notice) setMessage(null);
    }
  }, [forcedMode]);

  React.useEffect(() => {
    if (pendingEmail) setEmail(pendingEmail);
  }, [pendingEmail]);

  const goMode = (next: AuthMode) => {
    setMode(next);
    setMessage(null);
    setFollowUp(null);
    setTouched({});
    setPassword('');
    setConfirmPassword('');
    if (next !== 'confirm_pending' && next !== 'reset') {
      onClearForcedMode?.();
    }
  };

  const setFeedback = (text: string, tone: 'error' | 'success' | 'info' = 'info', next: AuthIssue['action'] | null = null) => {
    setMessage(text);
    setMessageTone(tone);
    setFollowUp(next);
  };
  const fail = (error: unknown, context: AuthContext) => {
    const issue = describeAuthError(error, context);
    if (issue.kind === 'unavailable' || issue.kind === 'oauth_failed') console.warn('[GAYZE] auth issue:', issue.kind);
    setFeedback(issue.message, issue.kind === 'oauth_cancelled' ? 'info' : 'error', issue.action ?? null);
  };

  const submitGoogle = async () => {
    if (!supabase) return;
    setBusy(true);
    setMessage(null);
    try {
      if (isNativeApp()) {
        // Opens Google in the system browser; the gayze:// return link finishes sign-in.
        await startNativeGoogleSignIn();
        setBusy(false);
        return;
      }
      const { error } = await supabase.auth.signInWithOAuth({
        provider: 'google',
        options: { redirectTo: getAuthRedirectUrl(AUTH_REDIRECT_PATHS.home) },
      });
      if (error) throw error;
    } catch (error) {
      fail(error, 'oauth');
      setBusy(false);
    }
  };

  const submitSignIn = async () => {
    if (!supabase) return;
    if (!isPlausibleEmail(email)) { touch('email'); setFeedback('Enter a valid email address.', 'error'); return; }
    const { error } = await supabase.auth.signInWithPassword({
      email: email.trim(),
      password,
    });
    if (error) throw error;
    analytics.logEvent('login_completed');
    onAuthenticated();
  };

  const submitSignUp = async () => {
    if (!supabase) return;
    if (!checkPassword(password).ok) { touch('password'); setFeedback('Choose a stronger password to continue.', 'error'); return; }
    if (password !== confirmPassword) { touch('confirm'); setFeedback('Passwords do not match.', 'error'); return; }
    const { data, error } = await supabase.auth.signUp({
      email: email.trim(),
      password,
      options: {
        data: { display_name: displayName.trim() || 'Gayze User' },
        emailRedirectTo: getAuthRedirectUrl(AUTH_REDIRECT_PATHS.emailConfirm),
      },
    });
    if (error) throw error;
    analytics.logEvent('signup_completed');
    if (data.session) {
      onAuthenticated();
    } else {
      setFeedback(
        'Check your email to finish creating your account. If this address can be used, a link is on its way.',
        'success',
      );
      setMode('confirm_pending');
    }
  };

  const submitForgot = async () => {
    if (!supabase) return;
    const trimmed = email.trim();
    if (!isPlausibleEmail(trimmed)) {
      touch('email');
      setFeedback('Enter the email address for your account.', 'error');
      return;
    }
    const { error } = await supabase.auth.resetPasswordForEmail(trimmed, {
      redirectTo: getAuthRedirectUrl(AUTH_REDIRECT_PATHS.resetPassword),
    });
    // Always show a neutral success message — do not reveal account existence.
    if (error) {
      console.warn('[GAYZE] Password recovery request error:', error.message);
    }
    setFeedback(NEUTRAL_RESET_SUCCESS, 'success');
  };

  const submitReset = async () => {
    if (!supabase) return;
    if (!checkPassword(password).ok) {
      touch('password');
      setFeedback('Choose a stronger password to continue.', 'error');
      return;
    }
    if (password !== confirmPassword) {
      setFeedback('Passwords do not match.', 'error');
      return;
    }
    const { data: sessionData, error: sessionError } = await supabase.auth.getSession();
    if (sessionError || !sessionData.session) {
      setFeedback('This reset link has expired or was already used. Request a new one.', 'error', 'request_reset');
      return;
    }
    const { error } = await supabase.auth.updateUser({ password });
    if (error) throw error;
    setFeedback('Password updated. Taking you into GAYZE.', 'success');
    analytics.logEvent('login_completed');
    onPasswordResetComplete?.();
    onAuthenticated();
  };

  const resendConfirmation = async () => {
    if (!supabase) return;
    const trimmed = email.trim();
    if (!isPlausibleEmail(trimmed)) {
      touch('email');
      setFeedback('Enter your email address to resend the confirmation link.', 'error');
      return;
    }
    const { error } = await supabase.auth.resend({
      type: 'signup',
      email: trimmed,
      options: { emailRedirectTo: getAuthRedirectUrl(AUTH_REDIRECT_PATHS.emailConfirm) },
    });
    if (error) throw error;
    setFeedback('If this address needs confirming, a new link is on its way. Check spam too.', 'success');
  };

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!supabase || busy) return;
    setBusy(true);
    setMessage(null);

    try {
      if (mode === 'signup') await submitSignUp();
      else if (mode === 'forgot') await submitForgot();
      else if (mode === 'reset') await submitReset();
      else if (mode === 'confirm_pending') await resendConfirmation();
      else await submitSignIn();
    } catch (error) {
      fail(error, mode === 'signup' ? 'signup' : mode === 'reset' ? 'reset' : mode === 'forgot' ? 'forgot' : mode === 'confirm_pending' ? 'resend' : 'signin');
    } finally {
      setBusy(false);
    }
  };

  const title =
    mode === 'signup' ? 'Create your account'
      : mode === 'forgot' ? 'Forgot password'
        : mode === 'reset' ? 'Reset your password'
          : mode === 'confirm_pending' ? 'Confirm your email'
            : 'Sign in';

  const subtitle =
    mode === 'signup'
      ? 'Your account keeps your GAYZE identity and conversations connected across sessions.'
      : mode === 'forgot'
        ? 'Enter your email and we will send password reset instructions if an account exists.'
        : mode === 'reset'
          ? 'Choose a new password for your GAYZE account.'
          : mode === 'confirm_pending'
            ? 'Your account is not fully verified until you confirm the email we sent.'
            : 'Sign in to use live location, discovery and encrypted chat.';

  const messageClass =
    messageTone === 'error'
      ? 'border-rose-400/25 bg-rose-400/5 text-rose-200'
      : messageTone === 'success'
        ? 'border-emerald-400/25 bg-emerald-400/5 text-emerald-200'
        : 'border-amber-400/20 bg-amber-400/5 text-amber-200';

  return (
    <div className="min-h-[100dvh] bg-[#090a0f] text-white flex items-center justify-center px-5 py-10">
      <div className="g-atmos" aria-hidden="true" />
      <div className="g-shell w-full max-w-md">
        <div className="mb-8 text-center">
          <img
            src="/brand/gayze-nav-v3.svg"
            alt="GAYZE"
            width={112}
            height={56}
            className="mx-auto mb-3 block h-14 w-28 object-contain"
            draggable={false}
          />
          <h1 className="text-[22px] font-semibold tracking-[0.14em] text-white">GAYZE</h1>
          <p className="mt-1.5 text-[13px] text-zinc-400">
            <span className="text-[#b796f0]">Real Intent.</span>{' '}
            <span className="text-[#C9A24D]/90">Real Time.</span>
          </p>
        </div>

        <div className="g-panel p-5 sm:p-7 !rounded-[24px]">
          <div className="mb-6">
            <h2 className="text-lg font-semibold">{title}</h2>
            <p className="mt-1 text-xs text-zinc-500">{subtitle}</p>
            {mode === 'confirm_pending' && email.trim() && (
              <p className="mt-2 text-xs text-zinc-300 font-mono break-all">{email.trim()}</p>
            )}
          </div>

          <form onSubmit={submit} className="space-y-3.5">
            {mode === 'signup' && (
              <label className="block">
                <span className="sr-only">Display name</span>
                <input
                  value={displayName}
                  onChange={(e) => setDisplayName(e.target.value)}
                  placeholder="Display name"
                  autoComplete="name"
                  className="g-field !h-12 !rounded-xl !bg-[#0b0c12] !border-white/10 focus:!border-[#6F3CC3]/70 !text-sm"
                />
              </label>
            )}

            {(mode === 'signin' || mode === 'signup' || mode === 'forgot' || mode === 'confirm_pending') && (
              <div>
                <label className="relative block">
                  <span className="sr-only">Email address</span>
                  <Mail className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 text-zinc-500" aria-hidden="true" />
                  <input
                    required={mode !== 'confirm_pending' || !email.trim()}
                    type="email"
                    inputMode="email"
                    autoCapitalize="none"
                    spellCheck={false}
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    onBlur={() => touch('email')}
                    placeholder="Email address"
                    autoComplete="email"
                    aria-invalid={Boolean(emailError)}
                    aria-describedby={emailError ? 'auth-email-error' : undefined}
                    readOnly={mode === 'confirm_pending' && Boolean(pendingEmail)}
                    className="g-field !h-12 !rounded-xl !bg-[#0b0c12] !border-white/10 focus:!border-[#6F3CC3]/70 !text-sm !pl-11 read-only:opacity-80 aria-[invalid=true]:!border-rose-400/60"
                  />
                </label>
                {emailError && <p id="auth-email-error" className="mt-1.5 text-[11px] text-rose-300">{emailError}</p>}
              </div>
            )}

            {(mode === 'signin' || mode === 'signup' || mode === 'reset') && (
              <div>
                <label className="relative block">
                  <span className="sr-only">{mode === 'reset' ? 'New password' : 'Password'}</span>
                  <Lock className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 text-zinc-500" aria-hidden="true" />
                  <input
                    required
                    minLength={8}
                    type={showPassword ? 'text' : 'password'}
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    onBlur={() => touch('password')}
                    placeholder={mode === 'reset' ? 'New password' : 'Password'}
                    autoComplete={mode === 'signin' ? 'current-password' : 'new-password'}
                    aria-invalid={Boolean(passwordError)}
                    aria-describedby={passwordError ? 'auth-password-error' : undefined}
                    className="g-field !h-12 !rounded-xl !bg-[#0b0c12] !border-white/10 focus:!border-[#6F3CC3]/70 !text-sm !pl-11 !pr-12 aria-[invalid=true]:!border-rose-400/60"
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword((v) => !v)}
                    aria-label={showPassword ? 'Hide password' : 'Show password'}
                    aria-pressed={showPassword}
                    className="absolute right-1 top-1/2 -translate-y-1/2 w-11 h-11 grid place-items-center text-zinc-500 hover:text-white"
                  >
                    {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                  </button>
                </label>
                {passwordError && <p id="auth-password-error" className="mt-1.5 text-[11px] text-rose-300">{passwordError}</p>}
                {mode !== 'signin' && !passwordError && <p className="mt-1.5 text-[11px] text-zinc-500">At least 8 characters, with letters and numbers.</p>}
              </div>
            )}

            {(mode === 'reset' || mode === 'signup') && (
              <div>
                <label className="relative block">
                  <span className="sr-only">{mode === 'reset' ? 'Confirm new password' : 'Confirm password'}</span>
                  <Lock className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 text-zinc-500" aria-hidden="true" />
                  <input
                    required
                    minLength={8}
                    type={showPassword ? 'text' : 'password'}
                    value={confirmPassword}
                    onChange={(e) => setConfirmPassword(e.target.value)}
                    onBlur={() => touch('confirm')}
                    placeholder={mode === 'reset' ? 'Confirm new password' : 'Confirm password'}
                    autoComplete="new-password"
                    aria-invalid={Boolean(confirmError)}
                    aria-describedby={confirmError ? 'auth-confirm-error' : undefined}
                    className="g-field !h-12 !rounded-xl !bg-[#0b0c12] !border-white/10 focus:!border-[#6F3CC3]/70 !text-sm !pl-11 aria-[invalid=true]:!border-rose-400/60"
                  />
                </label>
                {confirmError && <p id="auth-confirm-error" className="mt-1.5 text-[11px] text-rose-300">{confirmError}</p>}
              </div>
            )}

            <div aria-live="polite" role={messageTone === 'error' ? 'alert' : 'status'}>
              {message && (
                <div className={`rounded-xl border px-3.5 py-3 text-xs ${messageClass}`}>
                  <p>{message}</p>
                  {followUp === 'resend' && (
                    <button type="button" className="mt-2 font-semibold text-[#c9a24d] hover:text-white underline underline-offset-4" onClick={() => goMode('confirm_pending')}>Send the confirmation link again</button>
                  )}
                  {followUp === 'request_reset' && (
                    <button type="button" className="mt-2 font-semibold text-[#c9a24d] hover:text-white underline underline-offset-4" onClick={() => goMode('forgot')}>Request a new reset link</button>
                  )}
                </div>
              )}
            </div>

            <button
              type="submit"
              disabled={busy}
              className="g-btn g-btn--primary w-full !h-12 !rounded-xl !text-sm font-semibold !gap-2"
            >
              {busy ? <Loader2 className="w-4 h-4 animate-spin" aria-hidden="true" /> : <ArrowRight className="w-4 h-4" aria-hidden="true" />}
              {mode === 'signin' && 'Sign in'}
              {mode === 'signup' && 'Create account'}
              {mode === 'forgot' && 'Send reset link'}
              {mode === 'reset' && 'Update password'}
              {mode === 'confirm_pending' && 'Resend confirmation email'}
            </button>
          </form>

          {mode === 'signin' && (
            <div className="mt-4 text-center">
              <button
                type="button"
                onClick={() => goMode('forgot')}
                className="text-xs text-[#c9a24d] hover:text-white font-semibold"
              >
                Forgot password?
              </button>
            </div>
          )}

          {(mode === 'forgot' || mode === 'confirm_pending' || mode === 'reset') && (
            <div className="mt-5 flex flex-col items-center gap-2 text-xs text-zinc-500">
              <button
                type="button"
                onClick={() => goMode('signin')}
                className="inline-flex items-center gap-1.5 text-[#c9a24d] hover:text-white font-semibold"
              >
                <ArrowLeft className="w-3.5 h-3.5" />
                Return to sign in
              </button>
            </div>
          )}


          {(mode === 'signin' || mode === 'signup') && (
            <>
              <div className="my-5 flex items-center gap-3 text-[10px] uppercase tracking-[0.16em] text-zinc-600">
                <span className="h-px flex-1 bg-white/[0.07]" />
                <span>or</span>
                <span className="h-px flex-1 bg-white/[0.07]" />
              </div>
              <button
                type="button"
                disabled={busy}
                onClick={() => void submitGoogle()}
                className="w-full h-12 rounded-xl bg-white text-[#1f1f1f] border border-[#747775] hover:bg-zinc-100 disabled:opacity-50 font-medium text-sm flex items-center justify-center gap-2.5 transition-colors"
              >
                {busy ? <Loader2 className="w-[18px] h-[18px] animate-spin" aria-hidden="true" /> : <GoogleG />}
                {mode === 'signup' ? 'Sign up with Google' : 'Sign in with Google'}
              </button>
            </>
          )}

          {mode === 'signup' && (
            <p className="mt-4 text-center text-[11px] leading-relaxed text-zinc-500">
              By creating an account or continuing with Google you agree to the{' '}
              <a href="/terms.html" className="underline underline-offset-4 hover:text-[#c9a24d]">Terms</a>,{' '}
              <a href="/privacy.html" className="underline underline-offset-4 hover:text-[#c9a24d]">Privacy Policy</a> and{' '}
              <a href="/community-guidelines.html" className="underline underline-offset-4 hover:text-[#c9a24d]">Community Guidelines</a>.
            </p>
          )}

          {(mode === 'signin' || mode === 'signup') && (
            <div className="mt-5 flex items-center justify-center gap-1 text-xs text-zinc-500">
              <span>{mode === 'signin' ? "Don't have an account?" : 'Already have an account?'}</span>
              <button
                type="button"
                onClick={() => goMode(mode === 'signin' ? 'signup' : 'signin')}
                className="text-[#c9a24d] hover:text-white font-semibold"
              >
                {mode === 'signin' ? 'Create one' : 'Sign in'}
              </button>
            </div>
          )}

          <div className="mt-5 flex flex-wrap justify-center gap-x-3 gap-y-2 text-xs text-zinc-500"><a href="/privacy.html" className="underline underline-offset-4 decoration-white/20 hover:text-[#c9a24d]">Privacy</a><a href="/terms.html" className="underline underline-offset-4 decoration-white/20 hover:text-[#c9a24d]">Terms</a><a href="/community-guidelines.html" className="underline underline-offset-4 decoration-white/20 hover:text-[#c9a24d]">Community Guidelines</a><a href="/safety.html" className="underline underline-offset-4 decoration-white/20 hover:text-[#c9a24d]">Safety</a><a href="/legal.html" className="underline underline-offset-4 decoration-white/20 hover:text-[#c9a24d]">All policies</a></div>

          <div className="mt-6 pt-5 border-t border-white/[0.07] flex items-start gap-2.5 text-[10px] leading-relaxed text-zinc-500">
            <ShieldCheck className="w-4 h-4 text-emerald-400 shrink-0 mt-0.5" />
            <span>Location is requested only after sign-in and is used to centre your map and power proximity discovery. Other users see privacy-protected intent locations, not your exact GPS position.</span>
          </div>
        </div>
      </div>
    </div>
  );
};
