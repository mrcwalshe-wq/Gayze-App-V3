/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */
import { DeletedRoomTracker } from './services/deletedRooms';
import { findDirectRoom, resolveLiveDirectChat, isConversationId } from './services/directChatRouting';
import type { ChatConnectionState } from './services/realtimeRecovery';
import type { MessageDelivery } from './services/chatSubscriptions';
import { watchNotificationInbox, markNotificationRead, type NotificationInbox, type InboxNotification } from './services/notificationInbox';
import { mergeMessage, mergeMessages } from './services/messageMerge';
import { ChatMessageProcessor, MessageBatcher } from './services/chatMessageProcessing';
import { beginChatTrace, clearChatTrace } from './services/chatTrace';
import { ChatHistoryOwnership } from './services/chatHistoryOwnership';
import { MessageAlerts } from './services/messageAlerts';


import React, { useState, useEffect, useRef, useCallback, Suspense, lazy } from 'react';
import { Navbar } from './components/Navbar';
import { GayzeLoadingScreen } from './components/GayzeLoadingScreen';
import { SafetyTimerModal } from './components/SafetyTimerModal';
import { DiscreetMaskView } from './components/DiscreetMaskView';
import { IdentityModal } from './components/IdentityModal';
import { ScheduleMeetingModal } from './components/ScheduleMeetingModal';
import { FullScreenCallModal, FullScreenAudioCallModal } from './components/FullScreenCallModal';
import { IncomingCallModal } from './components/IncomingCallModal';
import { initEnhancedPresence, formatLastSeen, type UserPresence } from './services/presenceService';
import { loadCallHistory, getUnreadCallCount, markCallRecordsAsRead, markCallAsMissed } from './services/callHistoryService';
import { sendMissedCallNotification, sendIncomingCallNotification, markCallNotificationsAsRead } from './services/callNotificationService';
import type { EditSectionKey } from './config/profileOptions';
import type { ProfileSavePayload } from './components/ProfileEditSheet';
import { SetIntentSheet, UserActiveIntent } from './components/SetIntentSheet';
import { AuthView, type AuthMode } from './components/AuthView';
import { ProfileOnboarding } from './components/ProfileOnboarding';
import { InstallPrompt } from './components/InstallPrompt';
import { NotificationsModal } from './components/NotificationsModal';
import {
  finishPendingPushRevoke,
  registerServiceWorker,
  releasePushOnSignOut,
  resyncSubscription,
  watchPushSubscriptionRecovery,
  revokeLocalPushSubscription,
  updateAppBadge,
} from './services/pushService';
import {
  isAuthPath,
  isGayzeServiceWorkerMessage,
  replacePath,
  routeFromPath,
  rememberNotificationPath,
  consumeNotificationPath,
} from './services/notificationRouting';
import { supabase, isSupabaseConfigured, GAYZE_AUTH_STORAGE_KEY, AUTH_REDIRECT_PATHS } from './services/supabaseClient';
import { getCurrentLocation, watchCurrentLocation, type GeoLocation } from './services/locationService';
import { primeCallAudio } from './services/callAudioService';
import { webrtcCallService, type IncomingCall } from './services/webrtcService';
import { analytics } from './services/analyticsService';
import { FALLBACK_MAP_CENTER, MAX_TRAVEL_DISTANCE_KM, NEUTRAL_AREA_LABEL, clampTravelDistanceKm, resolveAreaLabel } from './config/mapDefaults';

const RightNowView = lazy(() => import('./components/RightNowView').then((module) => ({ default: module.RightNowView })));
const LaterView = lazy(() => import('./components/LaterView').then((module) => ({ default: module.LaterView })));
const SafeHavenView = lazy(() => import('./components/SafeHavenView').then((module) => ({ default: module.SafeHavenView })));
const ProfileEditSheet = lazy(() => import('./components/ProfileEditSheet').then((module) => ({ default: module.ProfileEditSheet })));
const ChatRoomView = lazy(() => import('./components/ChatRoomView').then((module) => ({ default: module.ChatRoomView })));
const DiscoverView = lazy(() => import('./components/DiscoverView').then((module) => ({ default: module.DiscoverView })));
const ProfileView = lazy(() => import('./components/ProfileView').then((module) => ({ default: module.ProfileView })));
const SwarmQRModal = lazy(() => import('./components/SwarmQRModal').then((module) => ({ default: module.SwarmQRModal })));
const PublicProfileSheet = lazy(() => import('./components/PublicProfileSheet').then((module) => ({ default: module.PublicProfileSheet })));
import {
  Pulse,
  Gathering,
  SafeHaven,
  SwarmRoom,
  EncryptedMessage,
  UserProfile,
  SafetyCheckin,
  DatingProfile,
  SwarmQRPayload,
  MeetingProposal
} from './types';
import {
  INITIAL_USER,
  INITIAL_PULSES,
  INITIAL_GATHERINGS,
  INITIAL_SAFE_HAVENS,
  INITIAL_ROOMS,
  INITIAL_MESSAGES,
  INITIAL_SAFETY_CHECKIN,
  INITIAL_DATING_PROFILES
} from './services/storageService';
import { encryptPayload, encryptWithConversationKey, decryptWithConversationKey, deriveConversationKey, generateSafetyFingerprint, generateRandomKey, getOrCreateDeviceIdentity, signDeviceChallenge, createRecoveryBundle, recoveryBundleToText, parseRecoveryBundle, restoreRecoveryBundle } from './services/cryptoService';
import {
  discoverRightNow,
  discoveryRowsToPulses,
  resolvePulsesWithAvatars,
  ensureSupabaseSession,
  ensureSupabaseProfile,
  loadSupabaseProfile,
  loadSafeHavens,
  loadGatherings,
  createGathering,
  toggleGatheringRsvp,
  loadActiveSafetyCheckin,
  startSafetyCheckin,
  updateSafetyCheckin,
  updateProfileLocation,
  clearProfileLocation,
  saveActiveIntentWithSession,
  loadActiveIntent,
  updateActiveIntentPause,
  endActiveIntent,
  subscribeToRightNow,
  submitInterest,
  submitGaze,
  saveIntimacyProfile,
  updateProfileDetails,
  loadIntimacyProfile,
  loadProfileDetails,
  loadIncomingInterests,
  updateSupabaseProfile,
  persistConversationMessage,
  subscribeToConversationMessages,
  subscribeToAllConversationMessages,
  verifyPeerIdentity,
  registerIdentityDevice,
  listIdentityDevices,
  revokeIdentityDevice,
  verifyCurrentDevice,
  initPresence,
  createStoryFromIntent,
  loadMyConversations,
  leaveConversation,
  loadConversationPeerKey,
  jitterLocation,
  privacyRadiusMeters,
} from './services/supabaseService';
import { buildRoomsFromSupabase, mergeBackendRooms } from './services/conversationRooms';
import { deleteMessageForMe, unsendMessage, setMessageExpiry } from './services/messageLifecycleService';
import { resolveConversationKey } from './services/conversationKeyService';
import {
  hapticQRHandshake,
  hapticTimerWarning,
  hapticTimerExpired,
  hapticMessageDecrypted,
  hapticSensitiveAction,
  hapticLight,
  triggerVibration
} from './services/hapticService';
import { Shield, Lock, Radio, Calendar, HeartHandshake, Eye, AlertCircle } from 'lucide-react';

/**
 * Live mode (Supabase configured) never seeds a profile, a check-in or an
 * intent from demo fixtures or localStorage. Everything the authenticated
 * shell renders comes from the backend or is empty.
 */
const LIVE_EMPTY_USER: UserProfile = {
  publicKey: '',
  shortKey: '',
  handle: 'gayze-user',
  displayName: 'Gayze User',
  bio: '',
  avatarSeed: 'gayze',
  neighborhood: NEUTRAL_AREA_LABEL,
  privacySetting: 'fuzzy_500m',
  safetyVerified: false,
  interests: [],
  reliabilityScore: 0,
  verifiedPeersCount: 0,
};

const LIVE_EMPTY_CHECKIN: SafetyCheckin = {
  isActive: false,
  meetupPartnerName: '',
  venueName: '',
  startedAt: 0,
  durationMinutes: 60,
  notes: '',
};

const IS_LIVE_BACKEND = isSupabaseConfigured;

