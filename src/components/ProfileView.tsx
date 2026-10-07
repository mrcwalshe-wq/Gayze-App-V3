import React, { useEffect, useState, useRef, useCallback } from 'react';
import {
  Radio,
  Shield,
  EyeOff,
  QrCode,
  KeyRound,
  ChevronRight,
  ChevronLeft,
  ShieldCheck,
  Plus,
  X,
  Edit3,
  Compass,
  Camera,
  Trash2,
  Star,
  ArrowLeft,
  ArrowRight,
  AlertTriangle,
  Bell,
  LogOut,
} from 'lucide-react';
import {
  type EditSectionKey,
  INTIMACY_VISIBILITY_OPTIONS,
  computeProfileCompletion,
} from '../config/profileOptions';
import { UserActiveIntent, UserProfile } from '../types';
import { hapticLight, triggerVibration } from '../services/hapticService';
import {
  deleteProfilePhoto,
  loadProfilePhotos,
  reorderProfilePhotos,
  setPrimaryProfilePhoto,
  uploadProfilePhoto,
  type ProfilePhoto,
} from '../services/profilePhotoService';
import { getPushEnvironment, isDeviceSubscribed } from '../services/pushService';

interface ProfileViewProps {
  currentUser: UserProfile;
  activeUserIntent?: UserActiveIntent | null;
  areaLabel?: string;
  onOpenSetIntent?: () => void;
  onOpenSafetyTimer: () => void;
  isSafetyTimerActive: boolean;
  onOpenMask: () => void;
  onOpenIdentity: () => void;
  /** Releases push, clears the session and returns to the signed-out state. */
  onSignOut?: () => void | Promise<void>;
  signingOut?: boolean;
  onOpenQR: () => void;
  onOpenSafeHavens: () => void;
  onOpenDiscover?: () => void;
  /** Opens the sectioned profile editor (the "Edit profile" pencil). */
  onOpenProfileEdit?: (section?: EditSectionKey) => void;
  onAvatarUpdated?: (url: string | undefined) => void;
  /** Opens the Web Push opt-in / notification preferences sheet. */
  onOpenNotifications?: () => void;
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

const MAX_PHOTOS = 6;
const PHOTO_URL_REFRESH_MS = 50 * 60 * 1000;

/**
 * Profile — authentic identity surface in Obsidian Velvet.
 * Prominent primary photo, active signal, curated photo gallery, and security controls.
 */
export const ProfileView: React.FC<ProfileViewProps> = ({
  currentUser,
  activeUserIntent,
  areaLabel,
  onOpenSetIntent,
  onOpenSafetyTimer,
  isSafetyTimerActive,
  onOpenMask,
  onOpenIdentity,
  onSignOut,
  signingOut = false,
  onOpenQR,
  onOpenSafeHavens,
  onOpenDiscover,
  onOpenProfileEdit,
  onAvatarUpdated,
  onOpenNotifications,
}) => {
  const [now, setNow] = useState(Date.now());
  const [photos, setPhotos] = useState<ProfilePhoto[]>([]);
  const [photoBusy, setPhotoBusy] = useState(false);
  const [photoMessage, setPhotoMessage] = useState<string | null>(null);
  const [viewerIndex, setViewerIndex] = useState<number | null>(null);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const [showNotificationReminder, setShowNotificationReminder] = useState(false);

  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const touchStartXRef = useRef<number | null>(null);

  // Persistent device-status banner: it remains visible while push is
  // unavailable on this device and disappears as soon as the device subscribes.
  useEffect(() => {
    let cancelled = false;
    const checkReminder = async () => {
      try {
        const env = getPushEnvironment();
        if (env.blockedBy === 'unsupported' || env.blockedBy === 'not-configured') {
          if (!cancelled) setShowNotificationReminder(false);
          return;
        }
        const subscribed = await isDeviceSubscribed();
        if (cancelled) return;
        if (subscribed) {
          // Enabled — the prompt has done its job; hide it immediately.
          setShowNotificationReminder(false);
          return;
        }
        setShowNotificationReminder(true);
      } catch {
        // Notification setup is optional and must never affect the profile view.
      }
    };
    // Own heartbeat (independent of the intent countdown, which only runs with
    // a live intent) + focus/visibility, so a subscription started elsewhere —
    // e.g. from the Notifications sheet or the OS settings — retires the prompt.
    void checkReminder();
    const id = window.setInterval(() => { void checkReminder(); }, 30000);
    const onWake = () => { void checkReminder(); };
    window.addEventListener('focus', onWake);
    document.addEventListener('visibilitychange', onWake);
    return () => {
      cancelled = true;
      window.clearInterval(id);
      window.removeEventListener('focus', onWake);
      document.removeEventListener('visibilitychange', onWake);
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    let loading = false;
    let lastRefreshAt = 0;
    const refreshPhotos = async () => {
      if (cancelled || loading) return;
      loading = true;
      try {
        const items = await loadProfilePhotos();
        if (cancelled) return;
        setPhotos(items);
        const primary = items.find((p) => p.isPrimary) || items[0];
        onAvatarUpdated?.(primary?.url);
        lastRefreshAt = Date.now();
      } catch {
        if (!cancelled) setPhotoMessage('Profile photos are unavailable right now.');
      } finally {
        loading = false;
      }
    };
    void refreshPhotos();
    const timer = window.setInterval(() => { void refreshPhotos(); }, PHOTO_URL_REFRESH_MS);
    const resume = () => {
      if (document.visibilityState !== 'hidden' && Date.now() - lastRefreshAt >= PHOTO_URL_REFRESH_MS) {
        void refreshPhotos();
      }
    };
    window.addEventListener('pageshow', resume);
    window.addEventListener('online', resume);
    document.addEventListener('visibilitychange', resume);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
      window.removeEventListener('pageshow', resume);
      window.removeEventListener('online', resume);
      document.removeEventListener('visibilitychange', resume);
    };
  }, [onAvatarUpdated]);

  const syncPrimaryAvatar = useCallback((updatedPhotos: ProfilePhoto[]) => {
    const primary = updatedPhotos.find((p) => p.isPrimary) || updatedPhotos[0];
    onAvatarUpdated?.(primary?.url);
  }, [onAvatarUpdated]);

  const handleUploadPhoto = async (file: File | undefined) => {
    if (!file || photoBusy) return;
    setPhotoBusy(true);
    setPhotoMessage(null);
    try {
      const nextPhotos = await uploadProfilePhoto(file);
      setPhotos(nextPhotos);
      syncPrimaryAvatar(nextPhotos);
      hapticLight();
    } catch (error) {
      setPhotoMessage(error instanceof Error ? error.message : 'Could not add that photo.');
    } finally {
      setPhotoBusy(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  const handleDeletePhoto = async (photo: ProfilePhoto) => {
    if (photoBusy) return;
    setPhotoBusy(true);
    setPhotoMessage(null);
    setConfirmDeleteId(null);
    try {
      const nextPhotos = await deleteProfilePhoto(photo);
      setPhotos(nextPhotos);
      syncPrimaryAvatar(nextPhotos);
      triggerVibration([30, 40]);
    } catch (error) {
      setPhotoMessage(error instanceof Error ? error.message : 'Could not remove that photo.');
    } finally {
      setPhotoBusy(false);
    }
  };

  const handleSetPrimaryPhoto = async (photo: ProfilePhoto) => {
    if (photoBusy) return;
    setPhotoBusy(true);
    setPhotoMessage(null);
    try {
      const nextPhotos = await setPrimaryProfilePhoto(photo.id);
      setPhotos(nextPhotos);
      syncPrimaryAvatar(nextPhotos);
      hapticLight();
    } catch (error) {
      setPhotoMessage(error instanceof Error ? error.message : 'Could not set the profile photo.');
    } finally {
      setPhotoBusy(false);
    }
  };

  const handleMovePhoto = async (index: number, direction: 'left' | 'right') => {
    if (photoBusy) return;
    const targetIndex = direction === 'left' ? index - 1 : index + 1;
    if (targetIndex < 0 || targetIndex >= photos.length) return;

    const reordered = [...photos];
    const [moved] = reordered.splice(index, 1);
    reordered.splice(targetIndex, 0, moved);

    setPhotos(reordered);
    setPhotoBusy(true);
    try {
      const nextPhotos = await reorderProfilePhotos(reordered.map((p) => p.id));
      setPhotos(nextPhotos);
      syncPrimaryAvatar(nextPhotos);
      hapticLight();
    } catch (error) {
      setPhotoMessage(error instanceof Error ? error.message : 'Could not reorder photos.');
    } finally {
      setPhotoBusy(false);
    }
  };

  // Keyboard navigation for full-screen photo viewer
  useEffect(() => {
    if (viewerIndex === null) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setViewerIndex(null);
      } else if (e.key === 'ArrowLeft' && viewerIndex > 0) {
        setViewerIndex(viewerIndex - 1);
      } else if (e.key === 'ArrowRight' && viewerIndex < photos.length - 1) {
        setViewerIndex(viewerIndex + 1);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [viewerIndex, photos.length]);

  const initials = currentUser.displayName
    .split(/\s+/)
    .map((part) => part.charAt(0))
    .join('')
    .slice(0, 2)
    .toUpperCase();

  const primaryPhoto = photos.find((p) => p.isPrimary) || photos[0];
  const displayAvatarUrl = primaryPhoto?.url || currentUser.avatarUrl;

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

  // Profile completion — the checklist that materially improves matching.
  const completion = computeProfileCompletion({
    hasPhoto: photos.length > 0 || Boolean(currentUser.avatarUrl),
    lookingForCount: currentUser.interests.length,
    interestCount: currentUser.hobbies?.length ?? 0,
    hasIntimacy: Boolean(
      currentUser.intimacy?.role
      || (currentUser.intimacy?.preferences.length ?? 0) > 0
      || (currentUser.intimacy?.experience && currentUser.intimacy.experience !== 'Not specified'),
    ),
    setupCount: currentUser.mySetup?.length ?? 0,
    hasBio: Boolean(currentUser.bio && currentUser.bio.trim()),
  });
  const intimacyVisibilityLabel = currentUser.intimacy
    ? INTIMACY_VISIBILITY_OPTIONS.find((option) => option.value === currentUser.intimacy?.visibility)?.label
    : undefined;
  const factTags = [
    currentUser.pronouns,
    currentUser.heightCm ? `${currentUser.heightCm} cm` : undefined,
    currentUser.bodyType,
  ].filter((value): value is string => Boolean(value));
  const hasIntimacySection = Boolean(
    currentUser.intimacy && (
      currentUser.intimacy.role
      || currentUser.intimacy.preferences.length > 0
      || (currentUser.intimacy.experience && currentUser.intimacy.experience !== 'Not specified')
    ),
  );

  const emptySlotsCount = Math.max(0, MAX_PHOTOS - photos.length);

  return (
    <div className="gayze-premium-page max-w-xl mx-auto pb-8 px-4 pt-2">
      <header className="pt-4 pb-2">
        <span className="g-label">Profile</span>
      </header>

      {/* Identity — prominent primary photo, authentic personal presence */}
      <section className="flex items-center gap-4 py-4">
        <div
          onClick={() => {
            if (photos.length > 0) setViewerIndex(0);
          }}
          className={`g-avatar g-avatar--private w-20 h-20 !rounded-[24px] text-[22px] overflow-hidden shrink-0 shadow-lg shadow-black/40 border border-white/10 ${
            photos.length > 0 ? 'cursor-pointer hover:border-[#6F3CC3]/50 transition-colors' : ''
          }`}
          title={photos.length > 0 ? 'View full photo' : undefined}
        >
          {displayAvatarUrl ? (
            <img
              src={displayAvatarUrl}
              alt={currentUser.displayName}
              className="w-full h-full object-cover"
            />
          ) : (
            initials
          )}
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 flex-wrap">
            <h1 className="text-[22px] font-bold tracking-[-0.02em] text-white truncate">
              {currentUser.displayName}
            </h1>
            {currentUser.safetyVerified && (
              <span className="g-badge g-badge--verify">
                <ShieldCheck className="w-3 h-3" /> Verified
              </span>
            )}
          </div>
          <div className="text-[12px] text-zinc-400 mt-1 truncate">
            {[currentUser.age ? String(currentUser.age) : null, currentUser.pronouns || null, areaLabel || currentUser.neighborhood]
              .filter(Boolean)
              .join(' · ')}{' '}
            · approximate area
          </div>
          <div className="flex items-center gap-2 mt-2 flex-wrap">
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
          onClick={() => {
            hapticLight();
            if (onOpenProfileEdit) onOpenProfileEdit('identity');
            else onOpenIdentity();
          }}
          className="g-icon-btn shrink-0"
          aria-label="Edit profile"
        >
          <Edit3 className="w-4 h-4" />
        </button>
      </section>

      {/* Profile completion — a quiet nudge, never a blocking checklist */}
      {completion.missing.length > 0 && (
        <button
          type="button"
          onClick={() => { hapticLight(); onOpenProfileEdit?.(completion.missing[0].section as EditSectionKey); }}
          className="w-full text-left rounded-2xl border border-white/[0.07] bg-white/[0.02] px-4 py-3 mb-4 hover:bg-white/[0.04] transition-colors"
          aria-label="Improve your profile"
        >
          <div className="min-w-0">
            <span className="g-label">
              Profile · {completion.percent}% complete
            </span>
            <div className="text-[12.5px] text-zinc-300 mt-0.5 truncate">
              Make your profile more useful — {completion.missing.length} quick {completion.missing.length === 1 ? 'thing' : 'things'} to add
            </div>
          </div>
          <div className="mt-2.5 h-1.5 rounded-full bg-white/[0.06] overflow-hidden">
            <div
              className="h-full rounded-full transition-all duration-300"
              style={{
                width: `${completion.percent}%`,
                background: 'var(--brand-purple)',
              }}
            />
          </div>
        </button>
      )}

      {/* Profile photos — first-class gallery with reordering, primary designation, and full-screen view */}
      <section className="g-panel p-4 mb-5">
        <div className="flex items-center justify-between gap-3 mb-3">
          <div>
            <div className="flex items-center gap-2">
              <span className="g-label">Profile photos</span>
              <span className="text-[11px] font-mono text-zinc-500">
                {photos.length}/{MAX_PHOTOS}
              </span>
            </div>
            <p className="text-[12px] text-zinc-400 mt-0.5">Your first photo is your public avatar. Add up to 6.</p>
          </div>
          {photos.length < MAX_PHOTOS && (
            <label className="g-btn g-btn--quiet !min-h-[36px] !px-3 cursor-pointer shrink-0">
              <Camera className="w-3.5 h-3.5 text-[#b796f0]" />
              <span>{photoBusy ? 'Uploading…' : 'Add photo'}</span>
              <input
                ref={fileInputRef}
                type="file"
                accept="image/jpeg,image/png,image/webp,image/heic,image/heif"
                className="hidden"
                disabled={photoBusy}
                onChange={(event) => {
                  void handleUploadPhoto(event.target.files?.[0]);
                }}
              />
            </label>
          )}
        </div>

        {/* Photo Grid */}
        <div className="grid grid-cols-3 gap-2.5">
          {photos.map((photo, index) => {
            const isPrimary = photo.isPrimary || index === 0;
            const isConfirmingDelete = confirmDeleteId === photo.id;

            return (
              <div
                key={photo.id}
                className="relative aspect-square rounded-[18px] overflow-hidden bg-[#11131a] border border-white/10 group shadow-md"
              >
                <button
                  type="button"
                  className="absolute inset-0 w-full h-full cursor-pointer focus:outline-none"
                  onClick={() => setViewerIndex(index)}
                  aria-label={`View photo ${index + 1}`}
                >
                  <img src={photo.url} alt="" className="w-full h-full object-cover transition-transform group-hover:scale-105" />
                </button>

                {/* Primary Photo Badge */}
                {isPrimary && (
                  <span className="absolute top-2 left-2 g-badge g-badge--verify !text-[10px] !px-2 shadow-lg backdrop-blur-md pointer-events-none">
                    <Star className="w-2.5 h-2.5 fill-current" /> Profile
                  </span>
                )}

                {/* Confirm Delete Overlay */}
                {isConfirmingDelete ? (
                  <div className="absolute inset-0 bg-black/85 backdrop-blur-sm p-2 flex flex-col items-center justify-center text-center z-20 animate-in fade-in">
                    <AlertTriangle className="w-4 h-4 text-amber-400 mb-1" />
                    <span className="text-[10.5px] font-semibold text-white leading-tight mb-2">Remove photo?</span>
                    <div className="flex items-center gap-1.5 w-full">
                      <button
                        type="button"
                        onClick={() => setConfirmDeleteId(null)}
                        className="flex-1 h-7 rounded-lg bg-white/10 text-[10px] font-medium text-zinc-300 hover:text-white"
                      >
                        Cancel
                      </button>
                      <button
                        type="button"
                        onClick={() => void handleDeletePhoto(photo)}
                        disabled={photoBusy}
                        className="flex-1 h-7 rounded-lg bg-red-600/80 text-[10px] font-medium text-white hover:bg-red-500"
                      >
                        Delete
                      </button>
                    </div>
                  </div>
                ) : (
                  <>
                    {/* Reorder Buttons */}
                    <div className="absolute top-2 right-2 flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                      {index > 0 && (
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            void handleMovePhoto(index, 'left');
                          }}
                          disabled={photoBusy}
                          className="w-6 h-6 rounded-md bg-black/70 backdrop-blur-md border border-white/15 text-zinc-300 hover:text-white flex items-center justify-center cursor-pointer"
                          aria-label="Move photo left"
                        >
                          <ArrowLeft className="w-3 h-3" />
                        </button>
                      )}
                      {index < photos.length - 1 && (
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            void handleMovePhoto(index, 'right');
                          }}
                          disabled={photoBusy}
                          className="w-6 h-6 rounded-md bg-black/70 backdrop-blur-md border border-white/15 text-zinc-300 hover:text-white flex items-center justify-center cursor-pointer"
                          aria-label="Move photo right"
                        >
                          <ArrowRight className="w-3 h-3" />
                        </button>
                      )}
                    </div>

                    {/* Bottom Actions */}
                    <div className="absolute bottom-2 inset-x-2 flex items-center justify-between gap-1">
                      {!isPrimary ? (
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            void handleSetPrimaryPhoto(photo);
                          }}
                          disabled={photoBusy}
                          className="h-7 px-2 rounded-lg bg-black/75 backdrop-blur-md border border-white/15 text-[10px] font-medium text-zinc-200 hover:text-white transition-colors cursor-pointer"
                        >
                          Make profile
                        </button>
                      ) : <span />}

                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          setConfirmDeleteId(photo.id);
                        }}
                        disabled={photoBusy}
                        className="w-7 h-7 rounded-lg bg-black/75 backdrop-blur-md border border-white/15 flex items-center justify-center text-zinc-400 hover:text-red-400 transition-colors cursor-pointer ml-auto"
                        aria-label="Delete photo"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </>
                )}
              </div>
            );
          })}

          {/* Empty Slot Card / Add Photo trigger */}
          {photos.length < MAX_PHOTOS && (
            <label className="relative aspect-square rounded-[18px] border border-dashed border-white/15 bg-white/[0.02] hover:bg-white/[0.04] transition-all flex flex-col items-center justify-center cursor-pointer text-center p-2 group">
              <div className="w-8 h-8 rounded-full bg-white/[0.05] border border-white/10 flex items-center justify-center mb-1 group-hover:border-[#6F3CC3]/60 group-hover:bg-[#6F3CC3]/10 transition-colors">
                <Plus className="w-4 h-4 text-[#b796f0]" />
              </div>
              <span className="text-[11px] font-semibold text-zinc-300">Add</span>
              <input
                type="file"
                accept="image/jpeg,image/png,image/webp,image/heic,image/heif"
                className="hidden"
                disabled={photoBusy}
                onChange={(event) => {
                  void handleUploadPhoto(event.target.files?.[0]);
                }}
              />
            </label>
          )}

          {/* Remaining placeholder frames */}
          {Array.from({ length: Math.max(0, emptySlotsCount - 1) }).map((_, i) => (
            <div
              key={`empty-${i}`}
              className="relative aspect-square rounded-[18px] border border-dashed border-white/[0.07] bg-white/[0.01] flex items-center justify-center"
            >
              <div className="w-2 h-2 rounded-full bg-white/[0.08]" />
            </div>
          ))}
        </div>

        {photoMessage && (
          <div className="text-[11.5px] text-amber-300 mt-3 px-1 flex items-center gap-1.5">
            <AlertTriangle className="w-3.5 h-3.5 shrink-0" />
            <span>{photoMessage}</span>
          </div>
        )}
      </section>

      {showNotificationReminder && onOpenNotifications && (
        <button
          type="button"
          className="g-profile-notification-banner w-full mb-4 text-left"
          onClick={() => { hapticLight(); onOpenNotifications(); }}
        >
          <span className="g-profile-notification-banner__icon" aria-hidden="true">
            <Bell className="w-4 h-4" />
          </span>
          <span className="min-w-0 flex-1">
            <span className="block text-[13px] font-bold text-white">Notifications are off</span>
            <span className="block text-[11px] text-zinc-400 mt-0.5">Turn them on to receive messages and intent activity.</span>
          </span>
          <span className="g-profile-notification-banner__action">Enable</span>
        </button>
      )}

      {/* ---------------- Profile summary — only sections with content ---------------- */}
      {((currentUser.bio && currentUser.bio.trim()) || factTags.length > 0) && (
        <section className="mb-5">
          <span className="g-label">About you</span>
          {(currentUser.bio && currentUser.bio.trim()) && (
            <p className="mt-2 text-[13.5px] leading-relaxed text-zinc-200">“{currentUser.bio.trim()}”</p>
          )}
          {factTags.length > 0 && (
            <div className="flex flex-wrap gap-1.5 mt-2.5">
              {factTags.map((tag) => (
                <span key={tag} className="g-tag">{tag}</span>
              ))}
            </div>
          )}
        </section>
      )}

      {currentUser.interests.length > 0 && (
        <section className="mb-5">
          <span className="g-label">Looking for</span>
          <div className="flex flex-wrap gap-1.5 mt-2.5">
            {currentUser.interests.map((interest) => (
              <span key={interest} className="g-tag">{interest}</span>
            ))}
          </div>
        </section>
      )}

      {(currentUser.hobbies?.length ?? 0) > 0 && (
        <section className="mb-5">
          <span className="g-label">Interests</span>
          <div className="flex flex-wrap gap-1.5 mt-2.5">
            {currentUser.hobbies!.map((hobby) => (
              <span key={hobby} className="g-tag">{hobby}</span>
            ))}
          </div>
        </section>
      )}

      {hasIntimacySection && currentUser.intimacy && (
        <section className="mb-5">
          <div className="flex items-center justify-between gap-3">
            <span className="g-label">Intimacy</span>
            {intimacyVisibilityLabel && (
              <span className="g-badge g-badge--quiet">{intimacyVisibilityLabel}</span>
            )}
          </div>
          <div className="flex flex-wrap gap-1.5 mt-2.5">
            {currentUser.intimacy.role && (
              <span className="g-chip g-chip--private">{currentUser.intimacy.role}</span>
            )}
            {currentUser.intimacy.preferences.map((preference) => (
              <span key={preference} className="g-tag">{preference}</span>
            ))}
            {currentUser.intimacy.experience && currentUser.intimacy.experience !== 'Not specified' && (
              <span className="g-tag">{currentUser.intimacy.experience}</span>
            )}
          </div>
        </section>
      )}

      {((currentUser.mySetup?.length ?? 0) > 0 || (currentUser.availability?.length ?? 0) > 0) && (
        <section className="mb-5">
          <span className="g-label">My setup</span>
          <div className="flex flex-wrap gap-1.5 mt-2.5">
            {(currentUser.mySetup ?? []).map((setup) => (
              <span key={setup} className="g-tag">{setup}</span>
            ))}
            {(currentUser.availability ?? []).map((when) => (
              <span key={when} className="g-chip g-chip--quiet">{when}</span>
            ))}
          </div>
        </section>
      )}

      {(currentUser.boundaries?.length ?? 0) > 0 && (
        <section className="mb-5">
          <span className="g-label">Boundaries</span>
          <div className="flex flex-wrap gap-1.5 mt-2.5">
            {currentUser.boundaries!.map((boundary) => (
              <span key={boundary} className="g-tag">{boundary}</span>
            ))}
          </div>
        </section>
      )}

      {/* Notifications — always-visible Web Push entry point */}
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

      {onSignOut && (
        <button
          type="button"
          disabled={signingOut}
          onClick={() => { hapticLight(); void onSignOut(); }}
          className="w-full mb-5 h-11 rounded-xl border border-red-400/20 bg-red-400/5 text-red-300 hover:bg-red-400/10 disabled:opacity-50 text-[13px] font-semibold transition-colors flex items-center justify-center gap-2"
        >
          <LogOut className="w-4 h-4" />
          {signingOut ? 'Signing out…' : 'Sign Out'}
        </button>
      )}

      {/* Footer */}
      <footer className="flex items-center justify-between px-1 pb-4 opacity-75">
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

      {/* Full-screen Photo Lightbox / Viewer with Swipe and Navigation */}
      {viewerIndex !== null && photos[viewerIndex] && (
        <div
          className="fixed inset-0 z-[80] bg-black/95 backdrop-blur-md flex flex-col justify-between p-4 select-none animate-in fade-in duration-200"
          onTouchStart={(e) => {
            touchStartXRef.current = e.touches[0].clientX;
          }}
          onTouchEnd={(e) => {
            if (touchStartXRef.current === null) return;
            const deltaX = e.changedTouches[0].clientX - touchStartXRef.current;
            if (deltaX > 45 && viewerIndex > 0) {
              setViewerIndex(viewerIndex - 1);
              hapticLight();
            } else if (deltaX < -45 && viewerIndex < photos.length - 1) {
              setViewerIndex(viewerIndex + 1);
              hapticLight();
            }
            touchStartXRef.current = null;
          }}
        >
          {/* Top Bar */}
          <div className="flex items-center justify-between text-white w-full max-w-xl mx-auto pt-2 z-10">
            <span className="text-[13px] font-mono text-zinc-400">
              {viewerIndex + 1} / {photos.length}
            </span>
            <button
              type="button"
              onClick={() => setViewerIndex(null)}
              className="g-icon-btn cursor-pointer bg-white/10 hover:bg-white/20 border-white/15"
              aria-label="Close photo"
            >
              <X className="w-4 h-4 text-white" />
            </button>
          </div>

          {/* Centered Image with Nav Chevrons */}
          <div className="relative flex-1 flex items-center justify-center w-full max-w-xl mx-auto my-auto overflow-hidden">
            {viewerIndex > 0 && (
              <button
                type="button"
                onClick={() => {
                  setViewerIndex(viewerIndex - 1);
                  hapticLight();
                }}
                className="absolute left-2 top-1/2 -translate-y-1/2 w-10 h-10 rounded-full bg-black/60 border border-white/15 text-white flex items-center justify-center z-10 hover:bg-black/80 transition-colors"
                aria-label="Previous photo"
              >
                <ChevronLeft className="w-5 h-5" />
              </button>
            )}

            <img
              src={photos[viewerIndex].url}
              alt=""
              className="max-h-[75vh] max-w-full object-contain rounded-2xl shadow-2xl"
            />

            {viewerIndex < photos.length - 1 && (
              <button
                type="button"
                onClick={() => {
                  setViewerIndex(viewerIndex + 1);
                  hapticLight();
                }}
                className="absolute right-2 top-1/2 -translate-y-1/2 w-10 h-10 rounded-full bg-black/60 border border-white/15 text-white flex items-center justify-center z-10 hover:bg-black/80 transition-colors"
                aria-label="Next photo"
              >
                <ChevronRight className="w-5 h-5" />
              </button>
            )}
          </div>

          {/* Bottom Indicators */}
          <div className="flex items-center justify-center gap-1.5 pb-4 z-10">
            {photos.map((_, i) => (
              <button
                key={i}
                type="button"
                onClick={() => setViewerIndex(i)}
                className={`w-2 h-2 rounded-full transition-all ${
                  i === viewerIndex ? 'w-6 bg-[#C9A24D]' : 'bg-white/20'
                }`}
                aria-label={`Go to photo ${i + 1}`}
              />
            ))}
          </div>
        </div>
      )}
    </div>
  );
};
