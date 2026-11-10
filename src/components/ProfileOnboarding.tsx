import React, { useMemo, useState } from 'react';
import { intentDisplayLabel } from '../services/intentLabels';
import { ArrowRight, Check, ShieldCheck } from 'lucide-react';
import type { LocationPrivacy, UserProfile } from '../types';
import { LOOKING_FOR_OPTIONS } from '../config/profileOptions';
import { ageFromDob, isAdultDob, recordUnderageAttempt, underageBlockActive } from '../services/ageGate';

interface ProfileOnboardingProps {
  currentUser: UserProfile;
  onSave: (profile: { displayName: string; handle: string; bio: string; age: number; privacySetting: LocationPrivacy; interests: string[] }) => Promise<boolean>;
}

// "What I'm looking for" — the same vocabulary the Profile "Looking for"
// section uses, stored in the same existing `profiles.interests` column.
const PREFERENCES: readonly string[] = LOOKING_FOR_OPTIONS;

export const ProfileOnboarding: React.FC<ProfileOnboardingProps> = ({ currentUser, onSave }) => {
  const [displayName, setDisplayName] = useState(currentUser.displayName || '');

  const [handle, setHandle] = useState(currentUser.handle?.replace(/^gayze-user(-[a-z0-9]+)?$/, '') || '');
  const [bio, setBio] = useState(currentUser.bio || '');
  const [dob, setDob] = useState('');
  const [blocked, setBlocked] = useState(() => underageBlockActive());
  const age = ageFromDob(dob);
  const [privacySetting, setPrivacySetting] = useState<LocationPrivacy>(currentUser.privacySetting || 'fuzzy_500m');
  const [preferences, setPreferences] = useState<string[]>(currentUser.interests || []);
  const [confirmedAdult, setConfirmedAdult] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const canSave = useMemo(() => displayName.trim().length >= 2 && handle.trim().length >= 3 && isAdultDob(dob) && confirmedAdult && preferences.length > 0 && !blocked, [displayName, handle, dob, confirmedAdult, preferences, blocked]);
  const togglePreference = (value: string) => setPreferences((prev) => prev.includes(value) ? prev.filter((item) => item !== value) : [...prev, value]);
  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (age !== null && age < 18) { recordUnderageAttempt(); setBlocked(true); return; }
    if (!canSave || busy) return;
    setBusy(true); setError(null);
    const ok = await onSave({ displayName: displayName.trim(), handle: handle.trim(), bio, age: age as number, privacySetting, interests: preferences });
    if (!ok) setError('We could not save your profile. Please try again.');
    setBusy(false);
  };

  return (
    <div className="fixed inset-0 z-[120] bg-[#090a0f]/95 backdrop-blur-xl overflow-y-auto px-4 py-8">
      <div className="mx-auto w-full max-w-lg g-panel !rounded-[12px] p-5 sm:p-7">
        <div className="mb-6">
          <div className="text-[12px] text-[#C9A24D] font-semibold">Welcome to GAYZE</div>
          <h1 className="mt-2 text-2xl font-semibold">Build your profile</h1>
          <p className="mt-1.5 text-sm text-zinc-400">Set your identity and discovery preferences before you start appearing in live discovery.</p>
        </div>
        <form onSubmit={submit} className="space-y-4">
          <input value={displayName} onChange={(e) => setDisplayName(e.target.value)} placeholder="Display name" autoComplete="name" className="w-full h-12 rounded-xl bg-[#090a0f] border border-white/10 px-4 text-sm outline-none focus:border-[#6F3CC3]/70" />
          <input value={handle} onChange={(e) => setHandle(e.target.value.replace(/\s/g, '').toLowerCase())} placeholder="Username / handle" autoComplete="username" className="w-full h-12 rounded-xl bg-[#090a0f] border border-white/10 px-4 text-sm outline-none focus:border-[#6F3CC3]/70" />
          <div className="grid grid-cols-2 gap-3">
            <label className="block">
              <span className="block text-[11px] font-semibold text-zinc-300 mb-1">Date of birth</span>
              <input type="date" value={dob} onChange={(e) => setDob(e.target.value)} max={new Date().toISOString().slice(0, 10)} autoComplete="bday" aria-label="Date of birth (you must be 18 or over)" className="w-full h-12 rounded-xl bg-[#090a0f] border border-white/10 px-4 text-sm outline-none focus:border-[#6F3CC3]/70" />
            </label>
            <label className="block">
              <span className="block text-[11px] font-semibold text-zinc-300 mb-1">Location privacy</span>
            <select value={privacySetting} onChange={(e) => setPrivacySetting(e.target.value as LocationPrivacy)} className="w-full h-12 rounded-xl bg-[#090a0f] border border-white/10 px-4 text-sm outline-none">
              <option value="fuzzy_500m">Approx. 500m</option><option value="neighborhood">Neighborhood</option><option value="ghost">Ghost mode</option>
            </select>
            </label>
          </div>
          <p className="-mt-2 text-[11px] text-zinc-500">GAYZE is for people aged 18 and over. We use your date of birth only to check this and do not store it.</p>
          <textarea value={bio} onChange={(e) => setBio(e.target.value.slice(0, 280))} placeholder="Short bio (optional)" rows={3} className="w-full rounded-xl bg-[#090a0f] border border-white/10 px-4 py-3 text-sm outline-none resize-none focus:border-[#6F3CC3]/70" />
          <div>
            <div className="text-xs font-semibold text-white">What are you interested in?</div>
            <p className="mt-1 text-[11px] text-zinc-500">Choose at least one. You can change these later.</p>
            <div className="mt-3 flex flex-wrap gap-2">
              {PREFERENCES.map((preference) => {
                const selected = preferences.includes(preference); const privatePreference = preference.startsWith('Hookup');
                return <button key={preference} type="button" onClick={() => togglePreference(preference)} className={`px-3 py-2 rounded-md border text-xs transition-all ${selected ? privatePreference ? 'border-[#6F3CC3]/80 bg-[#6F3CC3]/20 text-white shadow-[0_0_16px_rgba(111,60,195,0.16)]' : 'border-[#C9A24D]/80 bg-[#C9A24D]/15 text-white shadow-[0_0_16px_rgba(201,162,77,0.14)]' : 'border-white/10 bg-white/[0.03] text-zinc-400'}`}>{selected && <Check className="inline w-3 h-3 mr-1" />}{intentDisplayLabel(preference)}</button>;
              })}
            </div>
          </div>
          <label className="flex items-start gap-3 rounded-xl border border-white/10 bg-white/[0.025] p-3 cursor-pointer">
            <input type="checkbox" checked={confirmedAdult} onChange={(e) => setConfirmedAdult(e.target.checked)} className="mt-1 accent-[#6F3CC3]" />
            <span className="text-xs text-zinc-300">I confirm that I am 18 or older and understand that my selected preferences control what I see and how I appear in discovery.</span>
          </label>
          {blocked && <div role="alert" className="rounded-xl border border-rose-400/25 bg-rose-400/5 px-3 py-2.5 text-xs text-rose-200">GAYZE is for people aged 18 and over. We can't create a profile from the date you entered.</div>}
          {error && <div className="rounded-xl border border-rose-400/25 bg-rose-400/5 px-3 py-2.5 text-xs text-rose-200">{error}</div>}
          <button type="submit" disabled={!canSave || busy} className="w-full h-12 rounded-xl bg-[#6F3CC3] hover:bg-[#7b46d2] disabled:opacity-40 text-white font-semibold flex items-center justify-center gap-2">{busy ? 'Saving…' : 'Finish profile'} <ArrowRight className="w-4 h-4" /></button>
        </form>
        <div className="mt-5 flex gap-2 text-[10px] leading-relaxed text-zinc-500"><ShieldCheck className="w-4 h-4 text-emerald-400 shrink-0" />Your exact location is not shown to other users; discovery uses privacy-protected intent locations.</div>
      </div>
    </div>
  );
};
