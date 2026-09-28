import React, { useEffect, useState } from 'react';
import {
  Radio,
  Shield,
  EyeOff,
  QrCode,
  KeyRound,
  ChevronRight,
  ShieldCheck,
  Plus,
  Pause,
  Play,
  X,
  Edit3,
  Compass,
  Camera,
  Trash2,
  Star,
} from 'lucide-react';
import { UserActiveIntent, UserProfile } from '../types';
import { hapticLight, hapticSensitiveAction } from '../services/hapticService';
import { deleteProfilePhoto, loadProfilePhotos, setPrimaryProfilePhoto, uploadProfilePhoto, type ProfilePhoto } from '../services/profilePhotoService';

interface ProfileViewProps {
  currentUser: UserProfile;
  activeUserIntent?: UserActiveIntent | null;
  areaLabel?: string;
  onOpenSetIntent?: () => void;
  onUpdateActiveUserIntent?: (intent: UserActiveIntent | null) => void;
  /** True while a publish/pause/end write is in flight. */
  intentBusy?: boolean;
  onOpenSafetyTimer: () => void;
  isSafetyTimerActive: boolean;
  onOpenMask: () => void;
  onOpenIdentity: () => void;
  onOpenQR: () => void;
  onOpenSafeHavens: () => void;
  onOpenDiscover?: () => void;
}

const privacyLabel: Record<string, string> = {
  fuzzy_500m: 'Fuzzy ±500 m',
  neighborhood: 'Neighbourhood only',
  ghost: 'Ghost mode',
};

const formatRemaining = (ms: number): string => {
  if (ms <= 0) return '0:00';
  const totalMin = Math.floor(ms / 60000);
  const h = Math.floor(totalMin / 60);
  const m = totalMin % 60;
  return h > 0 ? `${h}h ${m.toString().padStart(2, '0')}m` : `${m}m`;
};

/**
 * Profile — secondary to intent. Identity, current signal, trust, safety.
 * One surface with hairline dividers; no card grid, no dating-photo wall.
 */
