import React, { useState } from 'react';
import { Mail, Lock, ArrowRight, Loader2, ShieldCheck, ArrowLeft } from 'lucide-react';
import { getAuthRedirectUrl, supabase } from '../services/supabaseClient';
import { analytics } from '../services/analyticsService';

export type AuthMode = 'signin' | 'signup' | 'forgot' | 'reset' | 'confirm_pending';

interface AuthViewProps {
  onAuthenticated: () => void;
  /** Forced mode from App (e.g. password recovery callback). */
  forcedMode?: AuthMode | null;
  /** Email shown on confirmation-pending screen. */
  pendingEmail?: string | null;
  onClearForcedMode?: () => void;
  onPasswordResetComplete?: () => void;
}

const NEUTRAL_RESET_SUCCESS =
  "Check your email. If an account exists for this address, we've sent instructions to reset your password.";

export const AuthView: React.FC<AuthViewProps> = ({
  onAuthenticated,
  forcedMode = null,
  pendingEmail = null,
  onClearForcedMode,
  onPasswordResetComplete,
}) => {
  const [mode, setMode] = useState<AuthMode>(forcedMode || 'signin');
  const [email, setEmail] = useState(pendingEmail || '');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [messageTone, setMessageTone] = useState<'error' | 'success' | 'info'>('info');

  React.useEffect(() => {
    if (forcedMode) {
      setMode(forcedMode);
      setMessage(null);
    }
  }, [forcedMode]);

  React.useEffect(() => {
    if (pendingEmail) setEmail(pendingEmail);
  }, [pendingEmail]);

  const goMode = (next: AuthMode) => {
    setMode(next);
    setMessage(null);
    setPassword('');
    setConfirmPassword('');
    if (next !== 'confirm_pending' && next !== 'reset') {
      onClearForcedMode?.();
    }
  };

  const setFeedback = (text: string, tone: 'error' | 'success' | 'info' = 'info') => {
    setMessage(text);
    setMessageTone(tone);
  };

  const submitSignIn = async () => {
    if (!supabase) return;
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
    const { data, error } = await supabase.auth.signUp({
      email: email.trim(),
      password,
      options: {
        data: { display_name: displayName.trim() || 'Gayze User' },
        emailRedirectTo: getAuthRedirectUrl('/'),
      },
    });
    if (error) throw error;
    analytics.logEvent('signup_completed');
    if (data.session) {
      onAuthenticated();
    } else {
      setFeedback(
        'Confirm your email to finish creating your account. We sent a link to the address below.',
        'success',
      );
      setMode('confirm_pending');
    }
  };

  const submitForgot = async () => {
    if (!supabase) return;
    const trimmed = email.trim();
    if (!trimmed) {
      setFeedback('Enter the email address for your account.', 'error');
      return;
    }
    const { error } = await supabase.auth.resetPasswordForEmail(trimmed, {
      redirectTo: getAuthRedirectUrl('/'),
    });
    // Always show a neutral success message — do not reveal account existence.
    if (error) {
      console.warn('[GAYZE] Password recovery request error:', error.message);
    }
    setFeedback(NEUTRAL_RESET_SUCCESS, 'success');
  };

  const submitReset = async () => {
    if (!supabase) return;
    if (password.length < 8) {
      setFeedback('Password must be at least 8 characters.', 'error');
      return;
    }
    if (password !== confirmPassword) {
      setFeedback('Passwords do not match.', 'error');
      return;
    }
    const { data: sessionData, error: sessionError } = await supabase.auth.getSession();
    if (sessionError || !sessionData.session) {
      setFeedback(
        'This reset link is invalid or has expired. Request a new password reset email.',
        'error',
      );
      return;
    }
    const { error } = await supabase.auth.updateUser({ password });
    if (error) throw error;
    setFeedback('Password updated. You can continue into GAYZE.', 'success');
    analytics.logEvent('login_completed');
    onPasswordResetComplete?.();
    onAuthenticated();
  };

  const resendConfirmation = async () => {
    if (!supabase) return;
    const trimmed = email.trim();
    if (!trimmed) {
      setFeedback('Enter your email address to resend the confirmation link.', 'error');
      return;
    }
    const { error } = await supabase.auth.resend({
      type: 'signup',
      email: trimmed,
      options: { emailRedirectTo: getAuthRedirectUrl('/') },
    });
    if (error) throw error;
    setFeedback('Confirmation email sent. Check your inbox and spam folder.', 'success');
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
      const raw = error instanceof Error ? error.message : 'Authentication failed. Please try again.';
      const lowered = raw.toLowerCase();
      if (lowered.includes('expired') || lowered.includes('invalid') || lowered.includes('otp')) {
        setFeedback(
          mode === 'reset'
            ? 'This reset link is invalid or has expired. Request a new password reset email.'
            : raw,
          'error',
        );
      } else {
        setFeedback(raw, 'error');
      }
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
      <div className="w-full max-w-md">
        <div className="mb-8 text-center">
          <div className="mx-auto mb-5 w-16 h-16 rounded-2xl bg-[#11131a] border border-white/10 flex items-center justify-center shadow-2xl">
            <div className="w-9 h-9 rounded-full border-2 border-[#6F3CC3] ring-4 ring-[#6F3CC3]/15" />
          </div>
          <h1 className="text-2xl font-semibold tracking-tight">GAYZE</h1>
          <p className="mt-2 text-sm text-zinc-400">Real Intent. Real Time.</p>
        </div>

        <div className="rounded-3xl border border-white/10 bg-[#0e1017]/95 backdrop-blur-xl p-5 sm:p-7 shadow-2xl">
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
                  className="w-full h-12 rounded-xl bg-[#090a0f] border border-white/10 px-4 text-sm text-white placeholder:text-zinc-600 outline-none focus:border-[#6F3CC3]/70"
                />
              </label>
            )}

            {(mode === 'signin' || mode === 'signup' || mode === 'forgot' || mode === 'confirm_pending') && (
              <label className="relative block">
                <Mail className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 text-zinc-500" />
                <input
                  required={mode !== 'confirm_pending' || !email.trim()}
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="Email address"
                  autoComplete="email"
                  readOnly={mode === 'confirm_pending' && Boolean(pendingEmail)}
                  className="w-full h-12 rounded-xl bg-[#090a0f] border border-white/10 pl-11 pr-4 text-sm text-white placeholder:text-zinc-600 outline-none focus:border-[#6F3CC3]/70 read-only:opacity-80"
                />
              </label>
            )}

            {(mode === 'signin' || mode === 'signup' || mode === 'reset') && (
              <label className="relative block">
                <Lock className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 text-zinc-500" />
                <input
                  required
                  minLength={8}
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder={mode === 'reset' ? 'New password' : 'Password'}
                  autoComplete={mode === 'signin' ? 'current-password' : 'new-password'}
                  className="w-full h-12 rounded-xl bg-[#090a0f] border border-white/10 pl-11 pr-4 text-sm text-white placeholder:text-zinc-600 outline-none focus:border-[#6F3CC3]/70"
                />
              </label>
            )}

            {mode === 'reset' && (
              <label className="relative block">
                <Lock className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 text-zinc-500" />
                <input
                  required
                  minLength={8}
                  type="password"
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  placeholder="Confirm new password"
                  autoComplete="new-password"
                  className="w-full h-12 rounded-xl bg-[#090a0f] border border-white/10 pl-11 pr-4 text-sm text-white placeholder:text-zinc-600 outline-none focus:border-[#6F3CC3]/70"
                />
              </label>
            )}

            {message && (
              <div className={`rounded-xl border px-3.5 py-3 text-xs ${messageClass}`}>
                {message}
              </div>
            )}

            <button
              type="submit"
              disabled={busy}
              className="w-full h-12 rounded-xl bg-[#6F3CC3] hover:bg-[#7b46d2] disabled:opacity-50 text-white font-semibold text-sm flex items-center justify-center gap-2 transition-colors"
            >
              {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <ArrowRight className="w-4 h-4" />}
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
              {mode === 'reset' && messageTone === 'error' && (
                <button
                  type="button"
                  onClick={() => goMode('forgot')}
                  className="text-[#c9a24d] hover:text-white font-semibold"
                >
                  Request another reset link
                </button>
              )}
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

          <div className="mt-6 pt-5 border-t border-white/[0.07] flex items-start gap-2.5 text-[10px] leading-relaxed text-zinc-500">
            <ShieldCheck className="w-4 h-4 text-emerald-400 shrink-0 mt-0.5" />
            <span>Location is requested only after sign-in and is used to centre your map and power proximity discovery. Other users see privacy-protected intent locations, not your exact GPS position.</span>
          </div>
        </div>
      </div>
    </div>
  );
};
