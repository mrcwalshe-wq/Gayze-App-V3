import React, { useMemo, useRef, useState } from 'react';
import {
  X,
  ChevronDown,
  Check,
  Camera,
  Sparkles,
  Heart,
  Users,
  Compass,
  Shield,
  KeyRound,
  Plus,
  User,
} from 'lucide-react';
import type { LocationPrivacy, UserProfile, IntimacyProfile } from '../types';
import {
  AVAILABILITY_OPTIONS,
  BODY_TYPE_OPTIONS,
  BOUNDARY_OPTIONS,
  DEFAULT_INTIMACY_VISIBILITY,
  INTIMACY_EXPERIENCE_OPTIONS,
  INTIMACY_PREFERENCE_OPTIONS,
  INTIMACY_ROLE_OPTIONS,
  INTIMACY_VISIBILITY_OPTIONS,
  INTERESTS_PREVIEW_COUNT,
  INTEREST_OPTIONS,
  LOOKING_FOR_OPTIONS,
  LEGACY_LOOKING_FOR_OPTIONS,
  MY_SETUP_OPTIONS,
  PRONOUN_OPTIONS,
  withLegacyValues,
  type EditSectionKey,
  type IntimacyVisibility,
} from '../config/profileOptions';
import { hapticLight } from '../services/hapticService';

/** Everything the profile editor can change, in one grouped save. */
export interface ProfileSavePayload {
  displayName: string;
  handle: string;
  bio: string;
  age?: number;
  privacySetting: LocationPrivacy;
  lookingFor: string[];
  pronouns?: string;
  heightCm?: number;
  bodyType?: string;
  hobbies: string[];
  boundaries: string[];
  mySetup: string[];
  availability: string[];
  intimacy: IntimacyProfile;
}

interface ProfileEditSheetProps {
  isOpen: boolean;
  currentUser: UserProfile;
  hasPhoto: boolean;
  onClose: () => void;
  /** Persist everything. Resolves false on failure (sheet stays open). */
  onSave: (payload: ProfileSavePayload) => Promise<boolean>;
  /** Jump straight into a section (used by the completion hint). */
  initialSection?: EditSectionKey | null;
  /** Opens the existing Identity & devices modal (advanced). */
  onOpenIdentity?: () => void;
  /** Connects "Right now" availability to the existing Intent system. */
  onOpenSetIntent?: () => void;
}

const SECTION_ORDER: Array<{ key: EditSectionKey; label: string; icon: React.ReactNode }> = [
  { key: 'identity', label: 'Identity', icon: <User className="w-3.5 h-3.5" /> },
  { key: 'lookingFor', label: "What I'm looking for", icon: <Sparkles className="w-3.5 h-3.5" /> },
  { key: 'intimacy', label: 'Intimacy', icon: <Heart className="w-3.5 h-3.5" /> },
  { key: 'interests', label: 'Interests', icon: <Compass className="w-3.5 h-3.5" /> },
  { key: 'setup', label: 'My setup', icon: <Users className="w-3.5 h-3.5" /> },
  { key: 'boundaries', label: 'Boundaries', icon: <Shield className="w-3.5 h-3.5" /> },
  { key: 'privacy', label: 'Privacy', icon: <KeyRound className="w-3.5 h-3.5" /> },
];

const PRIVACY_OPTIONS: Array<{ value: LocationPrivacy; label: string }> = [
  { value: 'fuzzy_500m', label: 'Approx. 500 m' },
  { value: 'neighborhood', label: 'Neighbourhood' },
  { value: 'ghost', label: 'Ghost' },
];

/** Selectable chip — one visual language for every multi/single select here. */
const Chip: React.FC<{
  label: string;
  selected: boolean;
  onClick: () => void;
  tone?: 'purple' | 'amber';
  ariaPressed?: boolean;
}> = ({ label, selected, onClick, tone = 'purple', ariaPressed }) => (
  <button
    type="button"
    onClick={onClick}
    aria-pressed={ariaPressed ?? selected}
    className={`inline-flex items-center gap-1.5 min-h-[42px] px-3.5 rounded-full border text-[12.5px] font-semibold transition-all -webkit-tap-highlight-color-transparent ${
      selected
        ? tone === 'amber'
          ? 'border-[#C9A24D]/80 bg-[#C9A24D]/15 text-white shadow-[0_0_16px_rgba(201,162,77,0.14)]'
          : 'border-[#6F3CC3]/80 bg-[#6F3CC3]/20 text-white shadow-[0_0_16px_rgba(111,60,195,0.16)]'
        : 'border-white/10 bg-white/[0.03] text-zinc-400 hover:text-zinc-200 hover:border-white/20'
    }`}
  >
    {selected && <Check className="w-3 h-3" />}
    {label}
  </button>
);