export default function App() {
  const [activeTab, setActiveTab] = useState<'dating' | 'right_now' | 'later' | 'swarms' | 'safe_havens' | 'profile'>('right_now');
  const [showStartup, setShowStartup] = useState(true);

  useEffect(() => {
    const timer = window.setTimeout(() => setShowStartup(false), 300);
    return () => window.clearTimeout(timer);
  }, []);

  const [authReady, setAuthReady] = useState(!isSupabaseConfigured);
  const [isAuthenticated, setIsAuthenticated] = useState(!isSupabaseConfigured);
  const [forcedAuthMode, setForcedAuthMode] = useState<AuthMode | null>(null);
  const [pendingAuthEmail, setPendingAuthEmail] = useState<string | null>(null);
  const [isSigningOut, setIsSigningOut] = useState(false);
  const isSigningOutRef = useRef(false);
  const authGenerationRef = useRef(0);
  const recoverySessionRef = useRef(false);
  const [userLocation, setUserLocation] = useState<GeoLocation | null>(null);
  const [locationError, setLocationError] = useState<string | null>(null);
  // Travel distance the user picked in the Right Now filter sheet. Always
  // clamped to the 5 km ceiling and mirrored into a ref so the discovery
  // refresher can read it without re-subscribing.
  const [travelDistanceKm, setTravelDistanceKm] = useState<number>(MAX_TRAVEL_DISTANCE_KM);
  const travelDistanceKmRef = useRef<number>(MAX_TRAVEL_DISTANCE_KM);
  useEffect(() => { travelDistanceKmRef.current = travelDistanceKm; }, [travelDistanceKm]);
  const requestUserLocation = async () => {
    try {
      setLocationError(null);
      const location = await getCurrentLocation();
      setUserLocation(location);
      locationPermissionStatusRef.current = 'granted';
      if (isSupabaseConfigured && currentUser.privacySetting !== 'ghost') {
        lastSyncedLocationRef.current = { lat: location.lat, lng: location.lng };
        await updateProfileLocation(
          jitterLocation({ lat: location.lat, lng: location.lng }, privacyRadiusMeters(currentUser.privacySetting)),
        );
        // Distances are measured by the discovery function from the stored
        // (privacy-jittered) point; refresh immediately after permission.
        await refreshDiscoveryRef.current();
      }
    } catch (error) {
      const message = error instanceof GeolocationPositionError
        ? error.code === error.PERMISSION_DENIED
          ? 'Location access is blocked. Enable Location Services for GAYZE in iPhone Settings.'
          : 'GAYZE could not get your location. Try again.'
        : error instanceof Error ? error.message : 'GAYZE could not get your location.';
      setLocationError(message);
    }
  };


  const locationPermissionStatusRef = useRef<'granted' | 'denied' | null>(null);
  const lastTrackedTabRef = useRef<string | null>(null);


  useEffect(() => {
    if (lastTrackedTabRef.current === activeTab) return;
    lastTrackedTabRef.current = activeTab;
    if (activeTab === 'right_now') {
      analytics.logEvent('right_now_open');
      analytics.logEvent('discovery_viewed', { surface: 'right_now' });
    }
  }, [activeTab]);

  useEffect(() => {
    if (!isSupabaseConfigured || !supabase) return;
    const supabaseClient = supabase;

    let disposed = false;

    // Detect recovery callback in URL hash or query params on load
    if (typeof window !== 'undefined') {
      const hash = window.location.hash || '';
      const search = window.location.search || '';
      const pathname = window.location.pathname;
      const isRecovery = pathname === AUTH_REDIRECT_PATHS.resetPassword
        || hash.includes('type=recovery')
        || search.includes('type=recovery');
      if (isRecovery) {
        recoverySessionRef.current = true;
        setForcedAuthMode('reset');
        setIsAuthenticated(false);
      }
    }

    const generation = authGenerationRef.current;
    void supabase.auth.getSession().then(({ data }) => {
      if (disposed || generation !== authGenerationRef.current) return;
      if (recoverySessionRef.current) {
        setIsAuthenticated(false);
        setAuthReady(true);
        return;
      }
      setSessionUserId(data.session?.user?.id ?? null);
      setIsAuthenticated(Boolean(data.session?.user));
      setAuthReady(true);
    });

    const { data: subscription } = supabase.auth.onAuthStateChange((event, session) => {
      if (disposed) return;

      // A local-first sign-out invalidates the current auth generation before
      // calling Supabase. Ignore any late auth event from the old session so
      // it cannot immediately re-authenticate the UI.
      if (isSigningOutRef.current) return;

      if (event === 'PASSWORD_RECOVERY') {
        recoverySessionRef.current = true;
        setForcedAuthMode('reset');
        setIsAuthenticated(false);
        setAuthReady(true);
        return;
      }

      if (event === 'SIGNED_OUT') {
        // The session ended without the in-app sign-out handler (remote/global
        // sign-out, invalid refresh token). The JWT is gone so the server row
        // cannot be deleted under RLS, but this browser's endpoint can still be
        // revoked so the previous account stops receiving pushes on this device.
        void revokeLocalPushSubscription();
        clearChatAccount();
        setSessionUserId(null);
        authGenerationRef.current += 1;
        recoverySessionRef.current = false;
        setIsAuthenticated(false);
        setAuthReady(true);
        return;
      }

      if (session?.user && supabaseUserIdRef.current && session.user.id !== supabaseUserIdRef.current) {
        authGenerationRef.current += 1;
        clearChatAccount();
      }
      setSessionUserId(session?.user?.id ?? null);
      const hasUser = Boolean(session?.user);
      if (hasUser && !recoverySessionRef.current) {
        setIsAuthenticated(true);
      } else if (!hasUser) {
        setIsAuthenticated(false);
      }
      setAuthReady(true);
    });

    return () => {
      disposed = true;
      subscription.subscription.unsubscribe();
    };
  }, []);

  const lastSyncedLocationRef = useRef<{ lat: number; lng: number } | null>(null);
  const locationWatchStopRef = useRef<(() => void) | null>(null);

  // Core datasets with local state
  const [currentUser, setCurrentUser] = useState<UserProfile>(() => {
    if (IS_LIVE_BACKEND) return LIVE_EMPTY_USER;
    const saved = localStorage.getItem('gayze_user');
    if (!saved) return INITIAL_USER;
    try {
      const parsed = JSON.parse(saved);
      return {
        ...INITIAL_USER,
        ...parsed,
        reliabilityScore: parsed.reliabilityScore || 0,
        verifiedPeersCount: parsed.verifiedPeersCount || 0,
      };
    } catch {
      return INITIAL_USER;
    }
  });

  useEffect(() => {
    if (!isAuthenticated) {
      locationWatchStopRef.current?.();
      locationWatchStopRef.current = null;
      setUserLocation(null);
      lastSyncedLocationRef.current = null;
      return;
    }

    if (currentUser.privacySetting === 'ghost' && isSupabaseConfigured) {
      void clearProfileLocation();
    }

    const stop = watchCurrentLocation(
      (location) => {
        setUserLocation(location);
        setLocationError(null);
        if (locationPermissionStatusRef.current !== 'granted') {
          locationPermissionStatusRef.current = 'granted';
          analytics.logEvent('location_permission_granted');
        }

        if (isSupabaseConfigured && supabase && currentUser.privacySetting !== 'ghost') {
          const previous = lastSyncedLocationRef.current;
          const latDelta = previous ? Math.abs(previous.lat - location.lat) : Infinity;
          const lngDelta = previous ? Math.abs(previous.lng - location.lng) : Infinity;
          if (!previous || latDelta > 0.0008 || lngDelta > 0.0008) {
            lastSyncedLocationRef.current = { lat: location.lat, lng: location.lng };
            // Exact GPS never leaves the device: the stored point is jittered
            // inside the user's configured privacy radius first.
            void updateProfileLocation(
              jitterLocation({ lat: location.lat, lng: location.lng }, privacyRadiusMeters(currentUser.privacySetting)),
            );
          }
        }
      },
      (error) => {
        setLocationError(error?.message || 'Location permission is unavailable.');
        if (error instanceof GeolocationPositionError && error.code === error.PERMISSION_DENIED
          && locationPermissionStatusRef.current !== 'denied') {
          locationPermissionStatusRef.current = 'denied';
          analytics.logEvent('location_permission_denied');
        }
      },
    );
    locationWatchStopRef.current = stop;

    return () => {
      stop();
      if (locationWatchStopRef.current === stop) locationWatchStopRef.current = null;
    };
  }, [isAuthenticated, currentUser.privacySetting]);

  const [datingProfiles, setDatingProfiles] = useState<DatingProfile[]>(() => {
    if (isSupabaseConfigured) return [];
    const saved = localStorage.getItem('gayze_dating_profiles');
    if (!saved) return INITIAL_DATING_PROFILES;
    try {
      const parsed: DatingProfile[] = JSON.parse(saved);
      return parsed.map((p, idx) => {
        const init = INITIAL_DATING_PROFILES.find((dp) => dp.id === p.id) || INITIAL_DATING_PROFILES[idx % INITIAL_DATING_PROFILES.length];
        return {
          ...init,
          ...p,
          reliabilityScore: p.reliabilityScore || init.reliabilityScore || 95,
          verifiedPeersCount: p.verifiedPeersCount || init.verifiedPeersCount || 10,
          verifiedViaQR: p.verifiedViaQR ?? init.verifiedViaQR ?? false,
        };
      });
    } catch {
      return INITIAL_DATING_PROFILES;
    }
  });

  // Demo/offline fixture list. Live discovery never writes here — Right Now
  // renders `supabaseRightNowPulses` whenever Supabase is configured.
  const [pulses] = useState<Pulse[]>(() => {
    if (isSupabaseConfigured) return [];
    const saved = localStorage.getItem('gayze_pulses');
    if (!saved) return INITIAL_PULSES;
    try {
      const parsed: Pulse[] = JSON.parse(saved);
      return parsed.map((p, idx) => {
        const initial = INITIAL_PULSES.find((ip) => ip.id === p.id) || INITIAL_PULSES[idx % INITIAL_PULSES.length];
        return {
          ...p,
          lat: typeof p.lat === 'number' && !isNaN(p.lat) ? p.lat : (initial?.lat ?? FALLBACK_MAP_CENTER.lat),
          lng: typeof p.lng === 'number' && !isNaN(p.lng) ? p.lng : (initial?.lng ?? FALLBACK_MAP_CENTER.lng),
          jitterMeters: p.jitterMeters || 300,
        };
      });
    } catch {
      return INITIAL_PULSES;
    }
  });

  const [gatherings, setGatherings] = useState<Gathering[]>(() => {
    if (isSupabaseConfigured) return [];
    const saved = localStorage.getItem('gayze_gatherings');
    if (!saved) return INITIAL_GATHERINGS;
    try {
      const parsed: Gathering[] = JSON.parse(saved);
      return parsed.map((g, idx) => {
        const initial = INITIAL_GATHERINGS.find((ig) => ig.id === g.id) || INITIAL_GATHERINGS[idx % INITIAL_GATHERINGS.length];
        return {
          ...g,
          lat: typeof g.lat === 'number' && !isNaN(g.lat) ? g.lat : (initial?.lat ?? FALLBACK_MAP_CENTER.lat),
          lng: typeof g.lng === 'number' && !isNaN(g.lng) ? g.lng : (initial?.lng ?? FALLBACK_MAP_CENTER.lng),
        };
      });
    } catch {
      return INITIAL_GATHERINGS;
    }
  });

  const [safeHavens, setSafeHavens] = useState<SafeHaven[]>(() => {
    if (isSupabaseConfigured) return [];
    const saved = localStorage.getItem('gayze_safe_havens');
    if (!saved) return INITIAL_SAFE_HAVENS;
    try {
      const parsed: SafeHaven[] = JSON.parse(saved);
      return parsed.map((s, idx) => {
        const initial = INITIAL_SAFE_HAVENS.find((is) => is.id === s.id) || INITIAL_SAFE_HAVENS[idx % INITIAL_SAFE_HAVENS.length];
        return {
          ...s,
          lat: typeof s.lat === 'number' && !isNaN(s.lat) ? s.lat : (initial?.lat ?? FALLBACK_MAP_CENTER.lat),
          lng: typeof s.lng === 'number' && !isNaN(s.lng) ? s.lng : (initial?.lng ?? FALLBACK_MAP_CENTER.lng),
        };
      });
    } catch {
      return INITIAL_SAFE_HAVENS;
    }
  });

  const [rooms, setRooms] = useState<SwarmRoom[]>(() => {
    if (isSupabaseConfigured) return [];
    const saved = localStorage.getItem('gayze_rooms');
    return saved ? JSON.parse(saved) : INITIAL_ROOMS;
  });

  const [messages, setMessages] = useState<Record<string, EncryptedMessage[]>>(() => {
    if (isSupabaseConfigured) return {};
    const saved = localStorage.getItem('gayze_messages');
    return saved ? JSON.parse(saved) : INITIAL_MESSAGES;
  });

  useEffect(() => {
    if (!isSupabaseConfigured || !isAuthenticated) return;
    let disposed = false;
    void Promise.all([loadSafeHavens(), loadGatherings(), loadActiveSafetyCheckin()]).then(([havens, liveGatherings, activeCheckin]) => {
      if (disposed) return;
      setSafeHavens(havens);
      setGatherings(liveGatherings);
      if (activeCheckin) {
        const remaining = Math.max(0, Math.ceil((activeCheckin.expiresAt - Date.now()) / 1000));
        setCheckinState({
          isActive: remaining > 0,
          meetupPartnerName: activeCheckin.partnerName,
          venueName: activeCheckin.venueName,
          startedAt: activeCheckin.startedAt,
          durationMinutes: Math.max(1, Math.ceil((activeCheckin.expiresAt - activeCheckin.startedAt) / 60000)),
          notes: activeCheckin.notes,
        });
        setRemainingSeconds(remaining);
      } else {
        setCheckinState((prev) => ({ ...prev, isActive: false }));
      }
    });
    return () => { disposed = true; };
  }, [isAuthenticated]);

  const [activeRoomId, setActiveRoomId] = useState<string>(() => (IS_LIVE_BACKEND ? '' : 'room_marcus'));
  const directChatRequestRef = useRef(0);
  const [chatOpenRequest, setChatOpenRequest] = useState<{ roomId: string; sequence: number } | null>(null);
  const [visibleChatRoomId, setVisibleChatRoomId] = useState<string | null>(null);
  const visibleChatRoomRef = useRef<string | null>(null);
  const reportVisibleChatRoom = useCallback((id: string | null) => {
    visibleChatRoomRef.current = id;
    setVisibleChatRoomId(id);
  }, []);
  function requestConversationOpen(roomId: string) {
    directChatRequestRef.current++;
    beginChatTrace(roomId);
    setChatOpenRequest(previous => ({ roomId, sequence: (previous?.sequence ?? 0) + 1 }));
    setActiveRoomId(roomId);
    setActiveTab('swarms');
  }


  // Local safety check-in timer state
  const [checkinState, setCheckinState] = useState<SafetyCheckin>(() => {
    if (IS_LIVE_BACKEND) return LIVE_EMPTY_CHECKIN;
    const saved = localStorage.getItem('gayze_checkin');
    return saved ? JSON.parse(saved) : INITIAL_SAFETY_CHECKIN;
  });
  const [remainingSeconds, setRemainingSeconds] = useState<number>(() => {
    if (!checkinState.isActive) return 3600;
    const expiresAt = checkinState.startedAt + checkinState.durationMinutes * 60 * 1000;
    return Math.max(0, Math.ceil((expiresAt - Date.now()) / 1000));
  });
  const lastRemainingSecondsRef = useRef(remainingSeconds);
  const expiredCheckinStartedAtRef = useRef<number | null>(null);

  // Modals & Mask
  const [isMaskActive, setIsMaskActive] = useState(false);
  const [isIdentityOpen, setIsIdentityOpen] = useState(false);
  const [isNotificationsOpen, setIsNotificationsOpen] = useState(false);
  const [isSafetyTimerOpen, setIsSafetyTimerOpen] = useState(false);
  const [isQRModalOpen, setIsQRModalOpen] = useState(false);
  const [qrTargetPeer, setQrTargetPeer] = useState<DatingProfile | null>(null);
  const [notificationToast, setNotificationToast] = useState<string | null>(null);
  const [isProfileEditOpen, setIsProfileEditOpen] = useState(false);
  const [profileEditSection, setProfileEditSection] = useState<EditSectionKey | null>(null);
  const [viewingPublicProfile, setViewingPublicProfile] = useState<{
    userId: string | null;
    fallbackName?: string;
    fallbackAge?: number;
    fallbackArea?: string;
    fallbackIntent?: string;
    fallbackPhotoUrl?: string;
    fallbackOnline?: boolean;
  } | null>(null);
  const knownIncomingInterestIdsRef = useRef<Set<string>>(new Set());
  const [notificationInbox, setNotificationInbox] = useState<NotificationInbox | null>(null);
  const [notificationInboxStatus, setNotificationInboxStatus] = useState<ChatConnectionState>('connecting');
  const notificationRefreshRef = useRef<() => void>(() => {});
  const unreadMessageCount = notificationInbox?.messageUnread ?? 0;
  const toastTimeoutRef = useRef<number | null>(null);

  // Schedule Meeting Modal state
  const [isScheduleMeetingOpen, setIsScheduleMeetingOpen] = useState(false);
  const [scheduleMeetingPeerName, setScheduleMeetingPeerName] = useState<string>('Marcus');

  // Encrypted Calling state
  const [isCallModalOpen, setIsCallModalOpen] = useState(false);
  const [callPeerName, setCallPeerName] = useState<string>('Marcus');
  const [callPeerAvatar, setCallPeerAvatar] = useState<string | undefined>(undefined);
  const [callType, setCallType] = useState<'audio' | 'video'>('audio');
  const [callTargetUserId, setCallTargetUserId] = useState<string | undefined>(undefined);
  const [incomingCall, setIncomingCall] = useState<IncomingCall | null>(null);
  const [isIncomingCallActive, setIsIncomingCallActive] = useState(false);
  const [inboxConnection, setInboxConnection] = useState<ChatConnectionState>('connecting');
  const [chatConnection, setChatConnection] = useState<{ roomId: string; state: ChatConnectionState }>({ roomId: '', state: 'connecting' });
  const [presenceProfileUserId, setPresenceProfileUserId] = useState<string | null>(null);
  const [onlineUserIds, setOnlineUserIds] = useState<Set<string>>(new Set());
  const [presenceMap, setPresenceMap] = useState<Map<string, UserPresence>>(new Map());
  const [callHistory, setCallHistory] = useState<any[]>([]);
  const [unreadCallCount, setUnreadCallCount] = useState<number>(0);

  // Set Intent Sheet state — canonical Right Now intent state.
  // Hydrate once from local storage so Discover / Right Now stay consistent
  // across tab changes and reloads.
  const [isSetIntentOpen, setIsSetIntentOpen] = useState(false);
  const [intentBusy, setIntentBusy] = useState(false);
  const [conversationKeyState, setConversationKeyState] = useState<{
    roomId: string;
    status: 'loading' | 'ready' | 'unavailable';
    reason?: string;
  }>({ roomId: '', status: 'loading' });
  // Canonical intent state. In live mode this is hydrated from Supabase
  // (`intents`) and only ever written back through the Supabase service layer.
  // In local/demo mode it is a device-local setting.
  const [activeUserIntent, setActiveUserIntent] = useState<UserActiveIntent | null>(() => {
    if (IS_LIVE_BACKEND) return null;
    try {
      const saved = localStorage.getItem('gayze_active_user_intent');
      if (!saved) return null;
      const parsed = JSON.parse(saved) as UserActiveIntent;
      return parsed.expiresAt > Date.now() ? parsed : null;
    } catch {
      return null;
    }
  });

  const [supabaseRightNowPulses, setSupabaseRightNowPulses] = useState<Pulse[]>([]);
  const [supabaseReady, setSupabaseReady] = useState(false);
  const [supabaseUserId, setSupabaseUserId] = useState<string | null>(null);
  const [sessionUserId, setSessionUserId] = useState<string | null>(null);
  const [showProfileOnboarding, setShowProfileOnboarding] = useState(false);
  const [identityDevices, setIdentityDevices] = useState<import('./services/supabaseService').IdentityDevice[]>([]);
  const [currentDeviceFingerprint, setCurrentDeviceFingerprint] = useState<string | null>(null);

  // ---------------------------------------------------------------------------
  // Live backend wiring
  //   1. session + profile + device identity bootstrap
  //   2. active intent hydration, pause/resume/end and expiry
  //   3. Right Now discovery (initial load, Realtime, slow poll)
  //   4. conversation list hydration
  // Each effect is keyed on the authenticated user id so switching accounts
  // cannot leak the previous account's state into the UI.
  // ---------------------------------------------------------------------------

  const supabaseUserIdRef = useRef<string | null>(null);
  const messageProcessorRef = useRef(new ChatMessageProcessor(resolveConversationKey, decryptWithConversationKey));
  const messageAlertsRef = useRef(new MessageAlerts());
  const loadedMessageIdsRef = useRef(new Set<string>());
  const historyOwnershipRef = useRef(new ChatHistoryOwnership());
  const messageBatcherRef = useRef<MessageBatcher | null>(null);
  if (!messageBatcherRef.current) messageBatcherRef.current = new MessageBatcher((batch) => {
    const userId = supabaseUserIdRef.current;
    const generation = authGenerationRef.current;
    if (!userId) return;
    const grouped = new Map<string, EncryptedMessage[]>();
    for (const message of batch) {
      const rows = grouped.get(message.roomId) ?? [];
      rows.push(message); grouped.set(message.roomId, rows);
    }
    setMessages((prev) => {
      if (supabaseUserIdRef.current !== userId || authGenerationRef.current !== generation) return prev;
      let next = prev;
      for (const [roomId, rows] of grouped) {
        const merged = mergeMessages(prev[roomId] ?? [], rows);
        if (merged !== prev[roomId]) { if (next === prev) next = { ...prev }; next[roomId] = merged; }
      }
      return next;
    });
    setRooms((prev) => {
      if (supabaseUserIdRef.current !== userId || authGenerationRef.current !== generation) return prev;
      let changed = false;
      const next = prev.map((room) => {
        const latest = (grouped.has(room.id) ? mergeMessages([], grouped.get(room.id)!).at(-1) : undefined);
        if (!latest || latest.timestamp < room.lastTimestamp) return room;
        const text = latest.isBurned ? '' : latest.plainText === '[Encrypted message]' && room.lastTimestamp === latest.timestamp ? room.lastMessage : latest.plainText;
        if (room.lastTimestamp === latest.timestamp && room.lastMessage === text) return room;
        changed = true;
        return { ...room, lastTimestamp: latest.timestamp, lastMessage: text };
      });
      return changed ? next.sort((a, b) => b.lastTimestamp - a.lastTimestamp) : prev;
    });
  });
  const queueMessage = (message: EncryptedMessage) => {
    loadedMessageIdsRef.current.add(message.id);
    messageBatcherRef.current!.add(message);
  };
  const clearMessageWork = () => {
    clearChatTrace();
    messageProcessorRef.current.clear();
    messageBatcherRef.current?.clear();
    loadedMessageIdsRef.current.clear();
    historyOwnershipRef.current.clear();
  };
  useEffect(() => () => { clearMessageWork(); messageAlertsRef.current.clear(); }, []);
  const presentIncomingMessage = (messageId: string, roomId: string, recipientId: string) => messageAlertsRef.current.present(messageId, roomId, {
    foreground: document.visibilityState === 'visible' && document.hasFocus(),
    viewingRoom: activeTabRef.current === 'swarms' ? visibleChatRoomRef.current : null,
    userId: supabaseUserIdRef.current, recipientId,
  }, () => { showToast('New GAYZE message'); hapticMessageDecrypted(); });
  // Delete-chat bookkeeping. A list load that STARTED before a delete was
  // confirmed may still contain the deleted room and must not resurrect it;
  // any load started afterwards reflects server truth (so a genuinely
  // recreated conversation becomes visible again). Entries are not permanent.
  const conversationLoadEpochs = useRef(new WeakMap<object, number>()).current;
  const deletedRooms = useRef(new DeletedRoomTracker()).current;
  const conversationLoadRef = useRef<{ userId: string; work: ReturnType<typeof loadMyConversations> } | null>(null);
  const loadConversationListOnce = (userId: string) => {
    const pending = conversationLoadRef.current;
    if (pending?.userId === userId) return pending.work;
    const startEpoch = deletedRooms.currentEpoch;
    const entry = {
      userId,
      work: loadMyConversations().then((result) => {
        if (result) conversationLoadEpochs.set(result, startEpoch);
        return result;
      }),
    };
    conversationLoadRef.current = entry;
    void entry.work.finally(() => { if (conversationLoadRef.current === entry) conversationLoadRef.current = null; }).catch(() => {});
    return entry.work;
  };

  function clearChatAccount() {
    deletedRooms.clear();
    clearMessageWork();
    messageAlertsRef.current.clear();
    conversationLoadRef.current = null;
    supabaseUserIdRef.current = null;
    setSupabaseUserId(null);
    setMessages({});
    setRooms([]);
    setActiveRoomId('');
    setChatOpenRequest(null);
    reportVisibleChatRoom(null);
    setNotificationInbox(null);
    initialRouteAppliedRef.current = false;
    setOnlineUserIds(new Set());
    setPresenceProfileUserId(null);
    setIncomingCall(null);
    setCurrentUser(LIVE_EMPTY_USER);
  }

  const currentUserRef = useRef(currentUser);
  useEffect(() => { currentUserRef.current = currentUser; }, [currentUser]);

  const roomsRef = useRef<SwarmRoom[]>(rooms);
  useEffect(() => { roomsRef.current = rooms; }, [rooms]);
  const activeTabRef = useRef(activeTab);
  useEffect(() => { activeTabRef.current = activeTab; }, [activeTab]);
  const activeRoomIdRef = useRef(activeRoomId);
  useEffect(() => { activeRoomIdRef.current = activeRoomId; }, [activeRoomId]);

  const activeUserIntentRef = useRef<UserActiveIntent | null>(activeUserIntent);
  useEffect(() => { activeUserIntentRef.current = activeUserIntent; }, [activeUserIntent]);

  const withoutDeletedRooms = (loaded: SwarmRoom[], result: object) =>
    deletedRooms.filter(loaded, conversationLoadEpochs.get(result) ?? -1);

  const refreshDiscoveryRef = useRef<() => Promise<void>>(async () => undefined);
  const refreshConversationListRef = useRef<() => Promise<void>>(async () => undefined);

  const refreshDiscovery = async () => {
    if (!IS_LIVE_BACKEND) return;
    const viewerId = supabaseUserIdRef.current;
    if (!viewerId || isSigningOutRef.current) return;
    const generation = authGenerationRef.current;
    try {
      // The user's selected travel distance reaches discovery, clamped to the
      // 5 km ceiling so a wider radius can never be requested.
      const radiusMeters = Math.round(clampTravelDistanceKm(travelDistanceKmRef.current) * 1000);
      const rows = await discoverRightNow({ radiusMeters });
      if (generation !== authGenerationRef.current || isSigningOutRef.current) return;
      // The authenticated user is never part of their own nearby list.
      const pulsesWithAvatars = await resolvePulsesWithAvatars(discoveryRowsToPulses(rows, viewerId));
      if (generation !== authGenerationRef.current || isSigningOutRef.current) return;
      setSupabaseRightNowPulses(pulsesWithAvatars);
      setSupabaseReady(true);
    } catch (error) {
      console.warn('[GAYZE] Discovery refresh failed:', error);
      if (generation === authGenerationRef.current && !isSigningOutRef.current) setSupabaseReady(false);
    }
  };

  // Keep the latest discovery refresher reachable from the effects and
  // callbacks below without re-subscribing on every render.
  useEffect(() => { refreshDiscoveryRef.current = refreshDiscovery; });

  // Changing the travel distance re-runs live discovery at the new radius.
  useEffect(() => {
    if (!IS_LIVE_BACKEND || !isAuthenticated) return;
    void refreshDiscoveryRef.current();
  }, [travelDistanceKm, isAuthenticated]);

  // 1. Session, profile and device identity.
  useEffect(() => {
    setPresenceProfileUserId(null);
    if (!IS_LIVE_BACKEND || !isAuthenticated || isSigningOut) return;
    let disposed = false;
    const generation = authGenerationRef.current;
    const isStale = () => disposed || generation !== authGenerationRef.current || isSigningOutRef.current;

    void (async () => {
      try {
        const user = await ensureSupabaseSession();
        if (!user || isStale()) return;
        setShowProfileOnboarding(user.user_metadata?.profile_complete !== true);
        if (supabaseUserIdRef.current !== user.id) { clearMessageWork(); messageAlertsRef.current.clear(); }
        supabaseUserIdRef.current = user.id;
        setSupabaseUserId(user.id);

        const identity = await getOrCreateDeviceIdentity();
        if (isStale()) return;
        const shortKey = `pk_${identity.fingerprint.slice(3, 11)}...${identity.fingerprint.slice(-4)}`;

        // Display name comes from the auth record first — never from demo fixtures.
        const metadataName = typeof user.user_metadata?.display_name === 'string'
          ? user.user_metadata.display_name.trim()
          : '';
        const emailName = (user.email || '').split('@')[0];
        const resolvedName = metadataName || (emailName ? emailName.replace(/[._-]+/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase()) : 'Gayze User');

        const baseUser = currentUserRef.current;
        const identityUser: UserProfile = {
          ...baseUser,
          displayName: resolvedName,
          handle: baseUser.handle || 'gayze-user',
          bio: baseUser.bio || '',
          publicKey: identity.fingerprint,
          shortKey,
        };

        // Publish a complete local user immediately. A brand-new account may
        // not have a profiles row yet; waiting for the profile round-trip left
        // the authenticated shell with the empty live fixture and could make
        // downstream identity-dependent UI render with incomplete state.
        setCurrentUser(identityUser);

        // Load the persisted profile first, then merge the additive profile
        // details and intimacy fields. Each optional layer fails soft so a
        // missing migration/schema never prevents the authenticated shell.
        try {
          const profileRow = await ensureSupabaseProfile(user.id, identityUser, identity.publicKeyJwkString);
          if (isStale()) return;

          const savedProfile = await loadSupabaseProfile(user.id);
          if (isStale()) return;
          if (savedProfile) {
            setPresenceProfileUserId(user.id);
            setCurrentUser((prev) => ({
              ...prev,
              // Bootstrap already reads our own complete profile row. Honour
              // a deployed incognito flag without assuming a new DB column or
              // letting an unknown/failed profile read publish presence.
              presenceIncognito: !profileRow || profileRow.presence_incognito === true,
              ...Object.fromEntries(
                Object.entries(savedProfile).filter(([, value]) => value !== undefined),
              ),
              // The device identity key is what peers need for E2EE; only this
              // bootstrap may set it, and it is never overwritten from a fingerprint.
              publicKey: identity.fingerprint,
              shortKey: `pk_${identity.fingerprint.slice(3, 11)}...${identity.fingerprint.slice(-4)}`,
            }));
          }
        } catch (error) {
          console.warn('[GAYZE] Profile bootstrap failed:', error);
        }

        // "About you" details and intimacy are additive and may depend on
        // migrations being present. Keep them independent and fail soft.
        try {
          const savedDetails = await loadProfileDetails(user.id);
          if (isStale()) return;
          if (savedDetails) {
            setCurrentUser((prev) => ({
              ...prev,
              availability: savedDetails.availability,
              mySetup: savedDetails.mySetup,
              boundaries: savedDetails.boundaries,
              hobbies: savedDetails.hobbies,
              bodyType: savedDetails.bodyType ?? undefined,
              heightCm: savedDetails.heightCm ?? undefined,
              pronouns: savedDetails.pronouns ?? undefined,
            }));
          }
        } catch (error) {
          console.warn('[GAYZE] Profile details load skipped:', error);
        }

        try {
          const savedIntimacy = await loadIntimacyProfile(user.id);
          if (isStale()) return;
          if (savedIntimacy) {
            setCurrentUser((prev) => ({ ...prev, intimacy: savedIntimacy }));
          }
        } catch (error) {
          console.warn('[GAYZE] Intimacy profile load skipped:', error);
        }

        try {
          await registerIdentityDevice(identity.fingerprint, identity.publicKeyJwkString, navigator.userAgent.slice(0, 48), identity.signingPublicKeyJwkString, identity.deviceId);
          await verifyCurrentDevice(identity.deviceId, signDeviceChallenge);
          if (isStale()) return;
          setCurrentDeviceFingerprint(identity.deviceId);
          const registeredDevices = await listIdentityDevices();
          if (!isStale()) setIdentityDevices(registeredDevices);
        } catch (deviceError) {
          console.warn('[GAYZE] Device registry unavailable', deviceError);
        }

        await refreshDiscoveryRef.current();
      } catch (error) {
        console.warn('[GAYZE] Supabase bootstrap failed:', error);
      }
    })();

    return () => { disposed = true; };
  }, [isAuthenticated, isSigningOut, sessionUserId]);

  // 2. Active intent: hydrate from Supabase, expire locally when it lapses.
  useEffect(() => {
    if (!IS_LIVE_BACKEND || !isAuthenticated || isSigningOut || !supabaseUserId) return;
    let disposed = false;
    // A leftover demo intent must never surface in the live shell.
    try { localStorage.removeItem('gayze_active_user_intent'); } catch { /* ignore */ }

    void (async () => {
      const intent = await loadActiveIntent();
      if (disposed || isSigningOutRef.current) return;
      setActiveUserIntent(intent);
    })();

    return () => { disposed = true; };
  }, [isAuthenticated, isSigningOut, supabaseUserId]);

  // Expired intents disappear from the UI without waiting for a reload.
  useEffect(() => {
    if (!activeUserIntent) return;
    const remaining = activeUserIntent.expiresAt - Date.now();
    if (remaining <= 0) {
      setActiveUserIntent(null);
      return;
    }
    const timer = window.setTimeout(() => setActiveUserIntent(null), Math.min(remaining, 2147483000));
    return () => window.clearTimeout(timer);
  }, [activeUserIntent?.remoteId, activeUserIntent?.expiresAt, activeUserIntent?.isPaused]);

  // 3. Discovery: realtime subscription + slow poll so expiry is reflected even
  //    when Realtime is not enabled for the table.
  useEffect(() => {
    if (!IS_LIVE_BACKEND || !isAuthenticated || isSigningOut || !supabaseUserId) return;
    void refreshDiscoveryRef.current();
    const unsubscribe = subscribeToRightNow(() => { void refreshDiscoveryRef.current(); });
    const poll = window.setInterval(() => { void refreshDiscoveryRef.current(); }, 90000);
    return () => {
      unsubscribe();
      window.clearInterval(poll);
    };
  }, [isAuthenticated, isSigningOut, supabaseUserId]);

  // 4. Conversation list hydration (Supabase is the source of truth).
  const refreshConversationList = async () => {
    if (!IS_LIVE_BACKEND || !isAuthenticated || isSigningOut) return;
    const viewerId = supabaseUserIdRef.current;
    if (!viewerId) return;
    const result = await loadConversationListOnce(viewerId);
    if (!result || isSigningOutRef.current || supabaseUserIdRef.current !== viewerId) return;
    const loaded = withoutDeletedRooms(buildRoomsFromSupabase(result, viewerId), result);
    setRooms((prev) => mergeBackendRooms(prev, loaded, viewerId));
  };

  useEffect(() => {
    refreshConversationListRef.current = refreshConversationList;
  });

  useEffect(() => {
    if (!IS_LIVE_BACKEND || !isAuthenticated || isSigningOut || !supabaseUserId) return;
    let disposed = false;
    void refreshConversationListRef.current();
    const poll = window.setInterval(() => {
      if (!disposed) void refreshConversationListRef.current();
    }, 5000);
    return () => { disposed = true; window.clearInterval(poll); };
  }, [isAuthenticated, isSigningOut, supabaseUserId]);

  // Global message stream: the inbox receives messages even when the user is
  // on another destination. The conversation poll also catches newly-created rooms.
  useEffect(() => {
    if (!IS_LIVE_BACKEND || !isAuthenticated || isSigningOut || !supabaseUserId) return;
    let disposed = false;
    const latestHistory = new Map<string, { id: string; timestamp: number }>();
    const unsubscribe = subscribeToAllConversationMessages(
      async (row, delivery) => {
        if (disposed || !delivery.current() || supabaseUserIdRef.current !== supabaseUserId) return;
        if (delivery.notify && row.sender_id !== supabaseUserId) presentIncomingMessage(row.id, row.conversation_id, supabaseUserId);
        const previous = latestHistory.get(row.conversation_id);
        const timestamp = Date.parse(row.created_at);
        const isLatest = !previous || timestamp > previous.timestamp || (timestamp === previous.timestamp && row.id >= previous.id);
        if (isLatest) latestHistory.set(row.conversation_id, { id: row.id, timestamp });
        // Inbox needs recent previews, new arrivals and mutations to rows already
        // displayed. The active room owns full history; do not decrypt every old
        // conversation merely to populate a one-line inbox preview.
        if (!isLatest && !loadedMessageIdsRef.current.has(row.id)) {
          historyOwnershipRef.current.unseenOlderRow(row.conversation_id);
          // A newly committed old row in the visible room must still be decoded.
          // Other rooms lose warm eligibility and do a full read when reopened.
          if (!delivery.notify && activeRoomIdRef.current !== row.conversation_id) return true;
        }
        const processingGeneration = messageProcessorRef.current.generation;
        let room = roomsRef.current.find((candidate) => candidate.id === row.conversation_id);
        if (!room) {
          const result = await loadConversationListOnce(supabaseUserId);
          if (disposed || !delivery.current()) return;
          if (result) {
            const loaded = withoutDeletedRooms(buildRoomsFromSupabase(result, supabaseUserIdRef.current || ''), result);
            setRooms((prev) => mergeBackendRooms(prev, loaded, supabaseUserIdRef.current || ''));
            room = loaded.find((candidate) => candidate.id === row.conversation_id);
          }
        }
        if (disposed || !delivery.current()) return;
        if (!room) throw new Error('Conversation metadata unavailable');

        if (row.burned_at || (row.expires_at && Date.parse(row.expires_at) <= Date.now())) messageProcessorRef.current.forget(row, supabaseUserId);
        let plainText = '[Encrypted message]';
        let mediaUrl: string | undefined;
        let decryptedOk = false;
        for (let attempt = 0; attempt < (delivery.notify ? 3 : 1) && row.nonce && !row.burned_at && (!row.expires_at || Date.parse(row.expires_at) > Date.now()) && !decryptedOk; attempt += 1) {
          try {
            if (disposed || !delivery.current() || processingGeneration !== messageProcessorRef.current.generation) return false;
            const decrypted = await messageProcessorRef.current.text(room, row, supabaseUserId);
            if (decrypted.startsWith('{"') && decrypted.includes('"mediaUrl"')) {
              try {
                const parsed = JSON.parse(decrypted);
                plainText = parsed.text || '';
                mediaUrl = parsed.mediaUrl;
              } catch { plainText = decrypted; }
            } else { plainText = decrypted; }
            decryptedOk = true;
          } catch (error) {
            if (attempt < (delivery.notify ? 2 : 0)) await new Promise((resolve) => window.setTimeout(resolve, 300 * (attempt + 1)));
            else console.warn('[GAYZE] Global message decryption failed', error);
          }
        }

        if (disposed || !delivery.current() || supabaseUserIdRef.current !== supabaseUserId) return;
        if (processingGeneration !== messageProcessorRef.current.generation) return false;
        const senderName = row.sender_id === supabaseUserId ? 'You' : room.memberNames?.[row.sender_id] || room.peerName || room.name || 'Gayze member';
        const message: EncryptedMessage = {
          id: row.id, roomId: row.conversation_id, senderKey: row.sender_id, senderName,
          timestamp: new Date(row.created_at).getTime(), cipherText: row.ciphertext,
          nonceHex: row.nonce || '', plainText, expiresAt: row.expires_at ? Date.parse(row.expires_at) : undefined, ephemeralTtlSeconds: room.ephemeralTtlSeconds,
          isBurned: Boolean(row.burned_at || (row.expires_at && Date.parse(row.expires_at) <= Date.now())), mediaUrl, mediaType: mediaUrl ? 'image' : undefined,
        };

        queueMessage(message);
        return decryptedOk || message.isBurned || !row.nonce;
      },
      (status) => {
        if (disposed) return;
        historyOwnershipRef.current.inboxState(status);
        setInboxConnection(status);
        if (status === 'sign-in-required' && supabaseUserIdRef.current === supabaseUserId) {
          authGenerationRef.current += 1;
          clearChatAccount();
          setSessionUserId(null);
          setIsAuthenticated(false);
          void revokeLocalPushSubscription();
        }
      },
      supabaseUserId,
    );
    return () => { disposed = true; unsubscribe(); };
  }, [isAuthenticated, isSigningOut, supabaseUserId]);
  // WebRTC User Signaling & Truthful Presence
  useEffect(() => {
    if (!isSupabaseConfigured || !isAuthenticated || isSigningOut || !supabaseUserId) return;

    // 1. Listen for incoming call requests
    const unsubSignaling = webrtcCallService.initUserSignaling(
      supabaseUserId,
      (call) => {
        setIncomingCall(call);
      },
      (conversationId) => {
        setIncomingCall((current) => (current && current.conversationId === conversationId ? null : current));
      }
    );

    return unsubSignaling;
  }, [supabaseUserId, isAuthenticated, isSigningOut]);

  useEffect(() => {
    if (!isSupabaseConfigured || !isAuthenticated || isSigningOut || !supabaseUserId) return;
    // Use enhanced presence system for both online status and last seen
    const visible = presenceProfileUserId === supabaseUserId && !currentUser.presenceIncognito && currentUser.privacySetting !== 'ghost';
    
    const unsubPresence = initEnhancedPresence(
      supabaseUserId, 
      currentUser.displayName, 
      (presenceMap) => {
        // Convert presence map to online user IDs for backward compatibility
        const onlineIds = new Set<string>();
        presenceMap.forEach((presence, userId) => {
          if (presence.isOnline) {
            onlineIds.add(userId);
          }
        });
        setOnlineUserIds(onlineIds);
        setPresenceMap(presenceMap);
      },
      visible
    );

    return () => {
      unsubPresence();
      setOnlineUserIds(new Set());
      setPresenceMap(new Map());
    };
  }, [supabaseUserId, currentUser.displayName, currentUser.presenceIncognito, currentUser.privacySetting, presenceProfileUserId, isAuthenticated, isSigningOut]);

  // Local persistence is limited to local/demo mode (no Supabase configured).
  // In live mode Supabase is the source of truth: nothing here is written from
  // or read into authenticated application data.
  useEffect(() => {
    if (IS_LIVE_BACKEND) return;
    localStorage.setItem('gayze_user', JSON.stringify(currentUser));
  }, [currentUser]);

  useEffect(() => {
    if (IS_LIVE_BACKEND) return;
    localStorage.setItem('gayze_dating_profiles', JSON.stringify(datingProfiles));
  }, [datingProfiles]);

  useEffect(() => {
    if (IS_LIVE_BACKEND) return;
    localStorage.setItem('gayze_pulses', JSON.stringify(pulses));
  }, [pulses]);

  useEffect(() => {
    if (IS_LIVE_BACKEND) return;
    localStorage.setItem('gayze_gatherings', JSON.stringify(gatherings));
  }, [gatherings]);

  useEffect(() => {
    if (IS_LIVE_BACKEND) return;
    localStorage.setItem('gayze_rooms', JSON.stringify(rooms));
  }, [rooms]);

  useEffect(() => {
    if (IS_LIVE_BACKEND) return;
    localStorage.setItem('gayze_messages', JSON.stringify(messages));
  }, [messages]);

  useEffect(() => {
    if (IS_LIVE_BACKEND) return;
    localStorage.setItem('gayze_checkin', JSON.stringify(checkinState));
  }, [checkinState]);

  useEffect(() => {
    if (IS_LIVE_BACKEND) return;
    if (activeUserIntent) {
      localStorage.setItem('gayze_active_user_intent', JSON.stringify(activeUserIntent));
    } else {
      localStorage.removeItem('gayze_active_user_intent');
    }
  }, [activeUserIntent]);

  // Safety Timer Interval with Vibration API Haptic Warnings
  useEffect(() => {
    if (!checkinState.isActive) return;

    const expiresAt = checkinState.startedAt + checkinState.durationMinutes * 60 * 1000;
    const interval = window.setInterval(() => {
      const nextRemainingSeconds = Math.max(0, Math.ceil((expiresAt - Date.now()) / 1000));
      const previousRemainingSeconds = lastRemainingSecondsRef.current;
      const crossedWarningThreshold = (previousRemainingSeconds > 60 && nextRemainingSeconds <= 60)
        || (previousRemainingSeconds > 30 && nextRemainingSeconds <= 30)
        || (previousRemainingSeconds > 10 && nextRemainingSeconds <= 10)
        || (previousRemainingSeconds > 1 && nextRemainingSeconds <= 6);

      if (crossedWarningThreshold) hapticTimerWarning();
      lastRemainingSecondsRef.current = nextRemainingSeconds;
      setRemainingSeconds(nextRemainingSeconds);

      if (nextRemainingSeconds === 0 && expiredCheckinStartedAtRef.current !== checkinState.startedAt) {
        expiredCheckinStartedAtRef.current = checkinState.startedAt;
        hapticTimerExpired();
        setCheckinState((prev) => prev.startedAt === checkinState.startedAt ? { ...prev, isActive: false } : prev);
        if (isSupabaseConfigured && isAuthenticated) {
          void loadActiveSafetyCheckin().then((active) => {
            if (active) void updateSafetyCheckin(active.id, { status: 'expired' });
          });
        }
        showToast('Safety check-in timer expired. No alert was sent.');
      }
    }, 1000);

    return () => window.clearInterval(interval);
  }, [checkinState.isActive, checkinState.startedAt, checkinState.durationMinutes]);

  // Keyboard shortcut: Escape enters mask mode if nothing open
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !isIdentityOpen && !isSafetyTimerOpen) {
        setIsMaskActive((prev) => !prev);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isIdentityOpen, isSafetyTimerOpen]);

  const showToast = (msg: string) => {
    if (toastTimeoutRef.current !== null) window.clearTimeout(toastTimeoutRef.current);
    setNotificationToast(msg);
    toastTimeoutRef.current = window.setTimeout(() => {
      toastTimeoutRef.current = null;
      setNotificationToast(null);
    }, 4000);
  };

  useEffect(() => () => {
    if (toastTimeoutRef.current !== null) window.clearTimeout(toastTimeoutRef.current);
  }, []);

  // ---------------------------------------------------------------------
  // PWA / Web Push
  //
  // The service worker is what makes Gayze installable and is the only way to
  // receive a real OS-level push. Registration is independent of auth so the
  // install prompt and offline shell work before sign-in.
  // ---------------------------------------------------------------------
  useEffect(() => {
    if (new URLSearchParams(window.location.search).has('notification')) {
      rememberNotificationPath(window.location.pathname + window.location.search);
    }
    void registerServiceWorker();
    // Finish revoking this browser's push subscription if a previous sign-out
    // could not confirm it (shared-device safety). No-op otherwise.
    void finishPendingPushRevoke();
  }, []);

  useEffect(() => {
    if (!isAuthenticated || isSigningOut || !supabaseUserId) return;
    return watchPushSubscriptionRecovery(supabaseUserId);
  }, [isAuthenticated, isSigningOut, supabaseUserId]);

  // Apply a notification deep link on first authenticated render. Auth
  // callback paths are skipped so this can never interfere with the Supabase
  // OAuth/PKCE round trip.
  const initialRouteAppliedRef = useRef(false);
  useEffect(() => {
    if (!isAuthenticated || initialRouteAppliedRef.current || typeof window === 'undefined') return;
    initialRouteAppliedRef.current = true;

    const path = consumeNotificationPath() ?? window.location.pathname + window.location.search;
    if (path === '/' || isAuthPath(path)) return;
    replacePath(path);
    const route = routeFromPath(path);
    setActiveTab(route.tab);
    if (route.conversationId) requestConversationOpen(route.conversationId);
    if (route.openNotifications) setIsNotificationsOpen(true);
  }, [isAuthenticated]);

  // Messages posted by the service worker: notification taps and endpoint
  // rotation. Routing happens in-place so the authenticated session survives.
  useEffect(() => {
    if (typeof navigator === 'undefined' || !('serviceWorker' in navigator)) return;

    const handleMessage = (event: MessageEvent) => {
      const data: unknown = event.data;
      if (!isGayzeServiceWorkerMessage(data)) return;

      if (data.type === 'PRESENT_MESSAGE') {
        const payload = data.payload as { messageId?: string; conversationId?: string; recipientId?: string; presentationExpiresAt?: number } | undefined;
        const uuid = /^[0-9a-f-]{36}$/i;
        const handled = Boolean(payload && typeof payload.presentationExpiresAt === 'number' && payload.presentationExpiresAt >= Date.now() && uuid.test(payload.messageId ?? '') && uuid.test(payload.conversationId ?? '') && payload.recipientId
          && presentIncomingMessage(payload.messageId!, payload.conversationId!, payload.recipientId));
        event.ports[0]?.postMessage({ handled });
        return;
      }
      if (data.type === 'PUSH_RECEIVED') {
        const payload = data.payload as { messageId?: string; recipientId?: string } | undefined;
        if (payload?.messageId && /^[0-9a-f-]{36}$/i.test(payload.messageId) && payload.recipientId) {
          messageAlertsRef.current.acknowledged(payload.messageId, payload.recipientId, supabaseUserIdRef.current);
        }
        notificationRefreshRef.current(); return;
      }
      if (data.type === 'NOTIFICATION_CLICK' && data.url) {
        if (data.navigationExpiresAt && data.navigationExpiresAt < Date.now()) return;
        const parsed = new URL(data.url, window.location.origin);
        if (parsed.origin !== window.location.origin) return;
        if (!supabaseUserIdRef.current) rememberNotificationPath(data.url);
        const notificationId = parsed.searchParams.get('notification');
        if (notificationId && /^[0-9a-f-]{36}$/i.test(notificationId) && supabaseUserIdRef.current) {
          void markNotificationRead(notificationId).then(() => notificationRefreshRef.current()).catch(() => {});
        }
        const route = routeFromPath(data.url);
        setActiveTab(route.tab);
        if (route.conversationId) requestConversationOpen(route.conversationId);
        if (route.openNotifications) setIsNotificationsOpen(true);
        replacePath(data.url);
        event.ports[0]?.postMessage({ handled: true });
        return;
      }

      if (data.type === 'PUSH_SUBSCRIPTION_CHANGED') {
        const account = supabaseUserIdRef.current;
        if (account) void resyncSubscription(data.oldEndpoint ?? null, account, () => supabaseUserIdRef.current === account);
      }
    };

    navigator.serviceWorker.addEventListener('message', handleMessage);
    return () => navigator.serviceWorker.removeEventListener('message', handleMessage);
  }, []);

  useEffect(() => {
    if (!IS_LIVE_BACKEND || !isAuthenticated || isSigningOut || !supabaseUserId) {
      setNotificationInbox(null); updateAppBadge(0); return;
    }
    let disposed = false;
    const owner = watchNotificationInbox(supabaseUserId, (inbox) => {
      if (!disposed && supabaseUserIdRef.current === supabaseUserId) setNotificationInbox(inbox);
    }, (state) => { if (!disposed) setNotificationInboxStatus(state); });
    notificationRefreshRef.current = owner.refresh;
    return () => { disposed = true; owner.stop(); notificationRefreshRef.current = () => {}; };
  }, [isAuthenticated, isSigningOut, supabaseUserId]);

  // Unread state is read from PostgreSQL, never incremented/cleared by tab clicks.
  useEffect(() => {
    if (notificationInbox) updateAppBadge(notificationInbox.unread);
  }, [notificationInbox]);

  useEffect(() => {
    if (!supabaseUserId || !isAuthenticated) return;
    const markVisibleRoom = () => {
      if (document.visibilityState !== 'visible' || activeTab !== 'swarms' || !activeRoomId || visibleChatRoomId !== activeRoomId) return;
      if (chatConnection.roomId !== activeRoomId || chatConnection.state !== 'connected' || conversationKeyState.roomId !== activeRoomId || conversationKeyState.status !== 'ready') return;
      if (!notificationInbox?.rows.some((row) => !row.read_at && row.category === 'message' && row.url === `/messages/${activeRoomId}`)) return;
      void markNotificationRead(undefined, activeRoomId).then(() => notificationRefreshRef.current()).catch(() => {});
    };
    markVisibleRoom(); document.addEventListener('visibilitychange', markVisibleRoom);
    return () => document.removeEventListener('visibilitychange', markVisibleRoom);
  }, [notificationInbox, activeTab, activeRoomId, visibleChatRoomId, supabaseUserId, isAuthenticated, chatConnection, conversationKeyState]);

  // Cold-start notification click survives login; the RPC can mark only OUR row.
  useEffect(() => {
    if (!isAuthenticated || !supabaseUserId) return;
    const id = new URLSearchParams(window.location.search).get('notification');
    if (id && /^[0-9a-f-]{36}$/i.test(id)) {
      void markNotificationRead(id).then(() => notificationRefreshRef.current()).catch(() => {});
    }
  }, [isAuthenticated, supabaseUserId]);

  const openInboxNotification = async (notice: InboxNotification) => {
    const account = supabaseUserIdRef.current, generation = authGenerationRef.current;
    try {
      await markNotificationRead(notice.id);
      if (account !== supabaseUserIdRef.current || generation !== authGenerationRef.current) return;
      notificationRefreshRef.current();
      const route = routeFromPath(notice.url);
      setActiveTab(route.tab);
      if (route.conversationId) requestConversationOpen(route.conversationId);
      setIsNotificationsOpen(Boolean(route.openNotifications));
      replacePath(notice.url);
    } catch { showToast('Could not update the notification. Please try again.'); }
  };

  useEffect(() => {
    if (!isSupabaseConfigured || !supabase || !isAuthenticated || !supabaseUserId) return;
    // Bind the non-null client inside this effect. The auth-bootstrap effect has
    // its own local binding; referencing that one from here was a scope error
    // that threw a ReferenceError the moment a user authenticated.
    const supabaseClient = supabase;
    let disposed = false;
    let initialised = false;

    const handleInterestChange = async () => {
      const incoming = await loadIncomingInterests();
      if (disposed) return;

      const currentIds = new Set(incoming.map((interest) => interest.id));
      if (!initialised) {
        knownIncomingInterestIdsRef.current = currentIds;
        initialised = true;
        return;
      }

      const newInterest = incoming.find((interest) => !knownIncomingInterestIdsRef.current.has(interest.id));
      knownIncomingInterestIdsRef.current = currentIds;
      if (!newInterest) return;

      triggerVibration([40, 60, 100]);
      showToast(`New interest from ${newInterest.fromDisplayName}`);
    };

    void handleInterestChange();
    const channel = supabaseClient
      .channel('gayze-incoming-interests')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'interests' }, () => {
        void handleInterestChange();
      })
      .subscribe((status, error) => {
        if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') {
          console.warn('[GAYZE] Incoming interest realtime unavailable:', error);
        }
      });

    return () => {
      disposed = true;
      void supabaseClient.removeChannel(channel);
    };
  }, [isAuthenticated, supabaseUserId]);


  // Handlers for "Right Now"
  const handleOpenDirectChatFromPulse = async (pulse: Pick<Pulse, 'id' | 'peerId' | 'peerName' | 'peerAvatar' | 'neighborhood' | 'title' | 'intentMode'>, conversationId?: string) => {
    const request = ++directChatRequestRef.current;
    const account = supabaseUserIdRef.current;
    const generation = authGenerationRef.current;
    const current = () => Boolean(request === directChatRequestRef.current && account && account === supabaseUserIdRef.current
      && generation === authGenerationRef.current && !isSigningOutRef.current);
    if (isSupabaseConfigured) {
      if (!isAuthenticated || !current()) { showToast('Sign in to open this conversation.'); return; }
      if (conversationId && (!isConversationId(conversationId) || !isConversationId(pulse.peerId))) {
        showToast('This conversation is unavailable.'); return;
      }
      if (!conversationId) {
        try {
          const target = await resolveLiveDirectChat({
            peerId: pulse.peerId, rooms: roomsRef.current, current,
            loadRooms: async () => {
              const result = await loadConversationListOnce(account!);
              if (!result || !current()) return null;
              const loaded = withoutDeletedRooms(buildRoomsFromSupabase(result, account!), result);
              setRooms(previous => mergeBackendRooms(previous, loaded, account!));
              return loaded;
            },
            submitInterest: () => submitInterest(pulse.peerId,
              pulse.id.startsWith('supabase_') ? pulse.id.slice('supabase_'.length) : undefined),
          });
          if (!current()) return;
          if (target.kind === 'existing') requestConversationOpen(target.room.id);
          else if (target.kind === 'matched') await handleOpenDirectChatFromPulse(pulse, target.conversationId);
          else if (target.kind === 'pending') showToast('Interest sent to ' + pulse.peerName);
        } catch {
          if (current()) showToast('Could not open this conversation. Please try again.');
        }
        return;
      }
    }
    const isSupabaseConversation = Boolean(isSupabaseConfigured && conversationId);
    const conflictingRoom = conversationId && roomsRef.current.find(room => room.id === conversationId
      && (room.type !== 'direct' || (room.peerUserId && room.peerUserId !== pulse.peerId)));
    if (conflictingRoom) { showToast('This conversation does not match the selected person.'); return; }
    const existingRoom = findDirectRoom(roomsRef.current, pulse.peerId, conversationId);
    if (existingRoom) {
      requestConversationOpen(existingRoom.id);
      analytics.logEvent('chat_opened', { source: 'right_now', intent_mode: pulse.intentMode || 'social' });
      return;
    }

    // Create new direct encrypted room with peer. The safety code is derived
    // later from the real device keys (see the conversation hydrate effect) —
    // never from a display handle. Demo rooms derive theirs from the local room
    // secret so it is at least deterministic within the demo.
    const roomId = conversationId || `room_${pulse.peerId}_${Date.now()}`;
    const demoRoomSecret = isSupabaseConversation ? '' : `seed_swarm_${Math.random().toString(36).substring(2)}`;
    const demoSafetyNumber = isSupabaseConversation
      ? ''
      : await generateSafetyFingerprint(demoRoomSecret, pulse.peerId);
    const newRoom: SwarmRoom = {
      id: roomId,
      name: pulse.peerName,
      type: 'direct',
      // Demo rooms carry a local room secret; live rooms resolve their peer key
      // (and safety code) from the backend.
      peerKey: isSupabaseConversation ? undefined : `demo_peer_${pulse.peerId}`,
      peerUserId: pulse.peerId,
      peerName: pulse.peerName,
      peerNeighborhood: pulse.neighborhood,
      peerAvatar: pulse.peerAvatar,
      safetyNumber: demoSafetyNumber,
      swarmSecretKeyHex: demoRoomSecret,
      connectionContext: pulse.id ? `Connected via ${pulse.intentMode || 'social'} intent: ${pulse.title}` : `Connected via Discover: ${pulse.title}`,
      lastMessage: pulse.id ? `Connected via pulse: "${pulse.title}"` : 'Connected via Discover',
      lastTimestamp: Date.now(),
      ephemeralTtlSeconds: 3600, // default 1 hr burner
    };

    setRooms((prev) => prev.some(room => room.id === roomId)
      ? prev.map(room => room.id === roomId ? { ...room, peerUserId: pulse.peerId, peerName: pulse.peerName } : room)
      : [newRoom, ...prev]);
    if (!isSupabaseConversation) {
      // Demo mode only: the opening line is encrypted with the room secret
      // rather than stored as a hand-written placeholder ciphertext.
      const opening = `Hey ${pulse.peerName}, saw your pulse for ${pulse.title}!`;
      try {
        const encrypted = await encryptPayload(opening, newRoom.swarmSecretKeyHex);
        setMessages((prev) => ({
          ...prev,
          [roomId]: [{
            id: 'msg_init_' + Date.now(),
            roomId,
            senderKey: currentUser.publicKey,
            senderName: currentUser.displayName,
            timestamp: Date.now(),
            cipherText: encrypted.cipherHex,
            nonceHex: encrypted.nonceHex,
            plainText: opening,
          }],
        }));
      } catch (error) {
        console.warn('[GAYZE] Could not encrypt demo opening message', error);
      }
    }

    requestConversationOpen(roomId);
    analytics.logEvent('conversation_created', { source: 'right_now', intent_mode: pulse.intentMode || 'social' });
    analytics.logEvent('chat_opened', { source: 'right_now', intent_mode: pulse.intentMode || 'social' });
    showToast(`Chat opened with ${pulse.peerName}`);
  };

  // Handlers for "Dating"
  const handleToggleFavoriteProfile = (profileId: string) => {
    setDatingProfiles((prev) =>
      prev.map((p) => {
        if (p.id === profileId) {
          const nextFav = !p.isFavorited;
          showToast(nextFav ? `Saved ${p.name} to favorites` : `Removed ${p.name} from favorites`);
          return { ...p, isFavorited: nextFav };
        }
        return p;
      })
    );
  };

  const handleOpenDirectChatWithProfile = async (profile: DatingProfile) => {
    // Never fall through to demo room creation in a configured live app.
    if (isSupabaseConfigured) {
      const pulse = supabaseRightNowPulses.find((item) => item.peerId === profile.id);
      await handleOpenDirectChatFromPulse(pulse || {
        id: '', peerId: profile.id, peerName: profile.name,
        peerAvatar: '', neighborhood: profile.neighborhood, title: profile.headline,
      });
      return;
    }

    const existingRoom = rooms.find(
      (r) => r.peerKey?.includes(profile.peerPublicKey.slice(0, 16)) || r.name.startsWith(profile.name)
    );

    if (existingRoom) {
      requestConversationOpen(existingRoom.id);
      analytics.logEvent('chat_opened', { source: 'discover' });
      return;
    }

    const roomId = `room_prof_${profile.id}_${Date.now()}`;
    const safetyNumber = await generateSafetyFingerprint(currentUser.publicKey, profile.peerPublicKey);
    const newRoom: SwarmRoom = {
      id: roomId,
      name: `${profile.name}, ${profile.age}`,
      type: 'direct',
      peerKey: profile.peerPublicKey,
      peerName: profile.name,
      peerNeighborhood: profile.neighborhood,
      peerAvatar: profile.name.toLowerCase(),
      safetyNumber,
      swarmSecretKeyHex: 'seed_swarm_' + Math.random().toString(36).substring(2),
      connectionContext: `Connected via Discover: ${profile.headline}`,
      lastMessage: `Connected via Gayze Dating · ${profile.headline}`,
      lastTimestamp: Date.now(),
      ephemeralTtlSeconds: 86400, // 24hr default
    };

    const initialMsg: EncryptedMessage = {
      id: 'msg_prof_init_' + Date.now(),
      roomId,
      senderKey: currentUser.publicKey,
      senderName: currentUser.displayName,
      timestamp: Date.now(),
      cipherText: '9a01f8...encrypted',
      nonceHex: '190284719203847102938471',
      plainText: `Direct private chat opened with ${profile.name}. Location protected by ~300m privacy blur.`,
      isSystem: true,
    };

    setRooms((prev) => [newRoom, ...prev]);
    setMessages((prev) => ({
      ...prev,
      [roomId]: [initialMsg],
    }));
    requestConversationOpen(roomId);
    analytics.logEvent('conversation_created', { source: 'discover' });
    analytics.logEvent('chat_opened', { source: 'discover' });
    showToast(`Encrypted chat opened with ${profile.name}`);
  };

  const handleProposeHavenDate = async (profile: DatingProfile, havenName?: string) => {
    const targetHaven = havenName || profile.favoriteSafeHaven || 'Timberyard Community Cafe';
    await handleOpenDirectChatWithProfile(profile);
    showToast(`Date proposal at ${targetHaven} ready in chat`);
  };

  // Handlers for Swarm QR Key Exchange & In-Person Verification
  const handleOpenQRModal = (targetPeer?: DatingProfile | null) => {
    setQrTargetPeer(targetPeer || null);
    setIsQRModalOpen(true);
  };

  const handleVerifyPeer = async (payload: SwarmQRPayload) => {
    // The QR flow is only complete after the fingerprint has been compared
    // in person and the verification is persisted against the authenticated account.
    hapticQRHandshake();

    if (isSupabaseConfigured && isAuthenticated) {
      const verified = await verifyPeerIdentity(
        payload.publicKey,
        payload.fingerprint || payload.publicKey,
        currentDeviceFingerprint,
      );
      if (!verified) {
        showToast('Verification was not saved. The peer identity is not registered.');
        return;
      }
    }

    setCurrentUser((prev) => ({
      ...prev,
      verifiedPeersCount: (prev.verifiedPeersCount || 0) + 1,
    }));

    // Associate verification only with an exact public-key match.
    setDatingProfiles((prev) =>
      prev.map((p) => {
        if (p.peerPublicKey === payload.publicKey) {
          return {
            ...p,
            verifiedViaQR: true,
          };
        }
        return p;
      })
    );

    // Find or create the direct room using the verified public key.
    let existingRoom = rooms.find(
      (r) => r.peerKey === payload.publicKey
    );

    const roomId = existingRoom ? existingRoom.id : `room_qr_${Date.now()}`;
    const peerScore = payload.reliabilityScore;

    if (!existingRoom) {
      const safetyNumber = await generateSafetyFingerprint(currentUser.publicKey, payload.publicKey);
      const newRoom: SwarmRoom = {
        id: roomId,
        name: payload.displayName,
        type: 'direct',
        peerKey: payload.publicKey,
        peerName: payload.displayName,
        peerNeighborhood: payload.neighborhood,
        peerAvatar: payload.displayName.toLowerCase().slice(0, 8),
        safetyNumber,
        swarmSecretKeyHex: 'seed_qr_swarm_' + Math.random().toString(36).substring(2),
        lastMessage: `Fingerprint verified on this device · ${peerScore}/100 trust score`,
        lastTimestamp: Date.now(),
        ephemeralTtlSeconds: 86400,
        verifiedViaQR: true,
        verifiedAt: Date.now(),
        peerReliabilityScore: peerScore,
      };
      setRooms((prev) => [newRoom, ...prev]);
    } else {
      setRooms((prev) =>
        prev.map((r) =>
          r.id === roomId
            ? {
              ...r,
              verifiedViaQR: true,
              verifiedAt: Date.now(),
              peerReliabilityScore: peerScore,
              lastMessage: `Fingerprint verified on this device · ${peerScore}/100 trust score`,
              lastTimestamp: Date.now(),
            }
            : r
        )
      );
    }

    setActiveRoomId(roomId);
    showToast(`Fingerprint verified on this device for ${payload.displayName}`);
  };

  // Handlers for "Later"
  const handleToggleRsvp = async (gatheringId: string) => {
    if (isSupabaseConfigured && isAuthenticated) {
      const changedToAttending = await toggleGatheringRsvp(gatheringId);
      setGatherings((prev) => prev.map((g) => g.id === gatheringId
        ? {
            ...g,
            isAttending: changedToAttending,
            rsvpCount: Math.max(0, g.rsvpCount + (changedToAttending ? 1 : -1)),
          }
        : g
      ));
      const gathering = gatherings.find((g) => g.id === gatheringId);
      showToast(changedToAttending ? `RSVP confirmed for ${gathering?.title || 'gathering'}` : `RSVP cancelled for ${gathering?.title || 'gathering'}`);
      return;
    }
    setGatherings((prev) =>
      prev.map((g) => {
        if (g.id === gatheringId) {
          const nextState = !g.isAttending;
          showToast(nextState ? `RSVP confirmed for ${g.title}` : `RSVP cancelled for ${g.title}`);
          return { ...g, isAttending: nextState, rsvpCount: nextState ? g.rsvpCount + 1 : Math.max(0, g.rsvpCount - 1) };
        }
        return g;
      })
    );
  };

  const handleOpenGatheringChat = (gathering: Gathering) => {
    const existing = rooms.find((r) => r.id === 'room_' + gathering.id);
    if (existing) {
      requestConversationOpen(existing.id);
      return;
    }

    if (isSupabaseConfigured && isAuthenticated) {
      showToast('Gathering chat is not available until a real group conversation is created.');
      return;
    }

    const roomId = 'room_' + gathering.id;
    const newRoom: SwarmRoom = {
      id: roomId,
      name: gathering.title + ' Group',
      type: 'gathering',
      safetyNumber: 'local',
      swarmSecretKeyHex: 'local_gathering_' + gathering.id,
      lastMessage: `Joined local coordination room for ${gathering.locationName}`,
      lastTimestamp: Date.now(),
      ephemeralTtlSeconds: 0,
    };

    setRooms((prev) => [newRoom, ...prev]);
    requestConversationOpen(roomId);
  };

  const handleCreateGathering = async (newGathering: Omit<Gathering, 'id' | 'rsvpCount' | 'isAttending'>) => {
    if (isSupabaseConfigured && isAuthenticated) {
      const id = await createGathering(newGathering);
      if (!id) {
        showToast('Unable to create gathering. Please try again.');
        return;
      }
      const created: Gathering = { ...newGathering, id, rsvpCount: 0, isAttending: false };
      setGatherings((prev) => [created, ...prev]);
      const attending = await toggleGatheringRsvp(id);
      setGatherings((prev) => prev.map((g) => g.id === id ? { ...g, isAttending: attending, rsvpCount: attending ? 1 : 0 } : g));
      showToast('Gathering created and RSVP recorded.');
      return;
    }
    const gathering: Gathering = { ...newGathering, id: 'gath_' + Date.now(), rsvpCount: 1, isAttending: true };
    setGatherings((prev) => [gathering, ...prev]);
    showToast('Gathering created.');
  };

  // Hydrate and subscribe to real Supabase conversation messages.
  // Direct conversations derive their key from the two device identities;
  // group conversations resolve a per-device key envelope. When no key can be
  // resolved the chat says so and sending is blocked — nothing is faked.
  useEffect(() => {
    if (!IS_LIVE_BACKEND || !isAuthenticated || isSigningOut || !supabaseUserId || !activeRoomId || !/^[0-9a-f-]{36}$/i.test(activeRoomId)) return;
    let disposed = false;

    let keyReady = false;
    let historyHadFailure = false;
    const room = roomsRef.current.find((candidate) => candidate.id === activeRoomId);

    const applyRow = async (row: {
      id: string;
      conversation_id: string;
      sender_id: string;
      ciphertext: string;
      nonce: string | null;
      created_at: string;
      expires_at: string | null;
      burned_at: string | null;
    }, delivery: MessageDelivery) => {
      if (disposed || !delivery.current()) return;
      const processingGeneration = messageProcessorRef.current.generation;
      const targetRoom = roomsRef.current.find((candidate) => candidate.id === activeRoomId);
      if (!targetRoom) throw new Error('Conversation metadata unavailable');

      let plainText = '[Encrypted message]';
      let mediaUrl: string | undefined = undefined;
      let decryptedOk = false;

      // A message can arrive through Realtime before the device identity/key
      // bootstrap has finished. Resolve the key again and retry a few times so
      // the recipient never gets stuck with a permanent ciphertext placeholder.
      for (let attempt = 0; attempt < (delivery.notify ? 3 : 1) && row.nonce && !row.burned_at && (!row.expires_at || Date.parse(row.expires_at) > Date.now()) && !decryptedOk; attempt += 1) {
        try {
          if (disposed || !delivery.current() || processingGeneration !== messageProcessorRef.current.generation) return false;
          const decrypted = await messageProcessorRef.current.text(targetRoom, row, supabaseUserId);
          keyReady = true;
          if (decrypted.startsWith('{"') && decrypted.includes('"mediaUrl"')) {
            try {
              const parsed = JSON.parse(decrypted);
              plainText = parsed.text || '';
              mediaUrl = parsed.mediaUrl;
            } catch {
              plainText = decrypted;
            }
          } else {
            plainText = decrypted;
          }
          decryptedOk = true;
        } catch (error) {
          keyReady = false;
          if (attempt < (delivery.notify ? 2 : 0)) await new Promise((resolve) => window.setTimeout(resolve, 300 * (attempt + 1)));
          else console.warn('[GAYZE] Unable to decrypt conversation message', error);
        }
      }

      if (disposed || !delivery.current() || supabaseUserIdRef.current !== supabaseUserId) return;
      if (processingGeneration !== messageProcessorRef.current.generation) return false;
      if (row.burned_at || (row.expires_at && Date.parse(row.expires_at) <= Date.now())) messageProcessorRef.current.forget(row, supabaseUserId);
      if (decryptedOk) setConversationKeyState((prev) => prev.roomId === activeRoomId && prev.status === 'ready' ? prev : { roomId: activeRoomId, status: 'ready' });
      const senderName = row.sender_id === supabaseUserIdRef.current
        ? 'You'
        : targetRoom.memberNames?.[row.sender_id] || targetRoom.peerName || targetRoom.name || 'Gayze member';

      const message: EncryptedMessage = {
        id: row.id,
        roomId: row.conversation_id,
        senderKey: row.sender_id,
        senderName,
        timestamp: new Date(row.created_at).getTime(),
        cipherText: row.ciphertext,
        nonceHex: row.nonce || '',
        expiresAt: row.expires_at ? Date.parse(row.expires_at) : undefined,
        plainText,
        ephemeralTtlSeconds: targetRoom.ephemeralTtlSeconds,
        isBurned: Boolean(row.burned_at || (row.expires_at && Date.parse(row.expires_at) <= Date.now())),
        mediaUrl,
        mediaType: mediaUrl ? 'image' : undefined,
      };

      if (!decryptedOk && !message.isBurned && row.nonce) historyHadFailure = true;
      queueMessage(message);
      return decryptedOk || message.isBurned || !row.nonce;
    };

    const hydrate = async () => {
      setConversationKeyState({ roomId: activeRoomId, status: 'loading' });
      if (!room) {
        setConversationKeyState({
          roomId: activeRoomId,
          status: 'unavailable',
          reason: 'This conversation is still loading.',
        });
        return;
      }
      try {
        const result = await messageProcessorRef.current.key(room, supabaseUserId);
        if (disposed) return;
        keyReady = Boolean(result.key);
        setConversationKeyState({
          roomId: activeRoomId,
          status: result.status,
          reason: result.reason,
        });
      } catch (error: any) {
        if (disposed) return;
        setConversationKeyState({
          roomId: activeRoomId,
          status: 'unavailable',
          reason: error?.message || 'The conversation key could not be resolved on this device.',
        });
      }

      // Direct conversations get a real safety code, derived from both device
      // keys. It is only set when the peer's key is actually available; until
      // then the verification screen says the code is unavailable.
      if (!disposed && room.type === 'direct' && !room.safetyNumber) {
        try {
          const peer = await loadConversationPeerKey(room.id);
          if (peer?.peer_public_key) {
            const peerJwk = JSON.parse(peer.peer_public_key) as JsonWebKey;
            const identity = await getOrCreateDeviceIdentity();
            const coords = (jwk: JsonWebKey) => `${jwk.x ?? ''}.${jwk.y ?? ''}`;
            if (coords(identity.publicKeyJwk) !== '.') {
              const safetyNumber = await generateSafetyFingerprint(
                coords(identity.publicKeyJwk),
                coords(peerJwk),
              );
              if (!disposed) {
                setRooms((prev) => prev.map((candidate) => (
                  candidate.id === room.id
                    ? { ...candidate, peerKey: peer.peer_public_key ?? undefined, safetyNumber }
                    : candidate
                )));
              }
            }
          }
        } catch (error) {
          console.warn('[GAYZE] Safety code unavailable for this conversation', error);
        }
      }

    };

    let keyLoad: Promise<void> | null = null;
    const refreshKeys = () => {
      if (keyLoad || disposed) return;
      keyLoad = hydrate().catch(() => {
        if (!disposed) setConversationKeyState({ roomId: activeRoomId, status: 'unavailable', reason: 'Secure conversation setup is temporarily unavailable.' });
      }).finally(() => { keyLoad = null; });
    };

    // Subscribe independently of key/history hydration. A failed initial read
    // must never prevent the retry owner from being installed.
    const unsubscribe = subscribeToConversationMessages(
      activeRoomId,
      applyRow,
      (state) => {
        if (disposed) return;
        setChatConnection({ roomId: activeRoomId, state });
        if (state === 'connected') historyOwnershipRef.current.roomComplete(activeRoomId, keyReady && !historyHadFailure);
        else if (['reconnecting', 'offline', 'suspended', 'sign-in-required'].includes(state)) historyOwnershipRef.current.unseenOlderRow(activeRoomId);
        if (state === 'connected' && !keyReady) refreshKeys();
      },
      supabaseUserId,
      () => historyOwnershipRef.current.canReuse(activeRoomId),
    );
    refreshKeys();

    return () => { disposed = true; unsubscribe(); };
  }, [activeRoomId, supabaseUserId, isAuthenticated, isSigningOut, rooms.some((room) => room.id === activeRoomId)]);

  // Chat message sending with real WebCrypto AES-GCM
  const handleSendMessage = async (
    roomId: string,
    plainText: string,
    ephemeralTtlSeconds?: number,
    meetingData?: MeetingProposal,
    mediaUrl?: string,
    messageId?: string,
  ) => {
    const room = rooms.find((r) => r.id === roomId);
    if (!room) return;
    const sendingUserId = supabaseUserIdRef.current;
    const sendingGeneration = authGenerationRef.current;

    const isSupabaseRoom = IS_LIVE_BACKEND && /^[0-9a-f-]{36}$/i.test(roomId);
    let cipherHex: string;
    let nonceHex: string;
    const textToEncrypt = mediaUrl
      ? JSON.stringify({ text: plainText, mediaUrl })
      : plainText;

    if (isSupabaseRoom) {
      const resolved = await messageProcessorRef.current.key(room, sendingUserId!);
      if (!resolved.key) {
        throw new Error(resolved.reason || 'This conversation cannot be encrypted on this device yet');
      }
      try {
        ({ cipherHex, nonceHex } = await encryptWithConversationKey(textToEncrypt, resolved.key));
      } catch (error) {
        console.error('[GAYZE] Secure conversation encryption failed', error);
        throw new Error('Secure encryption failed. Message not sent.');
      }
    } else {
      try {
        ({ cipherHex, nonceHex } = await encryptPayload(textToEncrypt, room.swarmSecretKeyHex));
      } catch (error) {
        console.error('[GAYZE] Local message encryption failed', error);
        throw new Error('Secure encryption is unavailable. Message not sent.');
      }
    }

    const newMsg: EncryptedMessage = {
      id: 'msg_' + Date.now(),
      roomId,
      senderKey: currentUser.publicKey,
      senderName: currentUser.displayName,
      timestamp: Date.now(),
      cipherText: cipherHex,
      nonceHex,
      plainText,
      ephemeralTtlSeconds: ephemeralTtlSeconds || room.ephemeralTtlSeconds,
      meetingData,
      mediaUrl,
      mediaType: mediaUrl ? 'image' : undefined,
    };

    if (!isSupabaseRoom) {
      setMessages((prev) => ({
        ...prev,
        [roomId]: [...(prev[roomId] || []), newMsg],
      }));
    }

    if (!isSupabaseRoom) setRooms((prev) =>
      prev.map((r) =>
        r.id === roomId
          ? { ...r, lastMessage: plainText, lastTimestamp: Date.now() }
          : r
      )
    );

    // Real Supabase conversation: persist the encrypted envelope and let Realtime
    // deliver it to every member. Local/demo rooms retain the prototype reply.
    if (isSupabaseRoom) {
      try {
        const expiresAt = ephemeralTtlSeconds && ephemeralTtlSeconds > 0
          ? new Date(Date.now() + ephemeralTtlSeconds * 1000).toISOString()
          : null;
        if (isSigningOutRef.current || supabaseUserIdRef.current !== sendingUserId || authGenerationRef.current !== sendingGeneration) throw new Error('Session changed');
        const persisted = await persistConversationMessage(roomId, cipherHex, nonceHex, expiresAt, messageId, sendingUserId ?? undefined);
        if (isSigningOutRef.current || supabaseUserIdRef.current !== sendingUserId || authGenerationRef.current !== sendingGeneration) throw new Error('Session changed');
        setMessages((prev) => ({
          ...prev,
          [roomId]: mergeMessage(prev[roomId] || [], {
            ...newMsg, id: persisted.id, timestamp: new Date(persisted.created_at).getTime(),
            expiresAt: persisted.expires_at ? Date.parse(persisted.expires_at) : undefined,
            isBurned: Boolean(persisted.burned_at || (persisted.expires_at && Date.parse(persisted.expires_at) <= Date.now())),
            senderKey: persisted.sender_id, senderName: 'You', roomId: persisted.conversation_id,
            cipherText: persisted.ciphertext, nonceHex: persisted.nonce || nonceHex,
          }),
        }));
        const sentAt = Date.parse(persisted.created_at);
        setRooms((prev) => prev.map((candidate) => candidate.id === roomId && candidate.lastTimestamp <= sentAt
          ? { ...candidate, lastMessage: persisted.burned_at || (persisted.expires_at && Date.parse(persisted.expires_at) <= Date.now()) ? 'Message expired' : plainText, lastTimestamp: sentAt }
          : candidate));
        hapticMessageDecrypted();
      } catch (error) {
        console.error('[GAYZE] Failed to persist encrypted message', error);
        showToast('Message delivery not confirmed — your draft is kept');
        throw error;
      }
      return;
    }

    // Demo mode only (no Supabase configured): the local prototype simulates a
    // friendly reply so the local chat shell can be exercised. This never runs
    // against the live backend.
    if (!IS_LIVE_BACKEND && room.type === 'direct') {
      window.setTimeout(async () => {
        let randomReply: string;
        if (meetingData) {
          randomReply = `Sounds fantastic! I'd love to meet at ${meetingData.venueName} (${meetingData.timeStr}). Looking forward to it!`;
        } else {
          const peerReplies = [
            "Hey! Sounds great. I'm right nearby in the courtyard area.",
            "Awesome. Let me know when you get here, I'll keep an eye out.",
            'Perfect! I appreciate you verifying the safety number too.',
            'Looking forward to it! See you shortly in the public lounge.',
          ];
          randomReply = peerReplies[Math.floor(Math.random() * peerReplies.length)];
        }
        const encPeer = await encryptPayload(randomReply, room.swarmSecretKeyHex);

        const peerMsg: EncryptedMessage = {
          id: 'msg_peer_' + Date.now(),
          roomId,
          senderKey: room.peerKey || 'peer_key',
          senderName: room.name,
          timestamp: Date.now(),
          cipherText: encPeer.cipherHex,
          nonceHex: encPeer.nonceHex,
          plainText: randomReply,
          ephemeralTtlSeconds: room.ephemeralTtlSeconds,
        };

        setMessages((prev) => ({
          ...prev,
          [roomId]: [...(prev[roomId] || []), peerMsg],
        }));

        hapticMessageDecrypted();

        setRooms((prev) =>
          prev.map((r) =>
            r.id === roomId
              ? { ...r, lastMessage: randomReply, lastTimestamp: Date.now() }
              : r
          )
        );
      }, 1500);
    }
  };

  const handleDeleteMessageForMe = async (messageId: string) => {
    await deleteMessageForMe(messageId);
    setMessages((prev) => Object.fromEntries(Object.entries(prev).map(([roomId, roomMessages]) => [roomId, roomMessages.filter((message) => message.id !== messageId)])));
  };
  const handleUnsendMessage = async (messageId: string) => {
    await unsendMessage(messageId);
    setMessages((prev) => Object.fromEntries(Object.entries(prev).map(([roomId, roomMessages]) => [roomId, roomMessages.map((message) => message.id === messageId ? { ...message, deletedForEveryone: true, isBurned: false, plainText: 'Message unsent', cipherText: '' } : message)])));
  };
  const handleSetMessageExpiry = async (messageId: string, ttlSeconds: number | null) => {
    const expiresAt = ttlSeconds == null ? null : new Date(Date.now() + ttlSeconds * 1000);
    await setMessageExpiry(messageId, expiresAt);
    setMessages((prev) => Object.fromEntries(Object.entries(prev).map(([roomId, roomMessages]) => [roomId, roomMessages.map((message) => message.id === messageId ? { ...message, expiresAt: expiresAt?.getTime() } : message)])));
  };

  const handleSignOut = async () => {
    if (isSigningOut) return;
    setIsSigningOut(true);
    isSigningOutRef.current = true;

    // Invalidate every in-flight auth/bootstrap operation immediately.
    // The UI must never wait for a network round-trip to show the signed-out state.
    authGenerationRef.current += 1;
    clearChatAccount();
    locationWatchStopRef.current?.();
    locationWatchStopRef.current = null;
    recoverySessionRef.current = false;

    // Release this device's push subscription while the session is still
    // valid (the row delete needs the user's JWT to pass RLS). Bounded and
    // never throws: a failed cleanup can not block sign-out. If it cannot
    // be confirmed, the subscription is revoked on next app start.
    await releasePushOnSignOut();

    // Remove the persisted browser session first. This is the authoritative
    // local logout path and also works when Supabase's network sign-out is
    // unavailable or slow.
    try {
      window.localStorage.removeItem(GAYZE_AUTH_STORAGE_KEY);
      window.sessionStorage.removeItem(GAYZE_AUTH_STORAGE_KEY);
      for (const storage of [window.localStorage, window.sessionStorage]) {
        for (let index = storage.length - 1; index >= 0; index -= 1) {
          const key = storage.key(index);
          if (key && (
            key.startsWith('sb-') ||
            key.includes('supabase.auth') ||
            key.includes('supabase-auth-token')
          )) {
            storage.removeItem(key);
          }
        }
      }
    } catch (error) {
      console.warn('[GAYZE] Could not clear browser auth storage:', error);
    }

    // Clear local application state synchronously. Device identity keys are
    // deliberately kept (they belong to the device, not the account) but
    // every account-derived cache is removed.
    for (const key of [
      'gayze_messages',
      'gayze_active_user_intent',
      'gayze_user',
      'gayze_rooms',
      'gayze_pulses',
      'gayze_gatherings',
      'gayze_stories',
      'gayze_intent_posts',
      'gayze_checkin',
      'gayze_verified_rooms',
    ]) {
      localStorage.removeItem(key);
    }
    setActiveUserIntent(null);
    setSupabaseRightNowPulses([]);
    setSupabaseReady(false);
    setSupabaseUserId(null);
    setIdentityDevices([]);
    setCurrentDeviceFingerprint(null);
    setOnlineUserIds(new Set());
    setUserLocation(null);
    setLocationError(null);
    setIsIdentityOpen(false);
    setIsAuthenticated(false);
    setAuthReady(true);

    // Close the modal immediately so the sign-out action cannot be obscured by
    // the authenticated shell while Supabase finishes its own session cleanup.
    setIsIdentityOpen(false);

    // Server-side session invalidation. Bound the wait so a network
    // failure can never trap the user in the authenticated shell.
    if (supabase) {
      try {
        await Promise.race([
          supabase.auth.signOut({ scope: 'global' }),
          new Promise((resolve) => window.setTimeout(resolve, 1500)),
        ]);
      } catch (error) {
        console.warn('[GAYZE] Supabase local sign-out failed:', error);
      }
    }

    // Reload into a clean document after local credentials and application
    // state have already been cleared. This prevents a stale Supabase
    // bootstrap callback or browser auth refresh from restoring the shell.
    window.location.replace(window.location.origin + '/?signed_out=1');
  };

  const handleDeleteChat = async (roomId: string) => {
    const account = supabaseUserIdRef.current;
    if (!account || !isConversationId(roomId)) throw new Error('This conversation is unavailable.');
    // Until the delete is confirmed, drop every list load for this room.
    deletedRooms.begin(roomId);
    conversationLoadRef.current = null;
    try {
      await leaveConversation(roomId);
    } catch (error) {
      deletedRooms.fail(roomId);
      throw error;
    }
    deletedRooms.confirm(roomId);
    conversationLoadRef.current = null;
    messageProcessorRef.current.forgetConversation(roomId);
    setRooms((prev) => prev.filter((room) => room.id !== roomId));
    setMessages((prev) => {
      if (!(roomId in prev)) return prev;
      const { [roomId]: _removed, ...rest } = prev;
      return rest;
    });
    if (activeRoomIdRef.current === roomId) {
      setActiveRoomId('');
      setChatOpenRequest(null);
      reportVisibleChatRoom(null);
    }
    showToast('Chat deleted');
  };

  const handleUpdateRoomTtl = (roomId: string, ttl: number) => {
    setRooms((prev) =>
      prev.map((r) => (r.id === roomId ? { ...r, ephemeralTtlSeconds: ttl } : r))
    );
    showToast(ttl === 0 ? 'Auto-delete turned off (messages will be kept)' : `Messages will auto-delete after ${ttl >= 3600 ? ttl / 3600 + 'h' : ttl / 60 + 'm'}`);
  };

  // Meeting Scheduling & Acceptance Handlers
  const handleOpenScheduleMeeting = (peerName: string) => {
    setScheduleMeetingPeerName(peerName);
    setIsScheduleMeetingOpen(true);
  };

  const handleConfirmMeeting = async (proposal: {
    venueName: string;
    address: string;
    timeStr: string;
    isSafeHaven: boolean;
    durationMinutes: number;
    startLocalCheckin: boolean;
  }) => {
    setIsScheduleMeetingOpen(false);

    if (proposal.startLocalCheckin) {
      handleStartSafetyTimer({
        partnerName: scheduleMeetingPeerName,
        venueName: proposal.venueName,
        durationMinutes: proposal.durationMinutes || 60,
        notes: `Meeting with ${scheduleMeetingPeerName} at ${proposal.venueName} (${proposal.timeStr})`,
      });
    }

    // Find or create direct room with this peer
    let targetRoom = rooms.find(
      (r) =>
        r.peerName?.toLowerCase() === scheduleMeetingPeerName.toLowerCase() ||
        r.name.toLowerCase().startsWith(scheduleMeetingPeerName.toLowerCase())
    );

    let roomId = targetRoom?.id;
    if (!targetRoom) {
      roomId = `room_${Date.now()}`;
      const safetyNumber = await generateSafetyFingerprint(currentUser.publicKey, scheduleMeetingPeerName);
      targetRoom = {
        id: roomId,
        name: scheduleMeetingPeerName,
        type: 'direct',
        peerKey: 'pk_' + scheduleMeetingPeerName.toLowerCase(),
        peerName: scheduleMeetingPeerName,
        peerNeighborhood: currentUser.neighborhood,
        peerAvatar: scheduleMeetingPeerName.toLowerCase(),
        safetyNumber,
        swarmSecretKeyHex: 'seed_room_' + Math.random().toString(36).substring(2),
        lastMessage: `Meeting proposed at ${proposal.venueName}`,
        lastTimestamp: Date.now(),
        ephemeralTtlSeconds: 86400,
      };
      setRooms((prev) => [targetRoom!, ...prev]);
    }

    const meetingData: MeetingProposal = {
      id: 'meet_' + Date.now(),
      venueName: proposal.venueName,
      address: proposal.address,
      timeStr: proposal.timeStr,
      timestamp: Date.now(),
      status: 'proposed',
      isSafeHaven: proposal.isSafeHaven,
      safetyTimerDurationMinutes: proposal.durationMinutes || 60,
    };

    try {
      await handleSendMessage(
      targetRoom.id,
      `Safe meetup invitation: let's meet at ${proposal.venueName}, ${proposal.timeStr}.`,
      targetRoom.ephemeralTtlSeconds,
      meetingData
    );
    } catch { showToast('Meetup invitation was not confirmed. Please try again.'); return; }

    requestConversationOpen(targetRoom.id);
    showToast(`Meetup proposal sent to ${scheduleMeetingPeerName} at ${proposal.venueName}`);
  };

  const handleAcceptMeeting = async (meeting: MeetingProposal) => {
    // Arm safety timer for user
    handleStartSafetyTimer({
      partnerName: 'Peer',
      venueName: meeting.venueName,
      durationMinutes: meeting.safetyTimerDurationMinutes || 60,
      notes: `Accepted meetup at ${meeting.venueName} (${meeting.timeStr})`,
    });

    // Update message state in current active room
    setMessages((prev) => {
      const roomMsgs = prev[activeRoomId] || [];
      const updated = roomMsgs.map((m) => {
        if (m.meetingData && m.meetingData.id === meeting.id) {
          return {
            ...m,
            meetingData: {
              ...m.meetingData,
              status: 'accepted' as const,
            },
          };
        }
        return m;
      });
      return { ...prev, [activeRoomId]: updated };
    });

    // Send confirmation in room
    try {
      await handleSendMessage(
      activeRoomId,
      `Accepted — see you at ${meeting.venueName}, ${meeting.timeStr}. Local check-in timer started.`
    );
    } catch { showToast('Acceptance message was not confirmed. Your local safety timer is still active.'); }
  };

  const handleSaveProfileEdit = async (payload: ProfileSavePayload): Promise<boolean> => {
    // Persist locally first so profile editing remains useful offline.
    const intimacy: import('./types').IntimacyProfile = payload.intimacy;
    setCurrentUser((prev) => ({
      ...prev,
      displayName: payload.displayName,
      handle: payload.handle,
      bio: payload.bio,
      age: payload.age,
      privacySetting: payload.privacySetting,
      interests: payload.lookingFor,
      pronouns: payload.pronouns,
      heightCm: payload.heightCm,
      bodyType: payload.bodyType,
      hobbies: payload.hobbies,
      boundaries: payload.boundaries,
      mySetup: payload.mySetup,
      availability: payload.availability,
      intimacy,
    }));

    try {
      localStorage.setItem('gayze_user', JSON.stringify({
        ...currentUserRef.current,
        displayName: payload.displayName,
        handle: payload.handle,
        bio: payload.bio,
        age: payload.age,
        privacySetting: payload.privacySetting,
        interests: payload.lookingFor,
        pronouns: payload.pronouns,
        heightCm: payload.heightCm,
        bodyType: payload.bodyType,
        hobbies: payload.hobbies,
        boundaries: payload.boundaries,
        mySetup: payload.mySetup,
        availability: payload.availability,
        intimacy,
      }));
    } catch {
      // Local persistence is best-effort.
    }

    if (!supabaseUserId) {
      showToast('Profile saved');
      return true;
    }

    const coreSaved = await updateSupabaseProfile(supabaseUserId, {
      displayName: payload.displayName,
      handle: payload.handle,
      bio: payload.bio,
      age: payload.age ?? currentUser.age ?? 18,
      privacySetting: payload.privacySetting,
      interests: payload.lookingFor,
    });

    if (!coreSaved) {
      showToast('Could not save your account profile — changes kept on this device');
      return false;
    }

    // These fields are additive and may not exist until the migration is applied.
    // Fail soft: the core profile save remains successful.
    const detailsSaved = await updateProfileDetails(supabaseUserId, {
      pronouns: payload.pronouns,
      heightCm: payload.heightCm,
      bodyType: payload.bodyType,
      hobbies: payload.hobbies,
      boundaries: payload.boundaries,
      mySetup: payload.mySetup,
      availability: payload.availability,
    });

    const intimacySaved = await saveIntimacyProfile(supabaseUserId, intimacy);

    if (!detailsSaved || !intimacySaved) {
      showToast('Profile saved — some new details could not sync yet');
      return true;
    }

    showToast('Profile saved');
    return true;
  };

  const handleSaveProfileOnboarding = async (profile: { displayName: string; handle: string; bio: string; age: number; privacySetting: import('./types').LocationPrivacy; interests: string[] }) => {
    if (!supabaseUserId || !supabase) return false;
    const saved = await updateSupabaseProfile(supabaseUserId, profile);
    if (!saved) return false;
    const { error } = await supabase.auth.updateUser({ data: { display_name: profile.displayName, profile_complete: true } });
    if (error) {
      console.warn('[GAYZE] Profile completion metadata update failed:', error.message);
      return false;
    }
    setCurrentUser((prev) => ({ ...prev, displayName: profile.displayName, handle: profile.handle, bio: profile.bio, privacySetting: profile.privacySetting, interests: profile.interests }));
    setShowProfileOnboarding(false);
    showToast('Profile saved — welcome to GAYZE');
    return true;
  };

  // Calling & Gaze Handlers
  const handleStartCall = (peerName: string, type: 'audio' | 'video', targetUserId?: string, peerAvatar?: string) => {
    // Prime Web Audio inside the user's tap/click. Safari/iOS blocks audio created later by effects.
    primeCallAudio();
    // Live calls must belong to a real mutual conversation. A synthetic room
    // cannot provide a valid signaling context and would leave the call UI stuck.
    if (IS_LIVE_BACKEND) {
      const room = roomsRef.current.find((candidate) =>
        candidate.type === 'direct'
        && candidate.peerUserId === targetUserId
        && /^[0-9a-f-]{36}$/i.test(candidate.id)
      );
      if (!room || !targetUserId) {
        showToast('Calls are available after a mutual conversation is established.');
        return;
      }
      setCallPeerName(peerName);
      setCallPeerAvatar(peerAvatar);
      setCallType(type);
      setCallTargetUserId(targetUserId);
      setActiveRoomId(room.id);
    } else {
      setCallPeerName(peerName);
      setCallPeerAvatar(peerAvatar);
      setCallType(type);
      setCallTargetUserId(targetUserId);
    }
    setIsIncomingCallActive(false);
    setIsCallModalOpen(true);
  };

  const handleAcceptIncomingCall = async (call: IncomingCall) => {
    primeCallAudio();
    setIncomingCall(null);
    setCallPeerName(call.callerName);
    setCallPeerAvatar(undefined); // Will be fetched from profile if needed
    setCallType(call.callType);
    setCallTargetUserId(call.callerId);
    setActiveRoomId(call.conversationId);
    setIsIncomingCallActive(true);
    setIsCallModalOpen(true);
    await webrtcCallService.acceptCall({
      conversationId: call.conversationId,
      callerId: call.callerId,
      userId: supabaseUserId || currentUser.publicKey,
      callType: call.callType,
      callerName: call.callerName,
    });
  };

  const handleDeclineIncomingCall = async (call: IncomingCall) => {
    setIncomingCall(null);
    await webrtcCallService.declineCall({
      conversationId: call.conversationId,
      callerId: call.callerId,
      userId: supabaseUserId || currentUser.publicKey,
      callerName: call.callerName,
    });
    
    // Save missed call record and send notification
    await markCallAsMissed(call.conversationId, call.callerId, call.callType);
    await sendMissedCallNotification(call);
  };

  const handleGazeAtPeer = async (peerName: string, peerId?: string, intentId?: string): Promise<boolean> => {
    triggerVibration([40, 70]);

    if (isSupabaseConfigured && isAuthenticated) {
      const pulse = supabaseRightNowPulses.find((item) => item.peerId === peerId && (!intentId || item.id === `supabase_${intentId}`));
      if (!pulse || !pulse.id.startsWith('supabase_')) {
        showToast('That Gaze could not be linked to a live profile.');
        return false;
      }
      const result = await submitGaze(pulse.peerId, pulse.id.slice('supabase_'.length));
      if (result.sent) {
        showToast(`Gaze sent to ${peerName}`);
      } else {
        showToast('Gaze could not be sent. Try again.');
      }
      return result.sent;
    }

    showToast(`You gave a Gaze to ${peerName}.`);
    return true;
  };

  const handleSubmitInterest = async (pulse: Pulse) => {
    const account = supabaseUserIdRef.current;
    const generation = authGenerationRef.current;
    const request = ++directChatRequestRef.current;
    if (!isSupabaseConfigured || !isAuthenticated || !account || isSigningOutRef.current) {
      return { sent: false, mutual: false, conversation_id: null };
    }

    const isSupabasePulse = pulse.id.startsWith('supabase_');
    const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(pulse.peerId);
    if (!isSupabasePulse || !isUuid) {
      return { sent: false, mutual: false, conversation_id: null };
    }

    const intentId = pulse.id.slice('supabase_'.length);
    const result = await submitInterest(pulse.peerId, intentId);
    if (account !== supabaseUserIdRef.current || generation !== authGenerationRef.current
      || request !== directChatRequestRef.current || isSigningOutRef.current) {
      return { sent: false, mutual: false, conversation_id: null };
    }
    if (result.sent) {
      analytics.logEvent('interest_sent', { intent_mode: pulse.intentMode || 'social' });
    }

    if (result.mutual && result.conversation_id && isConversationId(result.conversation_id)) {
      analytics.logEvent('mutual_interest', { intent_mode: pulse.intentMode || 'social' });
      await handleOpenDirectChatFromPulse(pulse, result.conversation_id);
    } else if (result.sent && !result.mutual) {
      showToast(`Interest sent to ${pulse.peerName}`);
    } else {
      showToast('Could not open this conversation. Please try again.');
    }

    return result;
  };

  const handleSubmitGaze = async (pulse: Pulse) => {
    if (!isSupabaseConfigured) return { sent: false };

    const isSupabasePulse = pulse.id.startsWith('supabase_');
    const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(pulse.peerId);
    if (!isSupabasePulse || !isUuid) return { sent: false };

    const intentId = pulse.id.slice('supabase_'.length);
    return submitGaze(pulse.peerId, intentId);
  };



  /**
   * Publish a new signal, or update the existing one.
   *
   * Live mode writes to Supabase first and only then reflects the result in the
   * UI — if the write fails nothing is pretended to be live. Local/demo mode
   * keeps the signal on the device.
   */
  /**
   * Returns true only after the intent is actually persisted (or stored
   * locally in demo mode). The composer sheet stays open and shows its own
   * error state when this resolves false / rejects — the sheet closes only
   * on success.
   */
  const handleSaveUserIntent = async (intent: UserActiveIntent): Promise<boolean> => {
    hapticSensitiveAction();
    const previous = activeUserIntentRef.current;
    const isFirstPublish = !previous;

    if (!IS_LIVE_BACKEND) {
      setActiveUserIntent(intent);
      showToast(`Status updated: ${intent.intent} (${intent.when})`);
      return true;
    }

    if (!isAuthenticated) {
      // Surface in the sheet itself so the composer never silently closes.
      throw new Error('Sign in to publish a live intent.');
    }

    // No optimistic state write: the open composer derives its draft from
    // `existingIntent`, so mutating activeUserIntent before the backend
    // confirms would reset the user's in-progress selections (and on failure
    // leave them a blank, disabled sheet). State changes only after the write.
    setIntentBusy(true);

    try {
      const location = userLocation ? { lat: userLocation.lat, lng: userLocation.lng } : undefined;
      const sourceUser = currentUserRef.current;
      const saved = await saveActiveIntentWithSession(
        { ...intent, remoteId: previous?.remoteId },
        sourceUser,
        location,
      );
      if (!saved) {
        // Honest failure: nothing is pretended to be live.
        showToast('Could not publish your intent. Nothing was saved.');
        return false;
      }
      setActiveUserIntent((prev) => ({
        ...(prev || intent),
        ...intent,
        remoteId: saved.id,
        expiresAt: saved.expiresAt,
        isPaused: saved.isPaused,
      }));
      await refreshDiscoveryRef.current();
      analytics.logEvent('intent_published', {
        mode: intent.mode,
        intent: intent.intent,
        timing: intent.when,
        privacy: sourceUser.privacySetting,
        safe_haven: Boolean(intent.isNearSafeHaven),
      });
      if (isFirstPublish) {
        // Real story record, authored by the signed-in user. Media stays empty
        // until a storage-backed upload exists.
        void createStoryFromIntent(intent).catch((error) => {
          console.warn('[GAYZE] Story creation failed', error);
        });
      }
      showToast(isFirstPublish ? 'You are live on the map' : 'Intent updated');
      return true;
    } catch (error) {
      console.error('[GAYZE] Failed to persist Right Now intent', error);
      showToast('Could not publish your intent. Nothing was saved.');
      return false;
    } finally {
      setIntentBusy(false);
    }
  };

  /** Pause/resume is a backend state change in live mode, not a local flag. */
  const handleToggleIntentPause = (isPaused: boolean) => {
    const intent = activeUserIntentRef.current;
    if (!intent) return;
    hapticLight();

    if (!IS_LIVE_BACKEND || !intent.remoteId) {
      setActiveUserIntent({ ...intent, isPaused });
      return;
    }

    setActiveUserIntent({ ...intent, isPaused });
    void (async () => {
      const ok = await updateActiveIntentPause(intent.remoteId!, isPaused);
      if (!ok) {
        setActiveUserIntent(intent);
        showToast(`Could not ${isPaused ? 'pause' : 'resume'} your intent. It is unchanged.`);
        return;
      }
      await refreshDiscoveryRef.current();
      showToast(isPaused ? 'Intent paused — hidden from discovery' : 'Intent resumed');
    })();
  };

  /** Ending a signal removes it from the backend and from application state. */
  const handleEndUserIntent = () => {
    const intent = activeUserIntentRef.current;
    if (!intent) return;
    hapticSensitiveAction();

    if (!IS_LIVE_BACKEND) {
      setActiveUserIntent(null);
      showToast('Intent ended');
      return;
    }

    void (async () => {
      const ok = await endActiveIntent(intent.remoteId ?? null);
      if (!ok) {
        showToast('Could not end your intent. It is still live.');
        return;
      }
      setActiveUserIntent(null);
      await refreshDiscoveryRef.current();
      showToast('Intent ended');
    })();
  };

  /**
   * Single entry point used by Right Now and Profile: routes end / pause /
   * edit to the right backend operation and never writes an intent locally in
   * live mode.
   */
  const handleUpdateActiveUserIntent = (next: UserActiveIntent | null) => {
    const current = activeUserIntentRef.current;
    if (!next) {
      handleEndUserIntent();
      return;
    }
    const isPauseToggle = Boolean(current && current.remoteId === next.remoteId
      && Boolean(current.isPaused) !== Boolean(next.isPaused));
    if (isPauseToggle) {
      handleToggleIntentPause(Boolean(next.isPaused));
      return;
    }
    handleSaveUserIntent(next);
  };

  const handleOpenIntentSheet = () => {
    analytics.logEvent('intent_started');
    setIsSetIntentOpen(true);
  };

  // Safety Check-in Handlers — persisted in Supabase when the live backend is enabled.
  const handleStartSafetyTimer = async (data: { partnerName: string; venueName: string; durationMinutes: number; notes: string }) => {
    hapticSensitiveAction();
    const totalSecs = data.durationMinutes * 60;
    if (isSupabaseConfigured && isAuthenticated) {
      const saved = await startSafetyCheckin(data);
      if (!saved) {
        showToast('Unable to save safety check-in. Please try again.');
        return;
      }
      setCheckinState({
        isActive: true,
        meetupPartnerName: data.partnerName,
        venueName: data.venueName,
        startedAt: Date.now(),
        durationMinutes: data.durationMinutes,
        notes: data.notes,
      });
    } else {
      setCheckinState({
        isActive: true,
        meetupPartnerName: data.partnerName,
        venueName: data.venueName,
        startedAt: Date.now(),
        durationMinutes: data.durationMinutes,
        notes: data.notes,
      });
    }
    lastRemainingSecondsRef.current = totalSecs;
    expiredCheckinStartedAtRef.current = null;
    setRemainingSeconds(totalSecs);
    setIsSafetyTimerOpen(false);
    showToast(`Safety check-in started for ${data.durationMinutes} minutes at ${data.venueName}`);
  };

  const handleExtendTimer = async (extraMinutes: number) => {
    hapticSensitiveAction();
    const nextExpiry = Date.now() + extraMinutes * 60 * 1000;
    if (isSupabaseConfigured && isAuthenticated) {
      const active = await loadActiveSafetyCheckin();
      if (!active || !(await updateSafetyCheckin(active.id, { expiresAt: nextExpiry }))) {
        showToast('Unable to extend the safety check-in.');
        return;
      }
    }
    setCheckinState((prev) => ({ ...prev, durationMinutes: prev.durationMinutes + extraMinutes }));
    setRemainingSeconds((prev) => prev + extraMinutes * 60);
    showToast(`Safety check-in extended by ${extraMinutes} minutes.`);
  };

  const handleEndCheckin = async () => {
    hapticSensitiveAction();
    if (isSupabaseConfigured && isAuthenticated) {
      const active = await loadActiveSafetyCheckin();
      if (active) await updateSafetyCheckin(active.id, { status: 'ended' });
    }
    setCheckinState((prev) => ({ ...prev, isActive: false }));
    showToast('Meetup checked in safely. Safety check-in ended.');
  };

  const handleRevokeDevice = async (deviceId: string) => {
    try {
      const revoked = await revokeIdentityDevice(deviceId);
      if (!revoked) throw new Error('Device could not be revoked');
      setIdentityDevices((prev) => prev.map((device) => device.id === deviceId
        ? { ...device, status: 'revoked', revoked_at: new Date().toISOString() }
        : device
      ));
      showToast('Device revoked');
    } catch (error) {
      console.error('[GAYZE] Device revocation failed', error);
      showToast('Unable to revoke device');
    }
  };

  const handleCreateRecovery = async () => {
    const password = window.prompt('Create a recovery passphrase (12+ characters). You will need this on the new device.');
    if (!password) return;
    const confirmation = window.prompt('Confirm your recovery passphrase.');
    if (password !== confirmation) {
      showToast('Recovery passphrases did not match');
      return;
    }

    try {
      const bundle = await createRecoveryBundle(password);
      const textBundle = recoveryBundleToText(bundle);
      const blob = new Blob([textBundle], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = 'gayze-identity-recovery.json';
      anchor.click();
      URL.revokeObjectURL(url);
      showToast('Encrypted identity backup created — keep it somewhere safe');
    } catch (error) {
      console.error('[GAYZE] Recovery backup failed', error);
      showToast('This device identity cannot be exported. A new recovery-ready identity is required.');
    }
  };

  const handleRestoreRecovery = async () => {
    const password = window.prompt('Enter your GAYZE recovery passphrase.');
    if (!password) return;

    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'application/json,.json';
    input.click();

    input.onchange = async () => {
      const file = input.files?.[0];
      if (!file) return;
      try {
        const bundle = parseRecoveryBundle(await file.text());
        await restoreRecoveryBundle(bundle, password);
        clearMessageWork();
        const identity = await getOrCreateDeviceIdentity();
        setCurrentUser((prev) => ({
          ...prev,
          publicKey: identity.fingerprint,
          shortKey: `pk_${identity.fingerprint.slice(3, 11)}...${identity.fingerprint.slice(-4)}`,
        }));
        if (isSupabaseConfigured && supabaseUserId) {
          await ensureSupabaseProfile(supabaseUserId, {
            ...currentUser,
            publicKey: identity.fingerprint,
            shortKey: `pk_${identity.fingerprint.slice(3, 11)}...${identity.fingerprint.slice(-4)}`,
          }, identity.publicKeyJwkString);
        }
        showToast('Identity restored on this device');
      } catch (error) {
        console.error('[GAYZE] Identity restore failed', error);
        showToast('Recovery failed — check the backup and passphrase');
      }
    };
  };

  const handlePurgeLocalCache = () => {
    hapticSensitiveAction();
    localStorage.removeItem('gayze_messages');
    clearMessageWork();
    setMessages({});
    showToast('Decrypted message cache cleared on this device.');
  };

  // The room lights up with a violet breath when real activity exists — either
  // your own live signal or genuine intents nearby. Demo fixtures only count
  // when Supabase is not configured (they are the local prototype's data).
  const liveNearbyCount = isSupabaseConfigured && isAuthenticated
    ? supabaseRightNowPulses.length
    : pulses.length;
  const hasLiveAtmosphere = Boolean(activeUserIntent && !activeUserIntent.isPaused) || liveNearbyCount > 0;

  if (showStartup) return <GayzeLoadingScreen mode="startup" />;

  // If Discreet Mask is triggered, render pure camouflage
  if (isMaskActive) {
    return <DiscreetMaskView onExitMask={() => setIsMaskActive(false)} />;
  }

  if (isSupabaseConfigured && (!authReady || !isAuthenticated)) {
    if (!authReady) return <GayzeLoadingScreen mode="startup" />;
    return <AuthView onAuthenticated={() => setIsAuthenticated(true)} />;
  }

  return (
    <div className="h-[100dvh] max-h-[100dvh] overflow-hidden bg-[#090a0f] text-[#f1f3f7] flex flex-col font-sans selection:bg-[#C9A24D]/25 selection:text-[#C9A24D]">
      {/* Atmosphere: one obsidian room lit by violet, above which all chrome sits. */}
      <div
        className={`g-atmos${hasLiveAtmosphere ? ' g-atmos--live' : ''}`}
        aria-hidden="true"
      />

      {/* Toast Notification */}
      {notificationToast && (
        <div className="g-toast">
          <Shield className="w-4 h-4 text-[#C9A24D] shrink-0" />
          <span className="flex-1 truncate font-semibold">{notificationToast}</span>
        </div>
      )}

      {locationError && (
        <div className="g-float fixed top-[calc(env(safe-area-inset-top,0px)+62px)] md:top-[calc(env(safe-area-inset-top,0px)+124px)] left-3 right-[66px] md:right-auto md:w-80 z-40 rounded-[14px] px-3.5 py-2.5 text-[11.5px] text-zinc-300 leading-snug">
          <span className="text-amber-300 font-semibold">Live location unavailable.</span>{' '}
          {locationError}
        </div>
      )}

      {/* Shell: navigation + views, above the atmosphere layer */}
      <div className="g-shell flex flex-1 min-h-0 flex-col">
      {/* Navigation — five destinations (desktop top bar + mobile tab bar) */}
      <Navbar
        activeTab={activeTab}
        onTabChange={(tab) => { if (tab === 'swarms') beginChatTrace(activeRoomId); setActiveTab(tab); }}
        unreadCount={unreadMessageCount}
        notificationCount={notificationInbox?.unread ?? 0}
        onOpenMask={() => setIsMaskActive(true)}
        onOpenIdentity={() => setIsIdentityOpen(true)}
        onOpenSafetyTimer={() => setIsSafetyTimerOpen(true)}
        isSafetyTimerActive={checkinState.isActive}
        onOpenQR={() => handleOpenQRModal()}
        reliabilityScore={currentUser.reliabilityScore}
        userNeighborhood={currentUser.neighborhood}
      />

      {/* Main Content Viewport Container */}
      <main
        className={
          activeTab === 'right_now'
            ? 'fixed left-0 right-0 top-0 bottom-[calc(var(--g-tabbar-h)+env(safe-area-inset-bottom,0px))] md:top-[calc(3.5rem+env(safe-area-inset-top,0px))] overflow-hidden overscroll-none p-0'
            : activeTab === 'swarms' ? 'g-chat-viewport' : 'flex-1 min-h-0 max-w-5xl w-full mx-auto px-4 sm:px-6 pt-[calc(1rem+env(safe-area-inset-top,0px))] md:pt-[calc(3.5rem+env(safe-area-inset-top,0px)+1rem)] pb-[calc(4.5rem+env(safe-area-inset-bottom,0px))] md:pb-10 overflow-y-auto overscroll-contain'
        }
      >
        <Suspense fallback={<div className="flex h-full min-h-[40vh] items-center justify-center text-xs text-zinc-400">Loading view…</div>}>
          {activeTab === 'dating' && (
            <DiscoverView
              // In live mode every row is a real active intent (the pulses carry
              // identity, intent, area, distance and availability). Demo photo
              // profiles are only used when Supabase is not configured.
              profiles={isSupabaseConfigured && isAuthenticated ? [] : datingProfiles}
              pulses={isSupabaseConfigured && isAuthenticated ? supabaseRightNowPulses : pulses}
              safeHavens={safeHavens}
              userNeighborhood={currentUser.neighborhood}
              activeUserIntent={activeUserIntent}
              currentUser={currentUser}
              onOpenDirectChat={handleOpenDirectChatFromPulse}
              onOpenDirectChatWithProfile={handleOpenDirectChatWithProfile}
              onGazeAtPeer={handleGazeAtPeer}
              onOpenScheduleMeeting={handleOpenScheduleMeeting}
              onOpenQRWithPeer={(profile) => handleOpenQRModal(profile)}
              onOpenSetIntent={handleOpenIntentSheet}
              onOpenMap={() => setActiveTab('right_now')}
              onOpenProfileEdit={(section) => {
                setIsProfileEditOpen(true);
                setProfileEditSection(section ? section as EditSectionKey : null);
              }}
              onOpenPublicProfile={(userId, fallback) => {
                setViewingPublicProfile({ userId, ...fallback });
              }}
            />
          )}

          {activeTab === 'profile' && (
            <ProfileView
              currentUser={currentUser}
              activeUserIntent={activeUserIntent}
              areaLabel={resolveAreaLabel(currentUser.neighborhood)}
              onOpenSetIntent={handleOpenIntentSheet}
              onUpdateActiveUserIntent={handleUpdateActiveUserIntent}
              intentBusy={intentBusy}
              onOpenSafetyTimer={() => setIsSafetyTimerOpen(true)}
              isSafetyTimerActive={checkinState.isActive}
              onOpenMask={() => setIsMaskActive(true)}
              onOpenIdentity={() => setIsIdentityOpen(true)}
              onSignOut={handleSignOut}
              signingOut={isSigningOut}
              onOpenQR={() => handleOpenQRModal()}
              onOpenSafeHavens={() => setActiveTab('safe_havens')}
              onOpenDiscover={() => setActiveTab('dating')}
              onOpenProfileEdit={(section) => {
                setIsProfileEditOpen(true);
                setProfileEditSection(section ? section as EditSectionKey : null);
              }}
              onOpenNotifications={() => setIsNotificationsOpen(true)}
            />
          )}

          {activeTab === 'right_now' && (
            <RightNowView
              pulses={isSupabaseConfigured && isAuthenticated
                ? supabaseRightNowPulses
                : pulses}
              safeHavens={safeHavens}
              userNeighborhood={currentUser.neighborhood}
              privacySetting={currentUser.privacySetting}
              userLocation={userLocation}
              userAvatarUrl={currentUser.avatarUrl}
              // Live discovery rows already carry the person's real
              // (privacy-jittered) coordinates. Derived photo-grid profiles are
              // demo-only data and are never mixed into the live map.
              datingProfiles={isSupabaseConfigured && isAuthenticated ? [] : datingProfiles}
              activeUserIntent={activeUserIntent}
              intentBusy={intentBusy}
              onOpenDirectChat={handleOpenDirectChatFromPulse}
              onOpenDirectChatWithProfile={handleOpenDirectChatWithProfile}
              onSelectHaven={() => {
                setActiveTab('safe_havens');
              }}
              onGazeAtPeer={handleGazeAtPeer}
              onOpenScheduleMeeting={handleOpenScheduleMeeting}
              onOpenSetIntent={handleOpenIntentSheet}
              onSubmitInterest={handleSubmitInterest}
              onSubmitGaze={handleSubmitGaze}
              onSwitchToLater={() => setActiveTab('later')}
              onRequestLocation={requestUserLocation}
              onMaxDistanceKmChange={(km) => setTravelDistanceKm(clampTravelDistanceKm(km))}
              onUpdateActiveUserIntent={handleUpdateActiveUserIntent}
            />
          )}

          {activeTab === 'later' && (
            <LaterView
              gatherings={gatherings}
              onToggleRsvp={handleToggleRsvp}
              onOpenGatheringChat={handleOpenGatheringChat}
              onCreateGathering={handleCreateGathering}
              currentUser={currentUser}
              activeIntentMode={activeUserIntent?.mode}
              currentUserId={supabaseUserId}
              userLocation={userLocation}
            />
          )}

          {activeTab === 'swarms' && (
            <ChatRoomView
              rooms={rooms}
              messages={messages}
              activeRoomId={activeRoomId}
              openRequest={chatOpenRequest}
              onVisibleRoomChange={reportVisibleChatRoom}
              onSelectRoom={requestConversationOpen}
              currentUser={currentUser}
              currentUserId={supabaseUserId}
              onSendMessage={handleSendMessage}
              onUpdateRoomTtl={handleUpdateRoomTtl}
              onDeleteChat={IS_LIVE_BACKEND ? handleDeleteChat : undefined}
              onDeleteMessage={IS_LIVE_BACKEND ? handleDeleteMessageForMe : undefined}
              onUnsendMessage={IS_LIVE_BACKEND ? handleUnsendMessage : undefined}
              onSetMessageExpiry={IS_LIVE_BACKEND ? handleSetMessageExpiry : undefined}
              onOpenQR={(peerName) => {
                const matchedPeer = datingProfiles.find(
                  (p) => p.name.toLowerCase() === peerName?.toLowerCase()
                );
                handleOpenQRModal(matchedPeer || null);
              }}
              onStartCall={handleStartCall}
              onOpenScheduleMeeting={handleOpenScheduleMeeting}
              onAcceptMeeting={handleAcceptMeeting}
              onReturnToDiscovery={() => setActiveTab('right_now')}
              onlineUserIds={onlineUserIds}
              connectionState={IS_LIVE_BACKEND ? (activeRoomId ? (chatConnection.roomId === activeRoomId ? chatConnection.state : 'connecting') : inboxConnection) : undefined}
              conversationKeyUnavailable={
                Boolean(activeRoomId)
                && conversationKeyState.roomId === activeRoomId
                && conversationKeyState.status === 'unavailable'
              }
              conversationKeyReason={conversationKeyState.reason}
            />
          )}

          {activeTab === 'safe_havens' && (
            <SafeHavenView
              safeHavens={safeHavens}
              onBack={() => setActiveTab('profile')}
              onSelectVenueForPulse={(haven) => {
                setActiveTab('right_now');
                showToast(`Broadcasting pulse at ${haven.name}`);
              }}
              onStartSafeCheckinWithVenue={(haven) => {
                setIsSafetyTimerOpen(true);
              }}
            />
          )}
        </Suspense>
      </main>

      {showProfileOnboarding && supabaseUserId && (
        <ProfileOnboarding currentUser={currentUser} onSave={handleSaveProfileOnboarding} />
      )}

      {/* Schedule Meeting & Safe Haven Date Modal */}
      <ScheduleMeetingModal
        isOpen={isScheduleMeetingOpen}
        onClose={() => setIsScheduleMeetingOpen(false)}
        peerName={scheduleMeetingPeerName}
        safeHavens={safeHavens}
        onConfirmMeeting={handleConfirmMeeting}
      />

      {/* Full Screen Video Call Modal */}
      {callType === 'video' && (
        <FullScreenCallModal
          isOpen={isCallModalOpen}
          onClose={() => {
            setIsCallModalOpen(false);
            setIsIncomingCallActive(false);
          }}
          peerName={callPeerName}
          peerAvatar={callPeerAvatar}
          callType={callType}
          conversationId={activeRoomId}
          callerId={supabaseUserId || currentUser.publicKey}
          callerName={currentUser.displayName}
          targetUserId={callTargetUserId}
          isIncoming={isIncomingCallActive}
        />
      )}
      
      {/* Full Screen Audio Call Modal */}
      {callType === 'audio' && (
        <FullScreenAudioCallModal
          isOpen={isCallModalOpen}
          onClose={() => {
            setIsCallModalOpen(false);
            setIsIncomingCallActive(false);
          }}
          peerName={callPeerName}
          peerAvatar={callPeerAvatar}
          callType={callType}
          conversationId={activeRoomId}
          callerId={supabaseUserId || currentUser.publicKey}
          callerName={currentUser.displayName}
          targetUserId={callTargetUserId}
          isIncoming={isIncomingCallActive}
        />
      )}

      {/* Incoming Call Notification Modal */}
      <IncomingCallModal
        incomingCall={incomingCall}
        onAccept={handleAcceptIncomingCall}
        onDecline={handleDeclineIncomingCall}
      />

      {/* Universal Set Intent Sheet */}
      <SetIntentSheet
        isOpen={isSetIntentOpen}
        onClose={() => setIsSetIntentOpen(false)}
        onSaveIntent={handleSaveUserIntent}
        existingIntent={activeUserIntent}
        safeHavens={safeHavens}
        userNeighborhood={currentUser.neighborhood}
      />

      {/* Sectioned "About you" profile editor */}
      {isProfileEditOpen && (
        <Suspense fallback={null}>
          <ProfileEditSheet
            isOpen={isProfileEditOpen}
            currentUser={currentUser}
            hasPhoto={Boolean(currentUser.avatarUrl)}
            onClose={() => {
              setProfileEditSection(null);
              setIsProfileEditOpen(false);
            }}
            onSave={handleSaveProfileEdit}
            initialSection={profileEditSection}
            onOpenIdentity={() => setIsIdentityOpen(true)}
            onOpenSetIntent={handleOpenIntentSheet}
          />
        </Suspense>
      )}

      {/* Public Profile View Sheet */}
      {viewingPublicProfile && (
        <Suspense fallback={null}>
          <PublicProfileSheet
            userId={viewingPublicProfile.userId}
            fallbackName={viewingPublicProfile.fallbackName}
            fallbackAge={viewingPublicProfile.fallbackAge}
            fallbackArea={viewingPublicProfile.fallbackArea}
            fallbackIntent={viewingPublicProfile.fallbackIntent}
            fallbackPhotoUrl={viewingPublicProfile.fallbackPhotoUrl}
            fallbackOnline={viewingPublicProfile.fallbackOnline}
            onClose={() => setViewingPublicProfile(null)}
            onMessage={() => {
              const peerId = viewingPublicProfile.userId;
              setViewingPublicProfile(null);
              if (peerId) {
                const targetRoom = rooms.find(
                  (r) => r.peerUserId === peerId || r.id === `room_${peerId}` || r.id.includes(peerId)
                );
                if (targetRoom) {
                  requestConversationOpen(targetRoom.id);
                  setActiveTab('swarms');
                }
              }
            }}
          />
        </Suspense>
      )}

      {/* Local Safety Check-in Timer Modal */}
      <SafetyTimerModal
        isOpen={isSafetyTimerOpen}
        onClose={() => setIsSafetyTimerOpen(false)}
        checkinState={checkinState}
        onStartTimer={handleStartSafetyTimer}
        onExtendTimer={handleExtendTimer}
        onEndCheckin={handleEndCheckin}
        remainingSeconds={remainingSeconds}
      />

      {/* Web Push opt-in, category preferences and device state */}
      <NotificationsModal key={supabaseUserId || 'signed-out'}
        currentUserId={supabaseUserId}
        isOpen={isNotificationsOpen}
        inbox={notificationInbox}
        inboxStatus={notificationInboxStatus}
        onOpenNotification={openInboxNotification}
        onClose={() => setIsNotificationsOpen(false)}
      />

      {/* iOS Home Screen install nudge (self-hiding, dismissal-aware) */}
      <InstallPrompt />

      {/* Cryptographic Swarm Identity & Privacy Modal */}
      <IdentityModal
        isOpen={isIdentityOpen}
        onClose={() => setIsIdentityOpen(false)}
        user={currentUser}
        onUpdateUser={(updated) => {
          setCurrentUser((prev) => ({ ...prev, ...updated }));
          if (isSupabaseConfigured && supabaseUserId) {
            void ensureSupabaseProfile(
              supabaseUserId,
              { ...currentUser, ...updated },
              updated.publicKey || currentUser.publicKey,
            );
          }
        }}
        onPurgeLocalCache={handlePurgeLocalCache}
        onOpenQR={() => handleOpenQRModal()}
        onCreateRecovery={handleCreateRecovery}
        onRestoreRecovery={handleRestoreRecovery}
        devices={identityDevices}
        currentDeviceFingerprint={currentDeviceFingerprint}
        onRevokeDevice={handleRevokeDevice}
        signingOut={isSigningOut}
        onSignOut={handleSignOut}
      />
      </div>{/* /g-shell */}

      {/* Swarm QR Code Generator & Peer Key Exchange Modal */}
      <Suspense fallback={null}>
        <SwarmQRModal
          isOpen={isQRModalOpen}
          onClose={() => {
            setIsQRModalOpen(false);
            setQrTargetPeer(null);
          }}
          currentUser={currentUser}
          targetPeer={qrTargetPeer}
          onVerifyPeer={handleVerifyPeer}
        />
      </Suspense>
    </div>
  );
}
