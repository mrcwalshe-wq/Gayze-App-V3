import React, { useState } from 'react';
import { Mail, Lock, ArrowRight, Loader2, ShieldCheck } from 'lucide-react';
import { supabase } from '../services/supabaseClient';
import { analytics } from '../services/analyticsService';

interface AuthViewProps {
  onAuthenticated: () => void;
}

export const AuthView: React.FC<AuthViewProps> = ({ onAuthenticated }) => {
  const [mode, setMode] = useState<'signin' | 'signup'>('signin');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!supabase || busy) return;
    setBusy(true);
    setMessage(null);

    try {
      if (mode === 'signup') {
        const { data, error } = await supabase.auth.signUp({
          email: email.trim(),
          password,
          options: { data: { display_name: displayName.trim() || 'Gayze User' } },
        });
        if (error) throw error;
        if (data.session) {
          analytics.logEvent('signup_completed');
          onAuthenticated();
        } else {
          analytics.logEvent('signup_completed');
          setMessage('Account created. Check your email to confirm the account, then sign in.');
          setMode('signin');
        }
      } else {
        const { error } = await supabase.auth.signInWithPassword({
          email: email.trim(),
          password,
        });
        if (error) throw error;
        analytics.logEvent('login_completed');
        onAuthenticated();
      }
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Authentication failed. Please try again.');
    } finally {
      setBusy(false);
    }
  };

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
            <h2 className="text-lg font-semibold">{mode === 'signin' ? 'Sign in' : 'Create your account'}</h2>
            <p className="mt-1 text-xs text-zinc-500">
              {mode === 'signin'
                ? 'Sign in to use live location, discovery and encrypted chat.'
                : 'Your account keeps your GAYZE identity and conversations connected across sessions.'}
            </p>
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

            <label className="relative block">
              <Mail className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 text-zinc-500" />
              <input
                required
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="Email address"
                autoComplete="email"
                className="w-full h-12 rounded-xl bg-[#090a0f] border border-white/10 pl-11 pr-4 text-sm text-white placeholder:text-zinc-600 outline-none focus:border-[#6F3CC3]/70"
              />
            </label>

            <label className="relative block">
              <Lock className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 text-zinc-500" />
              <input
                required
                minLength={8}
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="Password"
                autoComplete={mode === 'signin' ? 'current-password' : 'new-password'}
                className="w-full h-12 rounded-xl bg-[#090a0f] border border-white/10 pl-11 pr-4 text-sm text-white placeholder:text-zinc-600 outline-none focus:border-[#6F3CC3]/70"
              />
            </label>

            {message && (
              <div className="rounded-xl border border-amber-400/20 bg-amber-400/5 px-3.5 py-3 text-xs text-amber-200">
                {message}
              </div>
            )}

            <button
              type="submit"
              disabled={busy}
              className="w-full h-12 rounded-xl bg-[#6F3CC3] hover:bg-[#7b46d2] disabled:opacity-50 text-white font-semibold text-sm flex items-center justify-center gap-2 transition-colors"
            >
              {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <ArrowRight className="w-4 h-4" />}
              {mode === 'signin' ? 'Sign in' : 'Create account'}
            </button>
          </form>

          <div className="mt-5 flex items-center justify-center gap-1 text-xs text-zinc-500">
            <span>{mode === 'signin' ? "Don't have an account?" : 'Already have an account?'}</span>
            <button
              type="button"
              onClick={() => { setMode(mode === 'signin' ? 'signup' : 'signin'); setMessage(null); }}
              className="text-[#c9a24d] hover:text-white font-semibold"
            >
              {mode === 'signin' ? 'Create one' : 'Sign in'}
            </button>
          </div>

          <div className="mt-6 pt-5 border-t border-white/[0.07] flex items-start gap-2.5 text-[10px] leading-relaxed text-zinc-500">
            <ShieldCheck className="w-4 h-4 text-emerald-400 shrink-0 mt-0.5" />
            <span>Location is requested only after sign-in and is used to centre your map and power proximity discovery. Other users see privacy-protected intent locations, not your exact GPS position.</span>
          </div>
        </div>
      </div>
    </div>
  );
};