export const ProfileView: React.FC<ProfileViewProps> = ({
  currentUser,
  activeUserIntent,
  areaLabel,
  onOpenSetIntent,
  onUpdateActiveUserIntent,
  intentBusy = false,
  onOpenSafetyTimer,
  isSafetyTimerActive,
  onOpenMask,
  onOpenIdentity,
  onOpenQR,
  onOpenSafeHavens,
  onOpenDiscover,
}) => {
  const [now, setNow] = useState(Date.now());
  const [photos, setPhotos] = useState<ProfilePhoto[]>([]);
  const [photoBusy, setPhotoBusy] = useState(false);
  const [photoMessage, setPhotoMessage] = useState<string | null>(null);
  const [viewerPhoto, setViewerPhoto] = useState<ProfilePhoto | null>(null);

  useEffect(() => {
    let cancelled = false;
    void loadProfilePhotos()
      .then((items) => { if (!cancelled) setPhotos(items); })
      .catch(() => { if (!cancelled) setPhotoMessage('Profile photos are unavailable right now.'); });
    return () => { cancelled = true; };
  }, []);

  const handleUploadPhoto = async (file: File | undefined) => {
    if (!file) return;
    setPhotoBusy(true);
    setPhotoMessage(null);
    try { setPhotos(await uploadProfilePhoto(file)); }
    catch (error) { setPhotoMessage(error instanceof Error ? error.message : 'Could not add that photo.'); }
    finally { setPhotoBusy(false); }
  };

  const handleDeletePhoto = async (photo: ProfilePhoto) => {
    setPhotoBusy(true); setPhotoMessage(null);
    try { setPhotos(await deleteProfilePhoto(photo)); }
    catch (error) { setPhotoMessage(error instanceof Error ? error.message : 'Could not remove that photo.'); }
    finally { setPhotoBusy(false); }
  };

  const handleSetPrimaryPhoto = async (photo: ProfilePhoto) => {
    setPhotoBusy(true); setPhotoMessage(null);
    try { setPhotos(await setPrimaryProfilePhoto(photo.id)); }
    catch (error) { setPhotoMessage(error instanceof Error ? error.message : 'Could not set the profile photo.'); }
    finally { setPhotoBusy(false); }
  };

  useEffect(() => {
    if (!activeUserIntent || activeUserIntent.isPaused) return;
    const id = window.setInterval(() => setNow(Date.now()), 30000);
    return () => window.clearInterval(id);
  }, [activeUserIntent]);

  const initials = currentUser.displayName
    .split(/\s+/)
    .map((part) => part.charAt(0))
    .join('')
    .slice(0, 2)
    .toUpperCase();

  const handleEnd = () => {
    hapticSensitiveAction();
    onUpdateActiveUserIntent?.(null);
  };

  const handlePause = () => {
    if (!activeUserIntent) return;
    hapticLight();
    onUpdateActiveUserIntent?.({ ...activeUserIntent, isPaused: !activeUserIntent.isPaused });
  };

  const rows: {
    key: string;
    icon: React.ReactNode;
    label: string;
    meta?: string;
    onClick: () => void;
    tone?: 'emerald' | 'amber' | 'purple';
  }[] = [
    {
      key: 'safety',
      icon: <Shield className="w-4 h-4" />,
      label: 'Safety check-in',
      meta: isSafetyTimerActive ? 'Active' : undefined,
      onClick: onOpenSafetyTimer,
      tone: isSafetyTimerActive ? 'amber' : undefined,
    },
    { key: 'havens', icon: <ShieldCheck className="w-4 h-4" />, label: 'Safe Havens', onClick: onOpenSafeHavens, tone: 'emerald' },
    { key: 'qr', icon: <QrCode className="w-4 h-4" />, label: 'QR verification', meta: `${currentUser.verifiedPeersCount} verified`, onClick: onOpenQR, tone: 'amber' },
    { key: 'mask', icon: <EyeOff className="w-4 h-4" />, label: 'Discreet mask', meta: 'Instant camouflage', onClick: onOpenMask },
    { key: 'identity', icon: <KeyRound className="w-4 h-4" />, label: 'Identity & devices', meta: privacyLabel[currentUser.privacySetting] || currentUser.privacySetting, onClick: onOpenIdentity },
  ];

  const toneClass = (tone?: string) =>
    tone === 'emerald' ? 'text-emerald-400 bg-emerald-500/10 border-emerald-500/25'
    : tone === 'amber' ? 'text-[#e7c98a] bg-[#C9A24D]/10 border-[#C9A24D]/30'
    : tone === 'purple' ? 'text-[#c9b0f5] bg-[#6F3CC3]/15 border-[#6F3CC3]/40'
    : 'text-zinc-400 bg-white/[0.05] border-white/10';

  return (
    <div className="gayze-premium-page max-w-xl mx-auto pb-6">
      <header className="pt-5 pb-1">
        <span className="g-label">Profile</span>
      </header>

      {/* Identity — quiet, personal, not a dashboard header */}
      <section className="flex items-center gap-4 py-4">
        <div className="g-avatar g-avatar--private w-16 h-16 !rounded-[22px] text-[19px]">
          {initials}
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 flex-wrap">
            <h1 className="text-[20px] font-semibold tracking-[-0.018em] text-white truncate">
              {currentUser.displayName}
            </h1>
            {currentUser.safetyVerified && (
              <span className="g-badge g-badge--verify">
                <ShieldCheck className="w-3 h-3" /> Verified
              </span>
            )}
          </div>
          <div className="text-[12px] text-zinc-500 mt-1 truncate">
            {areaLabel || currentUser.neighborhood} · approximate area
          </div>
          <div className="flex items-center gap-2 mt-1.5 flex-wrap">
            <span className="g-badge g-badge--trust">
              {currentUser.reliabilityScore > 0
                ? `Reliability ${currentUser.reliabilityScore}`
                : 'No reliability history yet'}
            </span>
            <span className="g-badge g-badge--quiet font-mono">{currentUser.shortKey}</span>
          </div>
        </div>
        <button
          type="button"
          onClick={() => { hapticLight(); onOpenIdentity(); }}
          className="g-icon-btn shrink-0"
          aria-label="Edit profile and identity"
        >
          <Edit3 className="w-4 h-4" />
        </button>
      </section>

      {/* Profile photos — deliberately visible, personal, and separate from Stories */}
      <section className="g-panel p-4 mb-5">
        <div className="flex items-center justify-between gap-3 mb-3">
          <div>
            <span className="g-label">Profile photos</span>
            <p className="text-[12px] text-zinc-500 mt-1">Your first photo is your profile picture. Add up to 6.</p>
          </div>
          <label className="g-btn g-btn--quiet !min-h-[36px] !px-3 cursor-pointer shrink-0">
            <Camera className="w-3.5 h-3.5" />
            {photoBusy ? 'Saving…' : 'Add photo'}
            <input type="file" accept="image/jpeg,image/png,image/webp" className="hidden" disabled={photoBusy || photos.length >= 6}
              onChange={(event) => { void handleUploadPhoto(event.target.files?.[0]); event.currentTarget.value = ''; }} />
          </label>
        </div>
        {photos.length === 0 ? (
          <label className="block rounded-[18px] border border-dashed border-white/12 bg-white/[0.025] p-5 text-center cursor-pointer hover:bg-white/[0.04] transition-colors">
            <Camera className="w-5 h-5 mx-auto text-[#b796f0] mb-2" />
            <div className="text-[13px] font-semibold text-white">Add your profile picture</div>
            <div className="text-[11px] text-zinc-500 mt-1">JPG, PNG or WebP · up to 5 MB</div>
            <input type="file" accept="image/jpeg,image/png,image/webp" className="hidden" disabled={photoBusy}
              onChange={(event) => { void handleUploadPhoto(event.target.files?.[0]); event.currentTarget.value = ''; }} />
          </label>
        ) : (
          <div className="grid grid-cols-3 gap-2">
            {photos.map((photo, index) => (
              <div key={photo.id} className="relative aspect-square rounded-[16px] overflow-hidden bg-[#11131a] border border-white/10 group">
                <button type="button" className="absolute inset-0 w-full h-full" onClick={() => setViewerPhoto(photo)} aria-label={`View profile photo ${index + 1}`}>
                  <img src={photo.url} alt="" className="w-full h-full object-cover" />
                </button>
                {photo.isPrimary && <span className="absolute top-2 left-2 g-badge g-badge--verify !text-[10px] !px-1.5"><Star className="w-2.5 h-2.5" /> Profile</span>}
                {!photo.isPrimary && (
                  <button type="button" onClick={() => void handleSetPrimaryPhoto(photo)} disabled={photoBusy}
                    className="absolute bottom-2 left-2 h-8 px-2 rounded-lg bg-black/70 backdrop-blur-md border border-white/10 text-[10px] text-white">
                    Make profile
                  </button>
                )}
                <button type="button" onClick={() => void handleDeletePhoto(photo)} disabled={photoBusy}
                  className="absolute bottom-2 right-2 w-8 h-8 rounded-lg bg-black/70 backdrop-blur-md border border-white/10 flex items-center justify-center text-zinc-300 hover:text-white" aria-label="Delete photo">
                  <Trash2 className="w-3.5 h-3.5" />
                </button>
              </div>
            ))}
          </div>
        )}
        {photoMessage && <p className="text-[11px] text-amber-200 mt-2">{photoMessage}</p>}
      </section>

      {/* Current signal */}
      <section className={`g-panel p-4 mb-5 ${activeUserIntent && !activeUserIntent.isPaused ? 'g-panel--live' : ''}`}>
        <div className="flex items-center justify-between gap-3 mb-3">
          <span className="g-label">Your signal</span>
          {activeUserIntent && (
            <span className={`g-chip ${activeUserIntent.isPaused ? 'g-chip--quiet' : 'g-chip--live'}`}>
              {activeUserIntent.isPaused
                ? <span className="g-dot g-dot--muted" />
                : <span className="g-live-dot" aria-hidden="true" />}
              {activeUserIntent.isPaused ? 'Paused' : 'Live'}
            </span>
          )}
        </div>

        {activeUserIntent ? (
          <>
            <div className="flex items-center gap-2 flex-wrap">
              <span className={`g-chip ${activeUserIntent.mode === 'private' ? 'g-chip--private' : 'g-chip--social'}`}>
                {activeUserIntent.mode === 'private' ? 'Private' : 'Social'}
              </span>
              <span className="text-[16px] font-semibold text-white tracking-[-0.015em]">
                {activeUserIntent.intent.replace(' · ', ' ')}
              </span>
            </div>
            <p className="text-[13px] text-zinc-400 leading-relaxed mt-2">{activeUserIntent.description}</p>
            <div className="flex items-center justify-between gap-3 mt-3 text-[11.5px] text-zinc-500">
              <span className="truncate">
                {activeUserIntent.when} · {activeUserIntent.duration} · {activeUserIntent.travelDistance}
              </span>
              <span className="text-zinc-400 shrink-0">
                {activeUserIntent.isPaused
                  ? 'paused'
                  : `expires in ${formatRemaining(Math.max(0, activeUserIntent.expiresAt - now))}`}
              </span>
            </div>

            <div className="flex items-center gap-2 mt-4">
              <button type="button" className="g-btn g-btn--danger-quiet !px-3.5" onClick={handleEnd} disabled={intentBusy}>
                <X className="w-4 h-4" /> End
              </button>
              <button type="button" className="g-btn g-btn--quiet flex-1" onClick={handlePause} disabled={intentBusy}>
                {activeUserIntent.isPaused ? <Play className="w-4 h-4" /> : <Pause className="w-4 h-4" />}
                {activeUserIntent.isPaused ? 'Resume' : 'Pause'}
              </button>
              <button type="button" className="g-btn g-btn--primary flex-1" onClick={() => { hapticLight(); onOpenSetIntent?.(); }} disabled={intentBusy}>
                {intentBusy ? 'Saving…' : 'Edit'}
              </button>
            </div>
          </>
        ) : (
          <>
            <p className="text-[13px] text-zinc-400 leading-relaxed mb-3.5">
              You are not broadcasting. Set a signal to appear on the map for the next two hours.
            </p>
            {onOpenSetIntent && (
              <button type="button" className="g-btn g-btn--primary w-full" onClick={() => { hapticLight(); onOpenSetIntent(); }}>
                <Plus className="w-4 h-4" />
                Create your intent
              </button>
            )}
          </>
        )}
      </section>

      {/* Attributes */}
      {currentUser.interests.length > 0 && (
        <section className="mb-5">
          <span className="g-label">About you</span>
          <div className="flex flex-wrap gap-1.5 mt-2.5">
            {currentUser.interests.map((interest) => (
              <span key={interest} className="g-tag">{interest}</span>
            ))}
          </div>
        </section>
      )}

      {/* Safety & privacy */}
      <section className="g-panel overflow-hidden mb-5">
        <div className="px-4 pt-3.5 pb-1">
          <span className="g-label">Safety & privacy</span>
        </div>
        {rows.map((row, index) => (
          <React.Fragment key={row.key}>
            {index > 0 && <hr className="g-divider" />}
            <button type="button" className="g-row" onClick={() => { hapticLight(); row.onClick(); }}>
              <span className={`flex items-center justify-center w-8 h-8 rounded-[10px] border shrink-0 ${toneClass(row.tone)}`}>
                {row.icon}
              </span>
              <span className="min-w-0 flex-1">
                <span className="block text-[13.5px] font-bold text-white">{row.label}</span>
                {row.meta && <span className="block text-[11px] text-zinc-500 truncate">{row.meta}</span>}
              </span>
              <ChevronRight className="w-4 h-4 text-zinc-600 shrink-0" />
            </button>
          </React.Fragment>
        ))}
      </section>

      {/* Footer */}
      <footer className="flex items-center justify-between px-1 pb-2 opacity-70">
        <div className="flex items-center gap-2 text-zinc-500">
          <Radio className="w-3.5 h-3.5 text-[#6F3CC3]" />
          <span className="text-[11px] font-medium tracking-[0.1em] text-zinc-400">Gayze</span>
          <span className="text-[11px] text-zinc-600">Real Intent. Real Time.</span>
        </div>
        {onOpenDiscover && (
          <button type="button" className="g-btn g-btn--ghost !min-h-[32px] text-[11.5px]" onClick={() => { hapticLight(); onOpenDiscover(); }}>
            <Compass className="w-3.5 h-3.5" /> Discover
          </button>
        )}
      </footer>
    </div>
      {viewerPhoto && (
        <div className="fixed inset-0 z-[70] bg-black/95 backdrop-blur-md flex items-center justify-center p-4" onClick={() => setViewerPhoto(null)}>
          <img src={viewerPhoto.url} alt="" className="max-h-[85vh] max-w-full object-contain rounded-2xl" />
          <button type="button" onClick={() => setViewerPhoto(null)} className="absolute top-5 right-5 g-icon-btn" aria-label="Close photo"><X className="w-4 h-4" /></button>
        </div>
      )}
  );
};