/** Collapsible section card. One section open at a time — progressive disclosure. */
const SectionCard: React.FC<{
  label: string;
  icon: React.ReactNode;
  open: boolean;
  onToggle: () => void;
  preview: string;
  children: React.ReactNode;
}> = ({ label, icon, open, onToggle, preview, children }) => (
  <section className="g-panel overflow-hidden">
    <button
      type="button"
      className="g-row !min-h-[52px]"
      onClick={() => { hapticLight(); onToggle(); }}
      aria-expanded={open}
    >
      <span className="flex items-center justify-center w-8 h-8 rounded-[10px] border shrink-0 text-[#c9b0f5] bg-[#6F3CC3]/15 border-[#6F3CC3]/40">
        {icon}
      </span>
      <span className="min-w-0 flex-1">
        <span className="block text-[13.5px] font-bold text-white">{label}</span>
        <span className="block text-[11px] text-zinc-500 truncate">{preview || 'Not set yet'}</span>
      </span>
      <ChevronDown className={`w-4 h-4 text-zinc-600 shrink-0 transition-transform ${open ? 'rotate-180' : ''}`} />
    </button>
    {open && <div className="px-4 pb-4 pt-1 space-y-3.5">{children}</div>}
  </section>
);

export const ProfileEditSheet: React.FC<ProfileEditSheetProps> = ({
  isOpen,
  currentUser,
  hasPhoto,
  onClose,
  onSave,
  initialSection = null,
  onOpenIdentity,
  onOpenSetIntent,
}) => {
  // --- Identity ---
  const [displayName, setDisplayName] = useState(currentUser.displayName || '');
  const [handle, setHandle] = useState(currentUser.handle || '');
  const [age, setAge] = useState(currentUser.age ? String(currentUser.age) : '');
  const [pronouns, setPronouns] = useState(currentUser.pronouns || '');
  const [heightCm, setHeightCm] = useState(currentUser.heightCm ? String(currentUser.heightCm) : '');
  const [bodyType, setBodyType] = useState(currentUser.bodyType || '');
  const [bio, setBio] = useState(currentUser.bio || '');

  // --- Chips ---
  const [lookingFor, setLookingFor] = useState<string[]>(currentUser.interests || []);
  const [hobbies, setHobbies] = useState<string[]>(currentUser.hobbies || []);
  const [boundaries, setBoundaries] = useState<string[]>(currentUser.boundaries || []);
  const [mySetup, setMySetup] = useState(currentUser.mySetup || []);
  const [availability, setAvailability] = useState(currentUser.availability || []);

  // --- Intimacy (optional, sensitive) ---
  const [intimacyRole, setIntimacyRole] = useState<string | undefined>(currentUser.intimacy?.role);
  const [intimacyPrefs, setIntimacyPrefs] = useState<string[]>(currentUser.intimacy?.preferences || []);
  const [intimacyExperience, setIntimacyExperience] = useState<string | undefined>(currentUser.intimacy?.experience);
  const [intimacyVisibility, setIntimacyVisibility] = useState<IntimacyVisibility>(
    currentUser.intimacy?.visibility || DEFAULT_INTIMACY_VISIBILITY,
  );

  // --- Privacy ---
  const [privacySetting, setPrivacySetting] = useState<LocationPrivacy>(currentUser.privacySetting);

  const [openSection, setOpenSection] = useState<EditSectionKey | null>(initialSection ?? 'identity');
  const [showAllInterests, setShowAllInterests] = useState(false);
  const [customInterest, setCustomInterest] = useState('');
  const [ageError, setAgeError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [failed, setFailed] = useState(false);
  const dirtyRef = useRef(false);

  const lookingForOptions = useMemo(
    () => withLegacyValues(lookingFor, [...LOOKING_FOR_OPTIONS, ...LEGACY_LOOKING_FOR_OPTIONS]),
    [lookingFor],
  );

  if (!isOpen) return null;

  const markDirty = () => { dirtyRef.current = true; if (failed) setFailed(false); };

  const toggleIn = (list: string[], setList: (next: string[]) => void, value: string) => {
    markDirty();
    setList(list.includes(value) ? list.filter((item) => item !== value) : [...list, value]);
  };

  const selectOne = (value: string, current: string | undefined, set: (next: string | undefined) => void) => {
    markDirty();
    set(current === value ? undefined : value);
  };

  const buildPayload = (): ProfileSavePayload | null => {
    const trimmedAge = age.trim();
    let ageNumber: number | undefined;
    if (trimmedAge) {
      const parsed = Number(trimmedAge);
      if (!Number.isInteger(parsed) || parsed < 18 || parsed > 120) {
        setAgeError('Age must be 18 or over.');
        return null;
      }
      ageNumber = parsed;
    }
    setAgeError(null);
    // A custom interest the user typed but never pressed "+" for must not be lost.
    const typedInterest = customInterest.trim().slice(0, 24);
    const savedHobbies = typedInterest && !hobbies.includes(typedInterest) ? [...hobbies, typedInterest] : hobbies;
    return {
      displayName: displayName.trim() || currentUser.displayName,
      handle: handle.trim() || currentUser.handle,
      bio: bio.trim(),
      age: ageNumber,
      privacySetting,
      lookingFor,
      pronouns: pronouns.trim() || undefined,
      heightCm: Number(heightCm) > 0 ? Number(heightCm) : undefined,
      bodyType: bodyType || undefined,
      hobbies: savedHobbies,
      boundaries,
      mySetup,
      availability,
      intimacy: {
        role: intimacyRole,
        preferences: intimacyPrefs,
        experience: intimacyExperience,
        visibility: intimacyVisibility,
      },
    };
  };

  const saveAndClose = async () => {
    if (saving) return;
    const payload = buildPayload();
    if (!payload) return;
    setSaving(true);
    setFailed(false);
    const ok = await onSave(payload);
    setSaving(false);
    if (!ok) {
      setFailed(true);
      return;
    }
    dirtyRef.current = false;
    onClose();
  };

  /** No confirmation dialogs: closing a dirty sheet saves it (safe, additive writes). */
  const requestClose = () => {
    if (saving) return;
    if (dirtyRef.current) {
      void saveAndClose();
      return;
    }
    onClose();
  };

  const toggleInterest = (value: string) => toggleIn(hobbies, setHobbies, value);

  const addCustomInterest = () => {
    const value = customInterest.trim().slice(0, 24);
    if (!value || hobbies.includes(value)) { setCustomInterest(''); return; }
    markDirty();
    setHobbies([...hobbies, value]);
    setCustomInterest('');
    setShowAllInterests(true);
  };

  const previewText = (values: string[], extra?: string) =>
    [extra, ...values].filter(Boolean).join(' · ');

  return (
    <div className="g-overlay flex items-end sm:items-center justify-center sm:p-4" onClick={requestClose}>
      <div className="g-sheet" onClick={(e) => e.stopPropagation()}>
        <div className="g-sheet__grip" />

        <div className="g-sheet__head">
          <div className="min-w-0 flex-1">
            <h2 className="text-[15px] font-bold text-white leading-tight">Edit profile</h2>
            <p className="text-[11.5px] text-zinc-500 truncate">Optional everything. About 60 seconds.</p>
          </div>
          <button type="button" className="g-icon-btn g-icon-btn--bare" onClick={requestClose} aria-label="Close">
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="g-sheet__body space-y-2.5">
          {/* ------------------------------ Identity ------------------------------ */}
          <SectionCard
            label="Identity"
            icon={SECTION_ORDER[0].icon}
            open={openSection === 'identity'}
            onToggle={() => setOpenSection(openSection === 'identity' ? null : 'identity')}
            preview={previewText([displayName, age ? `${age}` : '', pronouns], bio ? 'Bio set' : '')}
          >
            <div className="space-y-2.5">
              <input
                value={displayName}
                onChange={(e) => { markDirty(); setDisplayName(e.target.value); }}
                placeholder="Display name"
                autoComplete="name"
                className="w-full h-11 rounded-xl bg-[#090a0f] border border-white/10 px-3.5 text-sm text-white outline-none focus:border-[#6F3CC3]/70"
              />
              <div className="flex gap-2.5">
                <input
                  value={handle}
                  onChange={(e) => { markDirty(); setHandle(e.target.value.replace(/\s/g, '').toLowerCase()); }}
                  placeholder="Handle"
                  autoComplete="username"
                  className="w-full h-11 rounded-xl bg-[#090a0f] border border-white/10 px-3.5 text-sm text-white outline-none focus:border-[#6F3CC3]/70"
                />
                <input
                  value={age}
                  onChange={(e) => { markDirty(); setAge(e.target.value.replace(/\D/g, '').slice(0, 3)); }}
                  inputMode="numeric"
                  placeholder="Age"
                  className="w-24 h-11 rounded-xl bg-[#090a0f] border border-white/10 px-3.5 text-sm text-white outline-none focus:border-[#6F3CC3]/70"
                />
              </div>
              {ageError && <p className="text-[11.5px] text-amber-300">{ageError}</p>}
              <div>
                <span className="g-label">Pronouns (optional)</span>
                <div className="flex flex-wrap gap-2 mt-2">
                  {PRONOUN_OPTIONS.map((option) => (
                    <Chip key={option} label={option} selected={pronouns === option} onClick={() => { markDirty(); setPronouns(pronouns === option ? '' : option); }} />
                  ))}
                  <input
                    value={pronouns && !(PRONOUN_OPTIONS as readonly string[]).includes(pronouns) ? pronouns : ''}
                    onChange={(e) => { markDirty(); setPronouns(e.target.value.slice(0, 24)); }}
                    placeholder="or type your own"
                    className="h-[42px] w-36 rounded-full bg-[#090a0f] border border-white/10 px-3.5 text-[12.5px] text-white outline-none focus:border-[#6F3CC3]/70"
                  />
                </div>
              </div>
              <div>
                <span className="g-label">Short bio (optional)</span>
                <textarea
                  value={bio}
                  onChange={(e) => { markDirty(); setBio(e.target.value.slice(0, 280)); }}
                  placeholder="Say something real — a line or two is plenty."
                  rows={3}
                  className="w-full mt-2 rounded-xl bg-[#090a0f] border border-white/10 px-3.5 py-2.5 text-sm text-white outline-none resize-none focus:border-[#6F3CC3]/70"
                />
                <p className="text-[10.5px] text-zinc-600 mt-1 text-right">{bio.length}/280</p>
              </div>
              <div className="flex gap-2.5">
                <div className="flex-1">
                  <span className="g-label">Height (optional)</span>
                  <input
                    value={heightCm}
                    onChange={(e) => { markDirty(); setHeightCm(e.target.value.replace(/\D/g, '').slice(0, 3)); }}
                    inputMode="numeric"
                    placeholder="cm"
                    className="w-full h-11 mt-2 rounded-xl bg-[#090a0f] border border-white/10 px-3.5 text-sm text-white outline-none focus:border-[#6F3CC3]/70"
                  />
                </div>
              </div>
              <div>
                <span className="g-label">Body type (optional)</span>
                <div className="flex flex-wrap gap-2 mt-2">
                  {BODY_TYPE_OPTIONS.map((option) => (
                    <Chip key={option} label={option} selected={bodyType === option} onClick={() => { markDirty(); setBodyType(bodyType === option ? '' : option); }} />
                  ))}
                </div>
              </div>
              {hasPhoto && (
                <div className="flex items-center gap-2 text-[11.5px] text-zinc-500">
                  <Camera className="w-3.5 h-3.5 text-[#b796f0]" /> Photos are managed on your profile.
                </div>
              )}
            </div>
          </SectionCard>

          {/* --------------------------- Looking for --------------------------- */}
          <SectionCard
            label="What I'm looking for"
            icon={SECTION_ORDER[1].icon}
            open={openSection === 'lookingFor'}
            onToggle={() => setOpenSection(openSection === 'lookingFor' ? null : 'lookingFor')}
            preview={lookingFor.join(' · ')}
          >
            <p className="text-[11.5px] text-zinc-500">Pick as many as you like. This is the first thing people match on.</p>
            <div className="flex flex-wrap gap-2">
              {lookingForOptions.map((option) => (
                <Chip
                  key={option}
                  label={option}
                  tone="amber"
                  selected={lookingFor.includes(option)}
                  onClick={() => toggleIn(lookingFor, setLookingFor, option)}
                />
              ))}
            </div>
          </SectionCard>

          {/* ----------------------------- Intimacy ----------------------------- */}
          <SectionCard
            label="Intimacy"
            icon={SECTION_ORDER[2].icon}
            open={openSection === 'intimacy'}
            onToggle={() => setOpenSection(openSection === 'intimacy' ? null : 'intimacy')}
            preview={previewText(intimacyPrefs, intimacyRole)}
          >
            <p className="text-[11.5px] text-zinc-500">Entirely optional. Skip everything if you'd rather.</p>

            <div>
              <span className="g-label">Role / position</span>
              <div className="flex flex-wrap gap-2 mt-2">
                {INTIMACY_ROLE_OPTIONS.map((option) => (
                  <Chip
                    key={option}
                    label={option}
                    selected={intimacyRole === option}
                    onClick={() => selectOne(option, intimacyRole, setIntimacyRole)}
                  />
                ))}
              </div>
            </div>

            <div>
              <span className="g-label">Preferences</span>
              <div className="flex flex-wrap gap-2 mt-2">
                {INTIMACY_PREFERENCE_OPTIONS.map((option) => (
                  <Chip
                    key={option}
                    label={option}
                    selected={intimacyPrefs.includes(option)}
                    onClick={() => toggleIn(intimacyPrefs, setIntimacyPrefs, option)}
                  />
                ))}
              </div>
            </div>

            <div>
              <span className="g-label">Experience / openness</span>
              <div className="flex flex-wrap gap-2 mt-2">
                {INTIMACY_EXPERIENCE_OPTIONS.map((option) => (
                  <Chip
                    key={option}
                    label={option}
                    selected={intimacyExperience === option}
                    onClick={() => selectOne(option, intimacyExperience, setIntimacyExperience)}+                  />
                ))}
              </div>
            </div>

            <div>
              <span className="g-label">Who can see this section</span>
              <div className="g-seg mt-2">
                {INTIMACY_VISIBILITY_OPTIONS.map((option) => (
                  <button
                    key={option.value}
                    type="button"
                    className="g-seg__btn"
                    data-active={intimacyVisibility === option.value}
                    data-tone="purple"
                    onClick={() => { markDirty(); setIntimacyVisibility(option.value); }}
                  >
                    {option.label}
                  </button>
                ))}
              </div>
              <p className="text-[10.5px] text-zinc-600 mt-1.5">
                {INTIMACY_VISIBILITY_OPTIONS.find((option) => option.value === intimacyVisibility)?.hint}. Defaults to connections only — never public unless you choose it.
              </p>
            </div>
          </SectionCard>

          {/* ----------------------------- Interests ----------------------------- */}
          <SectionCard
            label="Interests"
            icon={SECTION_ORDER[3].icon}
            open={openSection === 'interests'}
            onToggle={() => setOpenSection(openSection === 'interests' ? null : 'interests')}
            preview={hobbies.join(' · ')}
          >
            <div className="flex flex-wrap gap-2">
              {(showAllInterests ? INTEREST_OPTIONS : INTEREST_OPTIONS.slice(0, INTERESTS_PREVIEW_COUNT)).map((option) => (
                <Chip
                  key={option}
                  label={option}
                  selected={hobbies.includes(option)}
                  onClick={() => toggleInterest(option)}
                />
              ))}
              {hobbies
                .filter((value) => !(INTEREST_OPTIONS as readonly string[]).includes(value))
                .map((value) => (
                  <Chip key={value} label={value} selected onClick={() => toggleInterest(value)} />
                ))}
            </div>
            <div className="flex items-center gap-2">
              {!showAllInterests && (
                <button
                  type="button"
                  className="g-btn g-btn--quiet !min-h-[40px]"
                  onClick={() => setShowAllInterests(true)}
                >
                  <Plus className="w-3.5 h-3.5" /> Add interests
                </button>
              )}
              <input
                value={customInterest}
                onChange={(e) => setCustomInterest(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); addCustomInterest(); } }}
                placeholder="Custom interest"
                className="h-[40px] w-40 rounded-xl bg-[#090a0f] border border-white/10 px-3.5 text-[12.5px] text-white outline-none focus:border-[#6F3CC3]/70"
              />
              <button type="button" className="g-btn g-btn--quiet !min-h-[40px] !px-3" onClick={addCustomInterest} aria-label="Add custom interest">
                <Plus className="w-3.5 h-3.5" />
              </button>
            </div>
          </SectionCard>

          {/* ------------------------------ My setup ------------------------------ */}
          <SectionCard
            label="My setup"
            icon={SECTION_ORDER[4].icon}
            open={openSection === 'setup'}
            onToggle={() => setOpenSection(openSection === 'setup' ? null : 'setup')}
            preview={previewText(mySetup, availability.length ? availability.join(' · ') : '')}
          >
            <div>
              <span className="g-label">Hosting & getting around</span>
              <div className="flex flex-wrap gap-2 mt-2">
                {MY_SETUP_OPTIONS.map((option) => (
                  <Chip
                    key={option}
                    label={option}
                    selected={mySetup.includes(option)}
                    onClick={() => toggleIn(mySetup, setMySetup, option)}
                  />
                ))}
              </div>
            </div>
            <div>
              <span className="g-label">Availability</span>
              <div className="flex flex-wrap gap-2 mt-2">
                {AVAILABILITY_OPTIONS.map((option) => (
                  <Chip
                    key={option}
                    label={option}
                    selected={availability.includes(option)}
                    onClick={() => toggleIn(availability, setAvailability, option)}
                  />
                ))}
              </div>
              {availability.includes('Right now') && onOpenSetIntent && (
                <button
                  type="button"
                  className="g-btn g-btn--quiet !min-h-[40px] mt-2.5"
                  onClick={() => { hapticLight(); onOpenSetIntent(); }}
                >
                  <Sparkles className="w-3.5 h-3.5" /> Set a Right Now signal on the map
                </button>
              )}
              <p className="text-[10.5px] text-zinc-600 mt-1.5">
                Availability is a standing preference — your live broadcast is always an Intent.
              </p>
            </div>
          </SectionCard>

          {/* ----------------------------- Boundaries ----------------------------- */}
          <SectionCard
            label="Boundaries"
            icon={SECTION_ORDER[5].icon}
            open={openSection === 'boundaries'}
            onToggle={() => setOpenSection(openSection === 'boundaries' ? null : 'boundaries')}
            preview={boundaries.join(' · ')}
          >
            <p className="text-[11.5px] text-zinc-500">For compatibility and clarity. Blank is completely fine.</p>
            <div className="flex flex-wrap gap-2">
              {BOUNDARY_OPTIONS.map((option) => (
                <Chip
                  key={option}
                  label={option}
                  selected={boundaries.includes(option)}
                  onClick={() => toggleIn(boundaries, setBoundaries, option)}
                />
              ))}
            </div>
          </SectionCard>

          {/* ------------------------------ Privacy ------------------------------ */}
          <SectionCard
            label="Privacy"
            icon={SECTION_ORDER[6].icon}
            open={openSection === 'privacy'}
            onToggle={() => setOpenSection(openSection === 'privacy' ? null : 'privacy')}
            preview={PRIVACY_OPTIONS.find((option) => option.value === privacySetting)?.label || privacySetting}
          >
            <div>
              <span className="g-label">Location visibility</span>
              <div className="g-seg mt-2">
                {PRIVACY_OPTIONS.map((option) => (
                  <button
                    key={option.value}
                    type="button"
                    className="g-seg__btn"
                    data-active={privacySetting === option.value}
                    data-tone="purple"
                    onClick={() => { markDirty(); setPrivacySetting(option.value); }}
                  >
                    {option.label}
                  </button>
                ))}
              </div>
              <p className="text-[10.5px] text-zinc-600 mt-1.5">
                Your exact position is never published — discovery always uses a jittered area.
              </p>
            </div>
            <div>
              <span className="g-label">Sensitive sections</span>
              <p className="text-[11.5px] text-zinc-500 mt-1.5">
                Intimacy defaults to “Connections only”. Public profile fields are name, age, pronouns, bio, area, lookings, interests, setup and boundaries.
              </p>
            </div>
            {onOpenIdentity && (
              <button
                type="button"
                className="g-row !min-h-[48px] rounded-xl border border-white/10 bg-white/[0.02]"
                onClick={() => { hapticLight(); onOpenIdentity(); }}
              >
                <span className="flex items-center justify-center w-8 h-8 rounded-[10px] border shrink-0 text-[#e7c98a] bg-[#C9A24D]/15 border-[#C9A24D]/40">
                  <KeyRound className="w-4 h-4" />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block text-[13px] font-bold text-white">Identity & devices</span>
                  <span className="block text-[11px] text-zinc-500 truncate">Keys, recovery, trusted devices</span>
                </span>
              </button>
            )}
          </SectionCard>
        </div>

        <div className="g-sheet__foot">
          {failed && <span className="text-[11.5px] text-amber-300 flex-1 min-w-0 truncate">Couldn't save — try again.</span>}
          <button
            type="button"
            className="g-btn g-btn--primary flex-1"
            onClick={() => { hapticLight(); void saveAndClose(); }}
            disabled={saving}
          >
            {saving ? 'Saving…' : failed ? 'Retry save' : 'Save'}
          </button>
        </div>
      </div>
    </div>
  );
};
