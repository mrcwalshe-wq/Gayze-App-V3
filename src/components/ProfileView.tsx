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
  BellOff,
  LogOut,
  Ban,
  UserRoundX,
} from 'lucide-react';
import {
  type EditSectionKey,
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
import { loadBlockedUsers, unblockUser, type BlockedUser } from '../services/blockService';

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
  onDeleteAccount?: () => void | Promise<void>;
  deletingAccount?: boolean;
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
  onDeleteAccount,
  deletingAccount = false,
}) => {
  const [now, setNow] = useState(Date.now());
  const [photos, setPhotos] = useState<ProfilePhoto[]>([]);
  const [photoBusy, setPhotoBusy] = useState(false);
  const [photoMessage, setPhotoMessage] = useState<string | null>(null);
  const [viewerIndex, setViewerIndex] = useState<number | null>(null);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const [showNotificationReminder, setShowNotificationReminder] = useState(false);
  const [notificationBlockReason, setNotificationBlockReason] = useState<'ios-needs-install' | 'permission-denied' | null>(null);
  const [blockedUsersOpen, setBlockedUsersOpen] = useState(false);
  const [blockedUsers, setBlockedUsers] = useState<BlockedUser[]>([]);
  const [blockedUsersLoading, setBlockedUsersLoading] = useState(false);
  const [blockedUsersError, setBlockedUsersError] = useState<string | null>(null);
  const [unblockingUserId, setUnblockingUserId] = useState<string | null>(null);

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

  const refreshProfilePhotos = useCallback(async () => {
    try {
      const items = await loadProfilePhotos();
      setPhotos(items);
      const primary = items.find((p) => p.isPrimary) || items[0];
      if (primary) onAvatarUpdated?.(primary.url);
    } catch {
      // Signed URL refresh is best-effort; keep the existing gallery if it fails.
    }
  }, [onAvatarUpdated]);

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      try {
        const items = await loadProfilePhotos();
        if (cancelled) return;
        setPhotos(items);
        const primary = items.find((p) => p.isPrimary) || items[0];
        if (primary) onAvatarUpdated?.(primary.url);
      } catch {
        if (!cancelled) setPhotoMessage('Profile photos are unavailable right now.');
      }
    };
    void load();

    const refresh = () => {
      if (!cancelled && document.visibilityState !== 'hidden') void refreshProfilePhotos();
    };
    const intervalId = window.setInterval(refresh, PHOTO_URL_REFRESH_MS);
    window.addEventListener('pageshow', refresh);
    window.addEventListener('online', refresh);
    document.addEventListener('visibilitychange', refresh);
    return () => {
      cancelled = true;
      window.clearInterval(intervalId);
      window.removeEventListener('pageshow', refresh);
      window.removeEventListener('online', refresh);
      document.removeEventListener('visibilitychange', refresh);
    };
  }, [onAvatarUpdated, refreshProfilePhotos]);

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

  const refreshBlockedUsers = async () => {
    setBlockedUsersLoading(true);
    setBlockedUsersError(null);
    try {
      setBlockedUsers(await loadBlockedUsers());
    } catch (error) {
      setBlockedUsersError(error instanceof Error ? error.message : 'Could not load blocked users.');
    } finally {
      setBlockedUsersLoading(false);
    }
  };

  const handleUnblockUser = async (user: BlockedUser) => {
    if (!window.confirm(`Unblock ${user.displayName}? They may be able to find and contact you again, subject to your intent settings.`)) return;
    setUnblockingUserId(user.userId);
    setBlockedUsersError(null);
    try {
      await unblockUser(user.userId);
      setBlockedUsers((previous) => previous.filter((item) => item.userId !== user.userId));
    } catch (error) {
      setBlockedUsersError(error instanceof Error ? error.message : 'Could not unblock this user.');
    } finally {
      setUnblockingUserId(null);
    }
  };

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
    setupCount: currentUser.mySetup?.length ?? 0,
    hasBio: Boolean(currentUser.bio && currentUser.bio.trim()),
  });
  const factTags = [
    currentUser.pronouns,
    currentUser.heightCm ? `${currentUser.heightCm} cm` : undefined,
    currentUser.bodyType,
  ].filter((value): value is string => Boolean(value));

  const emptySlotsCount = Math.max(0, MAX_PHOTOS - photos.length);

  return (
    <div className="gayze-premium-page max-w-xl mx-auto pb-8 px-4 pt-2">
      <header className="pt-4 pb-2">
        <span className="g-label">Profile</span>
      </header>

      {showNotificationReminder && onOpenNotifications && (
        <button
          type="button"
          className="g-profile-notification-banner g-profile-notification-banner--top w-full mb-4 text-left"
          onClick={() => { hapticLight(); onOpenNotifications(); }}
        >
          <span className="g-profile-notification-banner__icon" aria-hidden="true">
            {notificationBlockReason === 'permission-denied' ? <BellOff className="w-4 h-4" /> : <Bell className="w-4 h-4" />}
          </span>
          <span className="min-w-0 flex-1">
            <span className="block text-[13px] font-bold text-white">
              {notificationBlockReason === 'ios-needs-install' ? 'Add GAYZE to your Home Screen' : notificationBlockReason === 'permission-denied' ? 'Notifications are blocked' : 'Turn on notifications'}
            </span>
            <span className="block text-[11px] text-zinc-400 mt-0.5">
              {notificationBlockReason === 'ios-needs-install' ? 'Required on iPhone for push notifications.' : notificationBlockReason === 'permission-denied' ? 'Enable GAYZE in iPhone Settings.' : 'Get messages, Gayzes and intent alerts.'}
            </span>
          </span>
          <span className="g-profile-notification-banner__action">{notificationBlockReason === 'permission-denied' ? 'Settings' : 'Enable'}</span>
        </button>
      )}

      {/* Identity — prominent primary photo, authentic personal presence */}
      <section className="g-profile-id flex items-start gap-4 py-4">
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
          className="g-btn g-btn--quiet !min-h-[36px] !px-3 shrink-0"
          aria-label="Edit profile"
        >
          <Edit3 className="w-3.5 h-3.5" />
          Edit
        </button>
      </section>

      {/* Profile photos — first-class gallery with reordering, primary designation, and full-screen view */}
      <section className="g-panel g-gayze-menu-frame p-4 mb-5">
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
                    <div className="absolute top-2 right-2 flex items-center gap-1.5">
                      {index > 0 && (
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            void handleMovePhoto(index, 'left');
                          }}
                          disabled={photoBusy}
                          className="w-8 h-8 rounded-lg bg-black/70 backdrop-blur-md border border-white/15 text-zinc-300 hover:text-white flex items-center justify-center cursor-pointer"
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
                          className="w-8 h-8 rounded-lg bg-black/70 backdrop-blur-md border border-white/15 text-zinc-300 hover:text-white flex items-center justify-center cursor-pointer"
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
              className="g-photo-slot relative aspect-square rounded-[18px] border border-dashed border-white/[0.07] bg-white/[0.01]"
              aria-hidden="true"
            />
          ))}
        </div>

        {photoMessage && (
          <div className="text-[11.5px] text-amber-300 mt-3 px-1 flex items-center gap-1.5">
            <AlertTriangle className="w-3.5 h-3.5 shrink-0" />
            <span>{photoMessage}</span>
          </div>
        )}
      </section>

      {/* ---------------- Profile summary — a read-only snapshot of onboarding choices ---------------- */}
      {(() => {
        const lookingFor = currentUser.interests ?? [];
        const interests = currentUser.hobbies ?? [];
        const setup = currentUser.mySetup ?? [];
        const availability = currentUser.availability ?? [];
        const boundaries = currentUser.boundaries ?? [];
        const identity = [
          currentUser.pronouns,
          currentUser.heightCm ? `${currentUser.heightCm} cm` : undefined,
          currentUser.bodyType,
        ].filter(Boolean) as string[];

        const joinList = (values: string[]) => {
          if (values.length <= 1) return values[0] ?? '';
          if (values.length === 2) return values.join(' and ');
          return `${values.slice(0, -1).join(', ')}, and ${values[values.length - 1]}`;
        };

        return (
          <section className="g-panel g-gayze-menu-frame overflow-hidden mb-5">
            <div className="px-4 pt-4 pb-3 flex items-start justify-between gap-3">
              <div className="min-w-0">
                <span className="g-label">Your profile</span>
                <h2 className="text-[17px] font-bold text-white mt-1">The short version</h2>
              </div>
              <button
                type="button"
                className="g-btn g-btn--quiet !min-h-[36px] !px-3 shrink-0"
                onClick={() => {
                  hapticLight();
                  if (onOpenProfileEdit) onOpenProfileEdit('identity');
                  else onOpenIdentity();
                }}
                aria-label="Edit profile"
              >
                <Edit3 className="w-3.5 h-3.5" />
                Edit
              </button>
            </div>

            <div className="px-4 pb-4">
              {currentUser.bio?.trim() && (
                <p className="text-[14px] leading-relaxed text-zinc-200 mb-4">
                  “{currentUser.bio.trim()}”
                </p>
              )}

              {identity.length > 0 && (
                <div className="flex flex-wrap gap-1.5 mb-4">
                  {identity.map((value) => (
                    <span key={value} className="g-tag">{value}</span>
                  ))}
                </div>
              )}

              <div className="space-y-3">
                {lookingFor.length > 0 && (
                  <div>
                    <span className="g-label">Looking for</span>
                    <p className="text-[13px] leading-relaxed text-zinc-200 mt-1">
                      {joinList(lookingFor)}.
                    </p>
                  </div>
                )}

                {interests.length > 0 && (
                  <div>
                    <span className="g-label">Into</span>
                    <p className="text-[13px] leading-relaxed text-zinc-200 mt-1">
                      {joinList(interests)}.
                    </p>
                  </div>
                )}

                {(setup.length > 0 || availability.length > 0) && (
                  <div>
                    <span className="g-label">Setup</span>
                    <p className="text-[13px] leading-relaxed text-zinc-200 mt-1">
                      {[setup.length > 0 ? joinList(setup) : '', availability.length > 0 ? `available ${joinList(availability)}` : '']
                        .filter(Boolean)
                        .join(' · ')}.
                    </p>
                  </div>
                )}

                {boundaries.length > 0 && (
                  <div>
                    <span className="g-label">Boundaries</span>
                    <p className="text-[13px] leading-relaxed text-zinc-200 mt-1">
                      {joinList(boundaries)}.
                    </p>
                  </div>
                )}
              </div>

              {!currentUser.bio?.trim() &&
                identity.length === 0 &&
                lookingFor.length === 0 &&
                interests.length === 0 &&
                setup.length === 0 &&
                availability.length === 0 &&
                boundaries.length === 0 && (
                  <p className="text-[13px] text-zinc-500">
                    Your profile choices will appear here as a simple summary.
                  </p>
                )}
            </div>
          </section>
        );
      })()}

      {/* Notifications — always-visible Web Push entry point */}
      {/* Safety & privacy */}
      <section className="g-panel g-gayze-menu-frame overflow-hidden mb-5">
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
        <hr className="g-divider" />
        <button
          type="button"
          className="g-row"
          aria-expanded={blockedUsersOpen}
          onClick={() => {
            hapticLight();
            const opening = !blockedUsersOpen;
            setBlockedUsersOpen(opening);
            if (opening) void refreshBlockedUsers();
          }}
        >
          <span className={`flex items-center justify-center w-8 h-8 rounded-[10px] border shrink-0 ${toneClass('purple')}`}>
            <Ban className="w-4 h-4" />
          </span>
          <span className="min-w-0 flex-1">
            <span className="block text-[13.5px] font-bold text-white">Blocked users</span>
            <span className="block text-[11px] text-zinc-500">{blockedUsers.length} {blockedUsers.length === 1 ? 'person' : 'people'} blocked</span>
          </span>
          <ChevronRight className={`w-4 h-4 text-zinc-600 shrink-0 transition-transform ${blockedUsersOpen ? 'rotate-90' : ''}`} />
        </button>
        {blockedUsersOpen && (
          <div className="px-4 pb-4">
            {blockedUsersLoading ? (
              <p className="py-3 text-sm text-zinc-500">Loading blocked users…</p>
            ) : blockedUsersError ? (
              <div className="py-3">
                <p role="alert" className="text-sm text-red-300">{blockedUsersError}</p>
                <button type="button" className="mt-2 text-sm text-[#c9b0f5] underline" onClick={() => void refreshBlockedUsers()}>Try again</button>
              </div>
            ) : blockedUsers.length === 0 ? (
              <p className="py-3 text-sm text-zinc-500">You haven’t blocked anyone.</p>
            ) : (
              <div className="divide-y divide-white/[0.07]">
                {blockedUsers.map((user) => (
                  <div key={user.userId} className="flex items-center gap-3 py-3">
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-semibold text-white">{user.displayName}</p>
                      {user.handle && <p className="truncate text-xs text-zinc-500">@{user.handle}</p>}
                    </div>
                    <button
                      type="button"
                      disabled={unblockingUserId === user.userId}
                      className="shrink-0 rounded-lg border border-white/10 px-3 py-2 text-xs font-semibold text-[#d7c4fa] disabled:opacity-50"
                      onClick={() => void handleUnblockUser(user)}
                    >
                      {unblockingUserId === user.userId ? 'Unblocking…' : 'Unblock'}
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
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

      {onDeleteAccount && (
        <section className="g-panel g-panel--danger mb-5 overflow-hidden border border-red-400/20">
          <div className="p-4">
            <div className="flex items-start gap-3">
              <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border border-red-400/20 bg-red-400/5 text-red-300">
                <UserRoundX className="h-4 w-4" />
              </span>
              <div className="min-w-0 flex-1">
                <h3 className="text-sm font-bold text-white">Delete account</h3>
                <p className="mt-1 text-xs leading-relaxed text-zinc-400">Permanently delete your GAYZE account, profile and associated data. This cannot be undone.</p>
                <button
                  type="button"
                  disabled={deletingAccount}
                  className="mt-3 inline-flex min-h-10 items-center justify-center gap-2 rounded-xl border border-red-400/25 bg-red-400/10 px-3.5 text-xs font-bold text-red-300 disabled:opacity-50"
                  onClick={() => { hapticLight(); void onDeleteAccount(); }}
                >
                  <UserRoundX className="h-4 w-4" />
                  {deletingAccount ? 'Deleting account…' : 'Delete my account'}
                </button>
              </div>
            </div>
          </div>
        </section>
      )}

      {/* Footer */}
      <footer className="flex items-center justify-center gap-2 px-1 pb-6 text-zinc-500">
        <Radio className="w-3.5 h-3.5 text-[#6F3CC3]" aria-hidden="true" />
        <span className="text-[11px] font-semibold tracking-[0.14em] text-zinc-400">GAYZE</span>
        <span className="text-[11px] text-zinc-600">Real Intent. Real Time.</span>
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
