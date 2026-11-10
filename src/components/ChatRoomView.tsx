import { PeerIntentBanner } from './PeerIntentBanner';
import { SharePlaceSheet } from './SharePlaceSheet';
import { MeetupCard, type MeetupAction } from './MeetupCard';
import { CallLineCard } from './CallLineCard';
import { NoteRecorder } from './NoteRecorder';
import { AlbumCard, AlbumPickerSheet } from './AlbumShareUI';
import { createShare, linkShareMessage, revokeShare } from '../services/albumService';
import { presenceLabel } from '../services/presenceLabel';
import { compressImageDataUrl } from '../services/imageCompress';
import { latestMeetups } from '../services/meetupState';
import { peekTapProps, useProfilePeek } from './ProfilePeek';
import { SwipeRow } from './SwipeRow';
import { readAutoRekeyAttempt } from '../services/autoRekey';
import { fetchArchivedChats, pushArchivedChats, reconcileArchive } from '../services/chatArchive';
import { GroupMembersSheet, formatEventWhen, type GroupMember, type GroupEventInfo } from './GroupMembersSheet';
import { beginChatTrace, traceChat, countChatWork } from '../services/chatTrace';
import type { ChatConnectionState } from '../services/realtimeRecovery';
import React, { useState, useEffect, useLayoutEffect, useMemo, useRef } from 'react';
import { SwarmRoom, EncryptedMessage, UserProfile, MeetingProposal, TopLevelIntentMode, VoiceNote, AlbumShare } from '../types';
import { loadOutbox } from '../services/outbox';
import { hapticMessageDecrypted, hapticLight, hapticSensitiveAction, hapticMessageSent } from '../services/hapticService';
import { playAppSound, FRESH_MESSAGE_MS } from '../services/appSounds';
import {
  Lock,
  ShieldCheck,
  Send,
  Clock,
  Flame,
  Key,
  KeyRound,
  CalendarX,
  MessageCircle,
  CalendarCheck,
  EyeOff,
  Archive,
  ArchiveRestore,
  ChevronDown,
  Check,
  ChevronLeft,
  Users,
  User,
  Sparkles,
  CheckCheck,
  Eye,
  X,
  Shield,
  QrCode,
  Award,
  Phone,
  Video,
  Calendar,
  MapPin,
  Coffee,
  Image as ImageIcon,
  Images,
  MoreHorizontal,
  Trash2,
  Ban,
  Flag,
  Navigation,
} from 'lucide-react';
import { preparePhotoAttachment } from '../services/supabaseService';
import { supabase } from '../services/supabaseClient';
import { getProfilePhotoUrl } from '../services/profilePhotoService';
import { PhotoStudio } from './PhotoStudio';
import { buildChatTimeline, roomActivityAt } from '../services/chatTimeline';
import { usePeersLiveIntents, timeLeftLabel } from '../services/peerLiveIntents';
import { intentDisplayLabel } from '../services/intentLabels';

interface ChatRoomViewProps {
  rooms: SwarmRoom[];
  /** Persisted Gayze notification events, rendered as system entries in the matching chat. */
  gayzeEvents?: Array<{ id: string; actorId: string; createdAt: string }>;
  messages: Record<string, EncryptedMessage[]>;
  activeRoomId: string;
  openRequest?: { roomId: string; sequence: number } | null;
  onVisibleRoomChange?: (roomId: string | null) => void;
  onSelectRoom: (roomId: string) => void;
  currentUser: UserProfile;
  /** Authenticated Supabase user id; live message sender_id values use this, not the device public-key fingerprint. */
  currentUserId?: string | null;
  onSendMessage: (roomId: string, plainText: string, ephemeralTtlSeconds?: number, meetingData?: MeetingProposal, mediaUrl?: string, messageId?: string) => Promise<void | 'queued'>;
  /** Sends a recorded voice message or video note. */
  onSendNote?: (roomId: string, note: VoiceNote) => Promise<void>;
  /** Send a private album into this chat. Resolves once the message is stored. */
  onSendAlbum?: (roomId: string, share: AlbumShare, messageId: string) => Promise<void>;
  onUpdateRoomTtl: (roomId: string, ttl: number) => void;
  /** Removes only the current user's membership; resolves once the backend confirms. */
  onDeleteChat?: (roomId: string) => Promise<void>;
  onDeleteMessage?: (messageId: string) => Promise<void>;
  onUnsendMessage?: (messageId: string) => Promise<void>;
  onSetMessageExpiry?: (messageId: string, ttlSeconds: number | null) => Promise<void>;
  onOpenQR?: (peerName?: string) => void;
  onStartCall?: (peerName: string, callType: 'audio' | 'video', targetUserId?: string, peerAvatar?: string) => void;
  onOpenScheduleMeeting?: (peerName: string) => void;
  /** Open the "I'm on my way" sheet for this chat. */
  onOpenJourney?: (roomId: string, peerName: string) => void;
  userLocation?: { lat: number; lng: number } | null;
  journeyRoomId?: string | null;
  onMeetingAction?: (action: MeetupAction, meeting: MeetingProposal) => void;
  onReturnToDiscovery?: () => void;
  onlineUserIds?: Set<string>;
  /** Gatherings the host has cancelled; their group chats get a Cancelled mark and can be archived. */
  cancelledGatheringIds?: Set<string>;
  /** Gatherings that have already happened (the start time plus a few hours has passed). */
  finishedGatheringIds?: Set<string>;
  /** What the group chats are for: event time, place and host, keyed by gathering id. */
  groupEvents?: Record<string, GroupEventInfo & { hostId?: string }>;
  /** Start or open a private chat with a member of an event group (sends a chat request if there is none yet). */
  onMessageMember?: (userId: string, name: string) => void;
  connectionState?: ChatConnectionState;
  /** True when no conversation key could be resolved on this device. */
  conversationKeyUnavailable?: boolean;
  conversationKeyReason?: string;
  onRetrySecureChat?: () => void;
  conversationKeyCanRekey?: boolean;
  onStartFreshSecureSession?: () => void;
  onBlockPeer?: (peerId: string, peerName: string) => void;
  onReportPeer?: (peerId: string, peerName: string, conversationId: string) => void;
  /** Current GAYZE mode controls the live chat border hue. */
  activeIntentMode?: TopLevelIntentMode;
}

/** Chat-list timestamp: the time today, "Yesterday", the weekday this week, else the date. */
const formatListTime = (timestamp: number): string => {
  const date = new Date(timestamp);
  if (!Number.isFinite(date.getTime())) return '';
  const now = new Date();
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  if (timestamp >= startOfToday) return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  if (timestamp >= startOfToday - 86_400_000) return 'Yesterday';
  if (timestamp >= startOfToday - 6 * 86_400_000) return date.toLocaleDateString([], { weekday: 'short' });
  return date.toLocaleDateString([], { day: 'numeric', month: 'short' });
};

const avatarHue = (name: string): number => {
  let h = 0;
  for (let i = 0; i < name.length; i += 1) h = (h * 31 + name.charCodeAt(i)) % 360;
  return 250 + (h % 80); // violet to magenta, so initials tiles stay on-brand but differ
};

export const ChatRoomView: React.FC<ChatRoomViewProps> = ({
  rooms,
  gayzeEvents = [],
  messages,
  activeRoomId,
  openRequest,
  onVisibleRoomChange,
  onSelectRoom,
  currentUser,
  currentUserId,
  onSendMessage,
  onUpdateRoomTtl,
  onSendNote,
  onSendAlbum,
  onDeleteChat,
  onDeleteMessage,
  onUnsendMessage,
  onSetMessageExpiry,
  onOpenQR,
  onStartCall,
  onOpenScheduleMeeting,
  onOpenJourney,
  userLocation,
  journeyRoomId,
  onMeetingAction,
  onReturnToDiscovery,
  onlineUserIds,
  cancelledGatheringIds,
  finishedGatheringIds,
  groupEvents,
  onMessageMember,
  connectionState,
  conversationKeyUnavailable = false,
  conversationKeyReason,
  onRetrySecureChat,
  conversationKeyCanRekey = false,
  onStartFreshSecureSession,
  onBlockPeer,
  onReportPeer,
  activeIntentMode,
}) => {
  const openPeek = useProfilePeek();
  const [now, setNow] = useState(Date.now);
  useEffect(() => {
    const tick = window.setInterval(() => setNow(Date.now()), 1000);
    const viewport = window.visualViewport;
    const resize = () => {
      document.documentElement.style.setProperty('--g-visual-height', `${viewport?.height ?? window.innerHeight}px`);
      document.documentElement.style.setProperty('--g-visual-top', `${viewport?.offsetTop ?? 0}px`);
    };
    resize();
    viewport?.addEventListener('resize', resize);
    viewport?.addEventListener('scroll', resize);
    window.addEventListener('resize', resize);
    return () => {
      window.clearInterval(tick);
      viewport?.removeEventListener('resize', resize);
      viewport?.removeEventListener('scroll', resize);
      window.removeEventListener('resize', resize);
      document.documentElement.style.removeProperty('--g-visual-height');
      document.documentElement.style.removeProperty('--g-visual-top');
    };
  }, []);
  const [inputText, setInputText] = useState('');
  const pendingSends = useRef(new Map<string, string>());
  const [optimisticMessages, setOptimisticMessages] = useState<EncryptedMessage[]>([]);
  const [sendError, setSendError] = useState<string | null>(null);
  const [isSafetyModalOpen, setIsSafetyModalOpen] = useState(false);
  const [inspectedMessageId, setInspectedMessageId] = useState<string | null>(null);
  const [attachedMedia, setAttachedMedia] = useState<string | null>(null);
  const [photoStudioSource, setPhotoStudioSource] = useState<string | null>(null);
  const [messageActionId, setMessageActionId] = useState<string | null>(null);
  const [zoomedMediaUrl, setZoomedMediaUrl] = useState<string | null>(null);
  // Photos other people send are hidden until you choose to look.
  const [revealedPhotos, setRevealedPhotos] = useState<Set<string>>(new Set());
  const [noteRecorder, setNoteRecorder] = useState<{ kind: 'audio' | 'video' } | null>(null);
  const [showAlbumPicker, setShowAlbumPicker] = useState(false);
  const [showChatActions, setShowChatActions] = useState(false);
  const [showMembers, setShowMembers] = useState(false);
  const [swipeOpenId, setSwipeOpenId] = useState<string | null>(null);
  const [memberFocus, setMemberFocus] = useState<string | null>(null);
  const [showSharePlace, setShowSharePlace] = useState(false);
  const [confirmDeleteRoomId, setConfirmDeleteRoomId] = useState<string | null>(null);
  const [isDeletingChat, setIsDeletingChat] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const deleteDialogRef = useRef<HTMLDivElement | null>(null);
  const isDeletingRef = useRef(false);
  isDeletingRef.current = isDeletingChat;

  // Delete dialog: focus moves in, Tab is trapped, Escape cancels (unless busy),
  // and focus returns to whatever opened it.
  useEffect(() => {
    if (!confirmDeleteRoomId) return;
    const opener = document.activeElement as HTMLElement | null;
    const dialog = deleteDialogRef.current;
    const focusable = () => Array.from(dialog?.querySelectorAll<HTMLElement>('button:not([disabled])') ?? []);
    focusable()[0]?.focus();
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        if (!isDeletingRef.current) { event.preventDefault(); setConfirmDeleteRoomId(null); }
        return;
      }
      if (event.key !== 'Tab') return;
      const items = focusable();
      if (!items.length) { event.preventDefault(); return; }
      const first = items[0];
      const last = items[items.length - 1];
      const active = document.activeElement as HTMLElement | null;
      if (!dialog?.contains(active)) { event.preventDefault(); first.focus(); }
      else if (event.shiftKey && active === first) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && active === last) { event.preventDefault(); first.focus(); }
    };
    document.addEventListener('keydown', onKeyDown);
    return () => { document.removeEventListener('keydown', onKeyDown); opener?.focus?.(); };
  }, [confirmDeleteRoomId]);
  const [avatarUrls, setAvatarUrls] = useState<Record<string, string>>({});
  const avatarUrlsRef = useRef(avatarUrls);
  avatarUrlsRef.current = avatarUrls;

  useEffect(() => {
    let active = true;
    const toResolve = [...new Set(rooms
      .map((r) => r.peerAvatar)
      .filter((a): a is string => Boolean(a && a !== 'user' && !a.startsWith('http') && !avatarUrlsRef.current[a])))];

    if (!toResolve.length) return;

    void Promise.all(
      toResolve.map(async (path) => ({
        path,
        url: await getProfilePhotoUrl(path),
      }))
    ).then((items) => {
      if (!active) return;
      setAvatarUrls((prev) => {
        const next = { ...prev };
        for (const item of items) {
          if (item.url) next[item.path] = item.url;
        }
        return next;
      });
    });

    return () => {
      active = false;
    };
  }, [rooms]);
  // Local trust decisions only: a room is marked verified when the user
  // compares the real safety code out-of-band. Nothing is pre-verified and
  // nothing is asserted about a peer the user has not confirmed.
  const [isPeerVerified, setIsPeerVerified] = useState<Record<string, boolean>>(() => {
    try {
      const stored = localStorage.getItem('gayze_verified_rooms');
      return stored ? (JSON.parse(stored) as Record<string, boolean>) : {};
    } catch {
      return {};
    }
  });

  useEffect(() => {
    try {
      localStorage.setItem('gayze_verified_rooms', JSON.stringify(isPeerVerified));
    } catch {
      /* storage unavailable — verification simply won't survive a reload */
    }
  }, [isPeerVerified]);
  // Mobile responsive view: 'list' | 'chat'
  const [mobileView, setMobileView] = useState<'list' | 'chat'>(() => activeRoomId ? 'chat' : 'list');
  const [wideLayout, setWideLayout] = useState(() => window.matchMedia?.('(min-width: 640px)').matches ?? window.innerWidth >= 640);
  useLayoutEffect(() => {
    if (activeRoomId) setMobileView('chat');
  }, [activeRoomId, openRequest?.sequence]);
  useEffect(() => {
    const media = window.matchMedia?.('(min-width: 640px)');
    const change = () => setWideLayout(media?.matches ?? window.innerWidth >= 640);
    change();
    if (!media) {
      window.addEventListener('resize', change);
      return () => window.removeEventListener('resize', change);
    }
    if (media.addEventListener) {
      media.addEventListener('change', change);
      return () => media.removeEventListener('change', change);
    }
    media.addListener(change);
    return () => media.removeListener(change);
  }, []);

  const messagesEndRef = useRef<HTMLDivElement | null>(null);
  const overlayRef = useRef<HTMLDivElement | null>(null);
  const [overlayHeight, setOverlayHeight] = useState(0);
  // An explicit target may still be hydrating: never show/send to another peer.
  const currentRoom = activeRoomId ? rooms.find((r) => r.id === activeRoomId) : undefined;
  const visibleRoomId = currentRoom && (wideLayout || mobileView === 'chat') ? currentRoom.id : null;
  useLayoutEffect(() => {
    onVisibleRoomChange?.(visibleRoomId);
    return () => onVisibleRoomChange?.(null);
  }, [visibleRoomId, onVisibleRoomChange]);
  const currentMessages = useMemo(() => {
    const persisted = messages[currentRoom?.id || ''] || [];
    const pending = optimisticMessages.filter((message) => message.roomId === currentRoom?.id);
    const persistedIds = new Set(persisted.map((message) => message.id));
    const merged = [...persisted, ...pending.filter((message) => !persistedIds.has(message.id))];
    return merged
      .filter((message) => !message.deletedForMe && (!message.isBurned || message.deletedForEveryone) && (!message.expiresAt || message.expiresAt > now))
      .sort((a, b) => a.timestamp - b.timestamp);
  }, [messages, optimisticMessages, currentRoom?.id, now]);

  // Messages waiting for a connection: show them after a reload too (text is not stored, so a placeholder), and follow
  // the outcome when the connection returns.
  useEffect(() => {
    if (!currentUserId) return;
    const showQueued = () => {
      const queued = loadOutbox(localStorage, currentUserId);
      setOptimisticMessages((prev) => {
        const have = new Set(prev.map((m) => m.id));
        const extra = queued.filter((q) => !have.has(q.id)).map((q): EncryptedMessage => ({
          id: q.id, roomId: q.roomId, senderKey: currentUserId, senderName: 'You', timestamp: q.createdAt, cipherText: '', nonceHex: '',
          plainText: 'Waiting to send…', ephemeralTtlSeconds: 0, sendState: 'queued',
        }));
        return extra.length ? [...prev, ...extra] : prev;
      });
    };
    const onResult = (event: Event) => {
      const r = (event as CustomEvent<{ sent: string[]; failed: string[]; expired: string[] }>).detail;
      if (!r) return;
      const gone = new Set(r.expired);
      const failed = new Set(r.failed);
      const sent = new Set(r.sent);
      setOptimisticMessages((prev) => prev
        .filter((m) => !gone.has(m.id))
        .map((m) => failed.has(m.id) ? { ...m, sendState: 'failed' as const } : sent.has(m.id) ? { ...m, sendState: 'sent' as const } : m));
    };
    showQueued();
    window.addEventListener('gayze:outbox-changed', showQueued);
    window.addEventListener('gayze:outbox-result', onResult);
    return () => { window.removeEventListener('gayze:outbox-changed', showQueued); window.removeEventListener('gayze:outbox-result', onResult); };
  }, [currentUserId]);

  // Once the authoritative database row arrives, remove its local optimistic twin.
  useEffect(() => {
    if (!optimisticMessages.length) return;
    const persistedIds = new Set((messages[activeRoomId] || []).map((message) => message.id));
    setOptimisticMessages((prev) => prev.filter((message) => !persistedIds.has(message.id)));
  }, [messages, activeRoomId, optimisticMessages.length]);
  const [historyWindow, setHistoryWindow] = useState({ roomId: activeRoomId, count: 100 });
  const visibleCount = historyWindow.roomId === activeRoomId ? historyWindow.count : 100;
  const visibleMessages = currentMessages.slice(-visibleCount);
  // The latest state of every meetup in this chat, and who first proposed it. Cards for older messages collapse.
  const meetups = useMemo(
    () => latestMeetups(currentMessages, (m) => (currentUserId ? m.senderKey === currentUserId : m.senderKey === currentUser.publicKey)),
    [currentMessages, currentUserId, currentUser.publicKey],
  );
  const lastCallMsgId = useMemo(() => [...currentMessages].reverse().find((m) => m.callData)?.id, [currentMessages]);
  const roomGayzes = useMemo(() => gayzeEvents.filter((event) => currentRoom?.type === 'direct' && (
    event.actorId === currentRoom.peerUserId
    || Boolean(currentRoom.memberIds?.includes(event.actorId) && currentRoom.memberIds?.includes(currentUserId ?? ''))
  )), [gayzeEvents, currentRoom?.type, currentRoom?.peerUserId, currentRoom?.memberIds, currentUserId]);
  const timeline = useMemo(
    () => buildChatTimeline(visibleMessages, roomGayzes, currentMessages.length > visibleCount),
    [visibleMessages, roomGayzes, currentMessages.length, visibleCount],
  );
  // A run of messages this device has no key for collapses into one note instead of a wall of "can't decrypt" bubbles.
  // Several unanswered calls in a row from the same person read as one line ("Missed call ×3"), on the newest one.
  const callRuns = useMemo(() => {
    const info = new Map<string, { hidden: boolean; count: number }>();
    const flush = (run: string[]) => { run.forEach((key, i) => info.set(key, { hidden: i < run.length - 1, count: i === run.length - 1 ? run.length : 1 })); };
    let run: string[] = []; let who = '';
    for (const entry of timeline) {
      const m = entry.kind === 'message' ? entry.message : null;
      const unanswered = Boolean(m && m.callData && !m.deletedForEveryone);
      if (m && unanswered && (run.length === 0 || who === m.senderKey)) { run.push(entry.key); who = m.senderKey; continue; }
      flush(run); run = [];
      if (m && unanswered) { run = [entry.key]; who = m.senderKey; }
    }
    flush(run);
    return info;
  }, [timeline]);
  const lockedRuns = useMemo(() => {
    const runs = new Map<string, number>();
    let first: string | null = null;
    for (const entry of timeline) {
      const locked = entry.kind === 'message' && entry.message.decryptFailure === 'no_key' && !entry.message.deletedForEveryone;
      if (!locked) { first = null; continue; }
      if (first === null) { first = entry.key; runs.set(first, 1); } else { runs.set(first, (runs.get(first) ?? 1) + 1); runs.set(entry.key, 0); }
    }
    return runs;
  }, [timeline]);
  // Latest activity first: newest message or newest received Gayze in each chat.
  const sortedRooms = useMemo(() => {
    const latestGayze = new Map<string, number>();
    for (const event of gayzeEvents) {
      const at = Date.parse(event.createdAt);
      if (Number.isFinite(at)) latestGayze.set(event.actorId, Math.max(latestGayze.get(event.actorId) ?? 0, at));
    }
    const activity = (room: SwarmRoom) => {
      const roomMessages = messages[room.id];
      return roomActivityAt(
        room.lastTimestamp,
        roomMessages?.length ? roomMessages[roomMessages.length - 1].timestamp : undefined,
        room.peerUserId ? latestGayze.get(room.peerUserId) : undefined,
      );
    };
    return [...rooms].sort((a, b) => activity(b) - activity(a));
  }, [rooms, messages, gayzeEvents]);

  // Chats you have put away. Kept on this device only; a cancelled event's group can be archived from the list.
  const archiveKey = `gayze:archived-chats:${currentUserId || 'local'}`;
  const readArchived = (key: string): string[] => { try { return JSON.parse(localStorage.getItem(key) || '[]') as string[]; } catch { return []; } };
  const [archivedIds, setArchivedIds] = useState<Set<string>>(() => new Set(readArchived(archiveKey)));
  const pendingKey = `gayze:archive-pending:${currentUserId || 'local'}`;
  const migratedKey = `gayze:archive-migrated:${currentUserId || 'local'}`;
  const readPending = (): Record<string, boolean> => { try { return JSON.parse(localStorage.getItem(pendingKey) || '{}'); } catch { return {}; } };
  const writePending = (value: Record<string, boolean>) => { try { localStorage.setItem(pendingKey, JSON.stringify(value)); } catch { /* storage unavailable */ } };
  // The account id can arrive after the first render. Re-read when it does, fold in anything archived before it was known,
  // then take the account's list (changes made offline are applied on top and sent up).
  useEffect(() => {
    const own = readArchived(archiveKey);
    const early = archiveKey === 'gayze:archived-chats:local' ? [] : readArchived('gayze:archived-chats:local');
    const merged = new Set([...own, ...early]);
    setArchivedIds(merged);
    if (early.length) {
      try { localStorage.setItem(archiveKey, JSON.stringify([...merged])); localStorage.removeItem('gayze:archived-chats:local'); } catch { /* keep the early list */ }
    }
    if (!currentUserId) return;
    let cancelled = false;
    void (async () => {
      const server = await fetchArchivedChats();
      if (cancelled || !server) return; // offline or not set up: the on-device list stands
      let migrated = false;
      try { migrated = localStorage.getItem(migratedKey) === '1'; } catch { migrated = true; }
      const plan = reconcileArchive(server, [...merged], readPending(), migrated);
      setArchivedIds(plan.archived);
      try { localStorage.setItem(archiveKey, JSON.stringify([...plan.archived])); } catch { /* ignore */ }
      const okA = await pushArchivedChats(plan.toArchive, true);
      const okR = await pushArchivedChats(plan.toRestore, false);
      if (okA && okR) { writePending({}); try { localStorage.setItem(migratedKey, '1'); } catch { /* ignore */ } }
    })();
    return () => { cancelled = true; };
  }, [archiveKey, currentUserId]);
  const [showArchived, setShowArchived] = useState(false);
  const setArchived = (roomId: string, archived: boolean) => {
    hapticLight();
    setArchivedIds((prev) => {
      const next = new Set(prev);
      if (archived) next.add(roomId); else next.delete(roomId);
      try { localStorage.setItem(archiveKey, JSON.stringify([...next])); } catch { /* storage unavailable: archived for this session only */ }
      return next;
    });
    // Save to the account; if that fails, remember it and send it next time.
    if (currentUserId) {
      writePending({ ...readPending(), [roomId]: archived });
      void pushArchivedChats([roomId], archived).then((ok) => {
        if (ok) { const rest = readPending(); delete rest[roomId]; writePending(rest); }
      });
    }
  };
  const isCancelledEvent = (room: SwarmRoom) => room.type === 'gathering'
    && (Boolean(room.gatheringId && cancelledGatheringIds?.has(room.gatheringId)) || /host cancelled this plan/i.test(room.lastMessage || ''));
  const isFinishedEvent = (room: SwarmRoom) => room.type === 'gathering' && !isCancelledEvent(room) && Boolean(room.gatheringId && finishedGatheringIds?.has(room.gatheringId));
  const listedRooms = sortedRooms.filter((r) => !archivedIds.has(r.id));
  const archivedRooms = sortedRooms.filter((r) => archivedIds.has(r.id));

  // Who in my chats is live right now (display fields only; refreshed while the app is open).
  const peerLive = usePeersLiveIntents(useMemo(() => rooms.map((r) => r.peerUserId || '').filter(Boolean), [rooms]));
  const liveRooms = sortedRooms.filter((r) => r.type !== 'gathering' && r.peerUserId && peerLive.has(r.peerUserId));
  const feedRef = useRef<HTMLDivElement | null>(null);
  const nearBottomRef = useRef(true);
  const previousTailRef = useRef<{ room: string; id?: string }>({ room: '', id: undefined });
  const scrollAnchorRef = useRef<{ height: number; top: number } | null>(null);
  const lastMessageId = currentMessages.at(-1)?.id;
  useLayoutEffect(() => {
    beginChatTrace(activeRoomId, true);
    traceChat(activeRoomId, 'shell-commit');
    countChatWork(activeRoomId, 'renders');
    if (visibleMessages.length) traceChat(activeRoomId, 'first-message-commit');
    if (visibleMessages.some((message) => message.plainText !== undefined && message.plainText !== '[Encrypted message]')) traceChat(activeRoomId, 'first-decrypted-commit');
  });

  // Real safety code for this conversation: only shown when both device keys are
  // known. There is deliberately no placeholder number.
  const safetyBlocks = useMemo(() => {
    const code = currentRoom?.safetyNumber?.trim();
    if (!code) return null;
    const blocks = code.split(/\s+/).filter(Boolean);
    return blocks.length ? blocks : null;
  }, [currentRoom?.safetyNumber]);

  useLayoutEffect(() => {
    const feed = feedRef.current;
    if (!feed) return;
    const previous = previousTailRef.current;
    const changedRoom = previous.room !== activeRoomId;
    if (changedRoom) { nearBottomRef.current = true; scrollAnchorRef.current = null; }
    if (scrollAnchorRef.current && !changedRoom) {
      feed.scrollTop = scrollAnchorRef.current.top + feed.scrollHeight - scrollAnchorRef.current.height;
      scrollAnchorRef.current = null;
    } else if (changedRoom || (lastMessageId !== previous.id && nearBottomRef.current)) {
      // Jump on hydration/reopen; don't animate every decrypted history batch.
      feed.scrollTop = feed.scrollHeight;
    }
    if (!changedRoom && previous.id && lastMessageId !== previous.id && nearBottomRef.current) {
      hapticMessageDecrypted();
      const last = currentMessages.at(-1);
      const mine = last ? (currentUserId ? last.senderKey === currentUserId : last.senderKey === currentUser.publicKey) : true;
      if (last && !mine && !last.isSystem && Date.now() - last.timestamp < FRESH_MESSAGE_MS) playAppSound('messageIn');
    }
    previousTailRef.current = { room: activeRoomId, id: lastMessageId };
  }, [activeRoomId, lastMessageId, visibleCount]);

  // Stay on the latest message while the chat settles. Messages decrypt, photos load and the view is shown after being
  // hidden, all of which change the height after the first jump; follow them until the reader scrolls up themselves.
  const hasRoom = Boolean(currentRoom);
  useLayoutEffect(() => {
    const feed = feedRef.current;
    if (!feed) return;
    nearBottomRef.current = true;
    const stick = () => { if (nearBottomRef.current && !scrollAnchorRef.current) feed.scrollTop = feed.scrollHeight; };
    stick();
    const mutations = typeof MutationObserver !== 'undefined' ? new MutationObserver(stick) : null;
    mutations?.observe(feed, { childList: true, subtree: true, characterData: true });
    const resize = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(stick) : null;
    resize?.observe(feed);
    feed.addEventListener('load', stick, true);          // images and video finishing loading
    const frame = setTimeout(stick, 16);
    const settle = setTimeout(stick, 300);
    return () => {
      mutations?.disconnect(); resize?.disconnect(); feed.removeEventListener('load', stick, true);
      clearTimeout(frame); clearTimeout(settle);
    };
  }, [activeRoomId, mobileView, hasRoom]);

  const handleSelectRoom = (roomId: string) => {
    hapticLight();
    onSelectRoom(roomId);
    setMobileView('chat');
  };

  const handlePhotoSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    // Once per device: say plainly what is not allowed, and that it can be a crime.
    let told = false;
    try { told = localStorage.getItem('gayze:photo-notice') === '1'; } catch { told = true; }
    if (!told) {
      const ok = window.confirm('Before you send a photo:\n\nOnly send photos the other person wants. Sexual or nude images are not allowed on GAYZE. Sending someone a sexual image they have not asked for can be a criminal offence in England and Wales, and your account will be suspended.\n\nSend photos anyway?');
      if (!ok) { e.target.value = ''; return; }
      try { localStorage.setItem('gayze:photo-notice', '1'); } catch { /* asked again next time */ }
    }
    try {
      const dataUrl = await preparePhotoAttachment(file);
      setAttachedMedia(dataUrl);
    } catch (err: any) {
      console.warn('[GAYZE] Photo attachment error:', err);
    }
  };

  const handleSend = async (e: React.FormEvent) => {
    e.preventDefault();
    if ((!inputText.trim() && !attachedMedia) || !currentRoom) return;

    hapticMessageSent();
    playAppSound('messageOut');
    const textToSend = inputText.trim() || (attachedMedia ? 'Shared a photo' : '');
    const mediaToSend = attachedMedia || undefined;

    const draft = JSON.stringify([currentUserId, currentRoom.id, textToSend, mediaToSend, currentRoom.ephemeralTtlSeconds]);
    let messageId = pendingSends.current.get(draft);
    if (!messageId) {
      messageId = crypto.randomUUID();
      pendingSends.current.set(draft, messageId);
    }
    setSendError(null);

    // Render the outgoing message immediately. The same stable ID is used by
    // the encrypted database write, so acknowledgement replaces this bubble
    // instead of creating a duplicate.
    setOptimisticMessages((prev) => [
      ...prev.filter((message) => message.id !== messageId),
      {
        id: messageId,
        roomId: currentRoom.id,
        senderKey: currentUserId || currentUser.publicKey,
        senderName: 'You',
        timestamp: Date.now(),
        cipherText: '',
        nonceHex: '',
        plainText: textToSend,
        ephemeralTtlSeconds: currentRoom.ephemeralTtlSeconds,
        mediaUrl: mediaToSend,
        mediaType: mediaToSend ? 'image' : undefined,
        sendState: 'sending',
      },
    ]);
    setInputText('');
    setAttachedMedia(null);

    try {
      const outcome = await onSendMessage(currentRoom.id, textToSend, currentRoom.ephemeralTtlSeconds, undefined, mediaToSend, messageId);
      pendingSends.current.delete(draft);
      if (outcome === 'queued') {
        // No connection: the message waits and is sent by itself when the connection returns.
        setOptimisticMessages((prev) => prev.map((message) => message.id === messageId ? { ...message, sendState: 'queued' } : message));
      } else {
        setOptimisticMessages((prev) => prev.filter((message) => message.id !== messageId));
      }
    } catch {
      setSendError('Send not confirmed. Your message is safe to retry.');
      setOptimisticMessages((prev) => prev.map((message) => message.id === messageId ? { ...message, sendState: 'failed' } : message));
    } finally {
    }
  };

  const getTtlLabel = (ttl: number) => {
    if (ttl === 0) return 'Auto-delete: Off';
    if (ttl === 300) return 'Auto-delete: 5m';
    if (ttl === 3600) return 'Auto-delete: 1h';
    if (ttl === 86400) return 'Auto-delete: 24h';
    return `Auto-delete: ${ttl}s`;
  };

  const cycleTtl = () => {
    if (!currentRoom) return;
    const ttls = [0, 300, 3600, 86400];
    const currentIndex = ttls.indexOf(currentRoom.ephemeralTtlSeconds);
    const nextTtl = ttls[(currentIndex + 1) % ttls.length];
    onUpdateRoomTtl(currentRoom.id, nextTtl);
  };

  // The feed is padded by whatever the overlay currently occupies (0 when there is no live intent).
  useEffect(() => {
    const el = overlayRef.current;
    if (!el) { setOverlayHeight(0); return; }
    const measure = () => setOverlayHeight(Math.max(0, Math.round(el.offsetHeight - 10)));
    measure();
    if (typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => observer.disconnect();
  }, [currentRoom?.id, mobileView]);

  const groupEvent = currentRoom?.type === 'gathering' && currentRoom.gatheringId ? groupEvents?.[currentRoom.gatheringId] : undefined;
  const groupMembers: GroupMember[] = currentRoom?.type === 'gathering'
    ? (currentRoom.memberIds ?? []).map((id) => ({
        userId: id,
        name: currentRoom.memberNames?.[id] || 'Gayze member',
        isYou: id === currentUserId,
        isHost: Boolean(groupEvent?.hostId && groupEvent.hostId === id),
        hasChat: rooms.some((r) => r.type === 'direct' && r.peerUserId === id),
      }))
    : [];
  const messageMember = (member: GroupMember) => {
    setShowMembers(false);
    if (member.hasChat) { const dm = rooms.find((r) => r.type === 'direct' && r.peerUserId === member.userId); if (dm) { handleSelectRoom(dm.id); return; } }
    onMessageMember?.(member.userId, member.name);
  };
  const viewMember = (member: GroupMember) => openPeek?.(member.userId, { name: member.name });

  return (
    <div className="flex flex-col h-full min-h-0">
      {connectionState && connectionState !== 'connected' && !(mobileView === 'chat' && (connectionState === 'connecting' || connectionState === 'syncing')) && (
        <div role="status" aria-live="polite" className="shrink-0 px-3 py-1 flex items-center justify-center">
          <div className="g-connection-bar">
            <span className={`w-1.5 h-1.5 rounded-full ${connectionState === 'reconnecting' || connectionState === 'offline' ? 'bg-amber-400 animate-pulse' : 'bg-[#a879f1] animate-pulse'}`} />
            <span>
              {{ connecting: 'Connecting to messages…', syncing: 'Syncing messages…', connected: 'Live · messages synced', reconnecting: 'Connection interrupted — reconnecting…', offline: 'Offline — messages will sync when you reconnect', suspended: 'Messages paused while app is in background', 'sign-in-required': 'Session ended — sign in again' }[connectionState]}
            </span>
          </div>
        </div>
      )}
    <div className="gayze-chat-shell flex flex-1 min-h-0 bg-[#090a0e] rounded-2xl border border-white/[0.08] overflow-hidden shadow-2xl">
      {/* Sidebar: Chats & Conversations */}
      <div
        data-testid="conversation-list"
        className={`gayze-chat-sidebar w-full sm:w-72 md:w-80 bg-[#0d0e14] border-r border-white/[0.08] flex flex-col shrink-0 ${mobileView === 'chat' ? 'hidden sm:flex' : 'flex'
          }`}
      >
        {/* Messages / Notifications sub-navigation */}
        <div className="gayze-message-header g-msglist-head">
          <div className="g-msglist-head__title">
            <h2>Messages</h2>
            {rooms.length > 0 && <span className="g-msglist-head__count">{rooms.length}</span>}
          </div>
        </div>

        {/* Room List */}
        <div className="g-chatlist flex-1 overflow-y-auto">
          {rooms.length === 0 && (
            <div className="g-chatlist__empty">
              <span className="g-chatlist__empty-icon"><Lock className="w-5 h-5" /></span>
              <p>No messages yet</p>
              <span>Conversations open automatically when interest is mutual on an intent.</span>
            </div>
          )}
          {liveRooms.length > 0 && (
            <section className="g-live-rail" aria-label="Live now">
              <h3><i aria-hidden="true" />Live now<span>{liveRooms.length}</span></h3>
              <div className="g-live-rail__track">
                {liveRooms.map((room) => {
                  const live = peerLive.get(room.peerUserId!)!;
                  const url = room.peerAvatar && room.peerAvatar !== 'user'
                    ? (avatarUrls[room.peerAvatar] || (room.peerAvatar.startsWith('http') ? room.peerAvatar : null))
                    : null;
                  return (
                    <button key={room.id} type="button" className="g-live-chip" data-mode={live.mode} onClick={() => handleSelectRoom(room.id)}
                      aria-label={`${room.name} is live: ${intentDisplayLabel(live.intent)}, ${timeLeftLabel(live.expiresAt)}`}>
                      <span className="g-live-chip__ring" style={{ ['--h' as string]: avatarHue(room.name) }}>
                        {url ? <img src={url} alt="" /> : <b>{room.name.charAt(0).toUpperCase()}</b>}
                      </span>
                      <strong>{room.name}</strong>
                      <em>{intentDisplayLabel(live.intent)}</em>
                    </button>
                  );
                })}
              </div>
            </section>
          )}
          {(() => { const renderRow = (room: SwarmRoom, archivedRow: boolean) => {
            const isSelected = room.id === currentRoom?.id;
            const isGathering = room.type === 'gathering';
            const cancelled = isCancelledEvent(room);
            const finished = isFinishedEvent(room);
            const isLocked = /^can.?t decrypt/i.test(room.lastMessage || '');
            const recovered = isLocked && Boolean(currentUserId && readAutoRekeyAttempt(currentUserId, room.id)?.ok);
            const roomAvatar = room.peerAvatar && room.peerAvatar !== 'user'
              ? (avatarUrls[room.peerAvatar] || (room.peerAvatar.startsWith('http') ? room.peerAvatar : null))
              : null;
            const isOnline = Boolean(!isGathering && room.peerUserId && onlineUserIds?.has(room.peerUserId));
            const liveNow = !isGathering && room.peerUserId ? peerLive.get(room.peerUserId) : undefined;
            const recently = !isOnline && !isGathering && presenceLabel(false, room.peerLastSeenAt).tone === 'recent';

            return (
              <SwipeRow
                key={room.id}
                hintKey={archivedRow ? undefined : (cancelled || finished) ? `gayze:hint:archive:${room.id}` : room.id === listedRooms[0]?.id ? 'gayze:hint:swipe-chats' : undefined}
                hintMax={(cancelled || finished) && !archivedRow ? 3 : 1}
                isOpen={swipeOpenId === room.id}
                onOpenChange={(open) => setSwipeOpenId(open ? room.id : (swipeOpenId === room.id ? null : swipeOpenId))}
                actions={[
                  ...(onDeleteChat ? [{ key: 'delete', label: 'Delete', tone: 'danger' as const, icon: <Trash2 className="w-5 h-5" aria-hidden="true" />, onClick: () => { setDeleteError(null); setConfirmDeleteRoomId(room.id); } }] : []),
                  { key: 'archive', label: archivedRow ? 'Restore' : 'Archive', tone: 'archive', icon: archivedRow ? <ArchiveRestore className="w-5 h-5" aria-hidden="true" /> : <Archive className="w-5 h-5" aria-hidden="true" />, onClick: () => setArchived(room.id, !archivedRow) },
                ]}
              >
              <button
                type="button"
                onClick={(event) => {
                  // The profile photo opens the profile card. Decided here, on the row, so it works whichever element the tap lands on.
                  const onPhoto = !isGathering && room.peerUserId && (event.target as HTMLElement).closest('.g-chatrow__av');
                  if (onPhoto && openPeek) {
                    event.preventDefault();
                    openPeek(room.peerUserId!, { name: room.peerName || room.name, photoUrl: room.peerAvatar && room.peerAvatar !== 'user' ? room.peerAvatar : undefined });
                    return;
                  }
                  handleSelectRoom(room.id);
                }}
                className="g-chatrow"
                data-cancelled={cancelled || undefined}
                data-finished={finished || undefined}
                data-archived={archivedRow || undefined}
                data-active={isSelected}
                data-live={liveNow ? liveNow.mode : undefined}
              >
                <span
                  {...(isGathering ? {} : peekTapProps(openPeek, room.peerUserId, { name: room.peerName || room.name, photoUrl: room.peerAvatar && room.peerAvatar !== 'user' ? room.peerAvatar : undefined }))}
                  className={`g-chatrow__av ${isGathering ? 'is-group' : ''}`}
                  style={{ ['--h' as string]: avatarHue(room.name) }}
                >
                  {isGathering ? (
                    cancelled ? <CalendarX className="w-5 h-5" /> : finished ? <CalendarCheck className="w-5 h-5" /> : <Users className="w-5 h-5" />
                  ) : roomAvatar ? (
                    <img src={roomAvatar} alt="" />
                  ) : (
                    <b>{room.name.charAt(0).toUpperCase()}</b>
                  )}
                  {(isOnline || recently) && <i className={isOnline ? 'is-online' : 'is-recent'} aria-label={isOnline ? 'Online' : 'Recently online'} />}
                </span>

                <span className="g-chatrow__main">
                  <span className="g-chatrow__top">
                    <strong>{room.name}</strong>
                    <time>{formatListTime(room.lastTimestamp)}</time>
                  </span>
                  {liveNow && (
                    <span className="g-chatrow__live" data-mode={liveNow.mode}>
                      <i aria-hidden="true" />{intentDisplayLabel(liveNow.intent)}<small>{timeLeftLabel(liveNow.expiresAt)}</small>
                    </span>
                  )}
                  {isLocked ? (
                    <span className="g-chatrow__msg is-locked"><KeyRound className="w-3.5 h-3.5" aria-hidden="true" />{recovered ? 'Earlier messages are locked' : 'Locked on this device'}</span>
                  ) : (
                    <span className={`g-chatrow__msg${room.lastMessage ? '' : ' is-empty'}`}>{room.lastMessage || 'Say hello. It is encrypted on this device.'}</span>
                  )}
                  {(isGathering || room.ephemeralTtlSeconds > 0 || isLocked) && (
                    <span className="g-chatrow__tags">
                      {cancelled
                        ? <span className="is-cancelled"><CalendarX className="w-3 h-3" aria-hidden="true" />Cancelled</span>
                        : finished
                        ? <span className="is-finished"><CalendarCheck className="w-3 h-3" aria-hidden="true" />Finished</span>
                        : isGathering && <span className="is-group"><Users className="w-3 h-3" aria-hidden="true" />Event group</span>}
                      {room.ephemeralTtlSeconds > 0 && (
                        <span className="is-ttl"><Flame className="w-3 h-3" aria-hidden="true" />{getTtlLabel(room.ephemeralTtlSeconds)}</span>
                      )}
                      {isLocked && (recovered ? <span className="is-ok">New messages work</span> : <span className="is-warn">Open to start a fresh session</span>)}
                    </span>
                  )}
                </span>
              </button>
              {(cancelled || finished || archivedRow) && (
                <div className="g-chatrow-act" data-cancelled={cancelled || undefined}>
                  <span>{archivedRow ? 'Archived on this device.' : cancelled ? 'This plan is over. Archive it to tidy your list.' : 'This event has finished. Archive it to tidy your list.'}</span>
                  <button type="button" onClick={() => setArchived(room.id, !archivedRow)}>
                    {archivedRow ? <ArchiveRestore className="w-3.5 h-3.5" aria-hidden="true" /> : <Archive className="w-3.5 h-3.5" aria-hidden="true" />}
                    {archivedRow ? 'Restore' : 'Archive'}
                  </button>
                </div>
              )}
              </SwipeRow>
            );
          };
          return (
            <>
              {(() => {
                const privateRooms = listedRooms.filter((r) => r.type !== 'gathering');
                const groupRooms = listedRooms.filter((r) => r.type === 'gathering');
                const sectioned = privateRooms.length > 0 && groupRooms.length > 0;
                return (
                  <>
                    {sectioned && <h3 className="g-chat-section"><MessageCircle className="w-3.5 h-3.5" aria-hidden="true" />Private chats<span>{privateRooms.length}</span></h3>}
                    {privateRooms.map((room) => renderRow(room, false))}
                    {sectioned && <h3 className="g-chat-section is-group"><Users className="w-3.5 h-3.5" aria-hidden="true" />Event groups<span>{groupRooms.length}</span></h3>}
                    {groupRooms.map((room) => renderRow(room, false))}
                  </>
                );
              })()}
              {archivedRooms.length > 0 && (
                <>
                  <button type="button" className="g-archived__toggle" aria-expanded={showArchived} onClick={() => { hapticLight(); setShowArchived((v) => !v); }}>
                    <Archive className="w-4 h-4" aria-hidden="true" />Archived<span>{archivedRooms.length}</span>
                    <ChevronDown className={`w-4 h-4 g-archived__chev ${showArchived ? 'is-open' : ''}`} aria-hidden="true" />
                  </button>
                  {showArchived && archivedRooms.map((room) => renderRow(room, true))}
                </>
              )}
            </>
          ); })()}
        </div>

        {/* Footnote: plain words about what the lock means, clear of the tab bar */}
        <div className="g-msglist-foot">
          <Lock className="w-3.5 h-3.5" aria-hidden="true" />
          <span>Only you and the people in each chat can read these. Disappearing timers are set per chat.</span>
        </div>
      </div>

      {/* Main Chat Area */}
      {currentRoom ? (
        <div data-testid="conversation-pane" data-room-id={currentRoom.id}
          className={`g-chat-shell flex-1 flex flex-col bg-[#090a0e] min-w-0 min-h-0 ${mobileView === 'list' ? 'hidden sm:flex' : 'flex'
            }`}
        >
          {/* Header */}
          <div className="gayze-chat-header relative z-10 w-full shrink-0 border-b border-white/[0.08] flex items-center justify-between gap-2 bg-[#0d0e14]">
            <div className="g-chat-header__left flex items-center gap-2 sm:gap-3 min-w-0 flex-1">
              {/* Mobile Back Button */}
              <button
                onClick={() => {
                  hapticLight();
                  setMobileView('list');
                }}
                className="sm:hidden min-h-[44px] min-w-[44px] -ml-1 flex items-center justify-center text-zinc-400 hover:text-white rounded-xl hover:bg-white/[0.06] transition-colors cursor-pointer"
                aria-label="Back to rooms"
              >
                <ChevronLeft className="w-5 h-5" />
              </button>

              <div
                {...(currentRoom.type === 'direct' ? peekTapProps(openPeek, currentRoom.peerUserId, {
                  name: currentRoom.peerName || currentRoom.name,
                  photoUrl: currentRoom.peerAvatar && currentRoom.peerAvatar !== 'user' ? currentRoom.peerAvatar : undefined,
                  online: Boolean(currentRoom.peerUserId && onlineUserIds?.has(currentRoom.peerUserId)),
                }) : {})}
                className="g-chat-header__avatar w-10 h-10 rounded-xl bg-[#171922] border border-white/10 flex items-center justify-center text-xs font-semibold text-[#C9A24D] shrink-0 overflow-hidden">
                {currentRoom.type === 'gathering' ? (
                  <Users className="w-4 h-4" />
                ) : (currentRoom.peerAvatar && currentRoom.peerAvatar !== 'user' && (avatarUrls[currentRoom.peerAvatar] || (currentRoom.peerAvatar.startsWith('http') ? currentRoom.peerAvatar : null))) ? (
                  <img
                    src={avatarUrls[currentRoom.peerAvatar] || currentRoom.peerAvatar}
                    alt=""
                    className="w-full h-full object-cover"
                  />
                ) : (
                  currentRoom.name.charAt(0)
                )}
              </div>

              <div
                {...(currentRoom.type === 'direct' ? peekTapProps(openPeek, currentRoom.peerUserId, {
                  name: currentRoom.peerName || currentRoom.name,
                  photoUrl: currentRoom.peerAvatar && currentRoom.peerAvatar !== 'user' ? currentRoom.peerAvatar : undefined,
                  online: Boolean(currentRoom.peerUserId && onlineUserIds?.has(currentRoom.peerUserId)),
                }) : {})}
                className="g-chat-header__identity min-w-0 flex-1 flex flex-col items-start justify-center gap-1">
                <div className="flex min-w-0 max-w-full items-center gap-1.5">
                  <h2 className="m-0 text-sm sm:text-base font-semibold leading-tight text-white truncate">{currentRoom.name}</h2>
                  {currentRoom.type === 'direct' && isPeerVerified[currentRoom.id] && (
                    <span title="Safety Fingerprint Verified" className="shrink-0 inline-flex">
                      <ShieldCheck className="w-3.5 h-3.5 text-emerald-400" />
                    </span>
                  )}
                </div>
                <div className="flex min-w-0 max-w-full items-center gap-1.5 text-[11px] leading-tight">
                  {currentRoom.type !== 'direct' ? (
                    <button type="button" className="g-group-sub" onClick={() => { hapticLight(); setShowMembers(true); }} aria-label="Show members">
                      {groupMembers.length > 0 ? `${groupMembers.length} people` : 'Group conversation'}
                      {groupEvent ? ` · ${groupEvent.cancelled ? 'Cancelled' : formatEventWhen(groupEvent.startsAt)}` : ''}
                    </button>
                  ) : (() => {
                    const presence = presenceLabel(Boolean(currentRoom.peerUserId && onlineUserIds?.has(currentRoom.peerUserId)), currentRoom.peerLastSeenAt);
                    const dot = presence.tone === 'online' ? 'bg-emerald-400 g-breathe' : presence.tone === 'recent' ? 'bg-amber-400' : 'bg-zinc-500';
                    const text = presence.tone === 'online' ? 'text-emerald-400 font-medium' : presence.tone === 'recent' ? 'text-amber-300 font-medium' : 'text-zinc-400';
                    return (
                      <>
                        <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${dot}`} aria-hidden="true" />
                        <span className={`truncate ${text}`}>{presence.text}</span>
                      </>
                    );
                  })()}
                </div>
              </div>
            </div>

            {/* Header Actions — keep the direct actions quiet; secondary controls live in one menu on mobile. */}
            <div className="g-chat-header__actions flex items-center gap-1 shrink-0">
              {currentRoom.type === 'direct' && onOpenJourney && (
                <button
                  type="button"
                  onClick={() => onOpenJourney(currentRoom.id, currentRoom.peerName || currentRoom.name)}
                  className={`g-icon-btn g-chat-header__action ${journeyRoomId === currentRoom.id ? 'is-live' : ''}`}
                  title="I'm on my way"
                  aria-label="I'm on my way"
                  disabled={Boolean(journeyRoomId) && journeyRoomId !== currentRoom.id}
                >
                  <Navigation className="w-4 h-4 text-[#7be0a8]" />
                </button>
              )}
              {currentRoom.type === 'direct' && onStartCall && (
                <button
                  onClick={() => onStartCall(currentRoom.peerName || currentRoom.name, 'video', currentRoom.peerUserId, currentRoom.peerAvatar)}
                  className="g-icon-btn g-chat-header__action"
                  title="Video call"
                  aria-label="Start video call"
                >
                  <Video className="w-4 h-4 text-[#c4a9f7]" />
                </button>
              )}

              {currentRoom.type === 'gathering' && (
                <button type="button" onClick={() => { hapticLight(); setShowMembers(true); }} className="g-icon-btn g-chat-header__action" title="Members" aria-label="Show members">
                  <Users className="w-4 h-4 text-[#e7c46f]" />
                </button>
              )}

              <div className="relative">
                <button
                  type="button"
                  onClick={() => setShowChatActions((value) => !value)}
                  className="g-icon-btn"
                  aria-label="Conversation actions"
                  aria-expanded={showChatActions}
                >
                  <MoreHorizontal className="w-4 h-4" />
                </button>

                {showChatActions && (
                  <div className="g-gayze-menu-frame absolute right-0 top-12 z-40 w-64 g-panel p-1.5 shadow-2xl">
                    {currentRoom.type === 'direct' && onStartCall && (
                      <button
                        type="button"
                        aria-label="Audio call"
                        className="g-row !min-h-[42px] !rounded-xl"
                        onClick={() => {
                          setShowChatActions(false);
                          onStartCall(currentRoom.peerName || currentRoom.name, 'audio', currentRoom.peerUserId, currentRoom.peerAvatar);
                        }}
                      >
                        <Phone className="w-4 h-4 text-[#c4a9f7]" />
                        <span className="text-[12px]">Audio call</span>
                      </button>
                    )}
                    <button
                      type="button"
                      aria-label="Share a place"
                      className="g-row !min-h-[42px] !rounded-xl"
                      onClick={() => { setShowChatActions(false); setShowSharePlace(true); }}
                    >
                      <MapPin className="w-4 h-4 text-[#7be0a8]" />
                      <span className="text-[12px]">Share a place</span>
                    </button>
                    {currentRoom.type === 'direct' && onOpenScheduleMeeting && (
                      <button
                        type="button"
                        aria-label="Plan a safe meetup"
                        className="g-row !min-h-[42px] !rounded-xl"
                        onClick={() => {
                          setShowChatActions(false);
                          onOpenScheduleMeeting(currentRoom.peerName || currentRoom.name);
                        }}
                      >
                        <Calendar className="w-4 h-4 text-[#C9A24D]" />
                        <span className="text-[12px]">Plan a safe meetup</span>
                      </button>
                    )}
                    <button
                      type="button"
                      aria-label="Disappearing messages"
                      className="g-row !min-h-[42px] !rounded-xl"
                      onClick={() => {
                        setShowChatActions(false);
                        cycleTtl();
                      }}
                    >
                      <Clock className="w-4 h-4 text-[#c4a9f7]" />
                      <span className="text-[12px]">Disappearing messages</span>
                      <span className="ml-auto text-[10px] text-zinc-500">
                        {getTtlLabel(currentRoom.ephemeralTtlSeconds).replace('Auto-delete: ', '')}
                      </span>
                    </button>
                    <button
                      type="button"
                      aria-label="Verify safety code"
                      className="g-row !min-h-[42px] !rounded-xl"
                      onClick={() => {
                        setShowChatActions(false);
                        setIsSafetyModalOpen(true);
                      }}
                    >
                      <ShieldCheck className="w-4 h-4 text-emerald-400" />
                      <span className="text-[12px]">Verify safety code</span>
                    </button>
                    {currentRoom.type === 'direct' && currentRoom.peerUserId && onReportPeer && (
                      <button
                        type="button"
                        aria-label="Report this user"
                        className="g-row !min-h-[42px] !rounded-xl"
                        onClick={() => {
                          setShowChatActions(false);
                          onReportPeer(currentRoom.peerUserId!, currentRoom.peerName || currentRoom.name, currentRoom.id);
                        }}
                      >
                        <Flag className="w-4 h-4 text-red-400" />
                        <span className="text-[12px] text-red-300">Report user</span>
                      </button>
                    )}
                    {currentRoom.type === 'direct' && currentRoom.peerUserId && onBlockPeer && (
                      <button
                        type="button"
                        aria-label="Block this user"
                        className="g-row !min-h-[42px] !rounded-xl"
                        onClick={() => {
                          setShowChatActions(false);
                          onBlockPeer(currentRoom.peerUserId!, currentRoom.peerName || currentRoom.name);
                        }}
                      >
                        <Ban className="w-4 h-4 text-red-400" />
                        <span className="text-[12px] text-red-300">Block user</span>
                      </button>
                    )}
                    {onDeleteChat && (
                      <button
                        type="button"
                        aria-label="Delete Chat"
                        className="g-row !min-h-[42px] !rounded-xl"
                        onClick={() => {
                          setShowChatActions(false);
                          setDeleteError(null);
                          setConfirmDeleteRoomId(currentRoom.id);
                        }}
                      >
                        <Trash2 className="w-4 h-4 text-red-400" />
                        <span className="text-[12px] text-red-300">Delete Chat</span>
                      </button>
                    )}
                  </div>
                )}
              </div>
            </div>
          </div>

          {/* Messages + frosted overlay: the live intent floats over the top of the
              conversation and blurs into it, instead of pushing the messages down. */}
          <div className="g-chat-stage">
          <div className="g-chat-overlay" ref={overlayRef}>
            {visibleRoomId && currentRoom.type === 'direct' && currentUserId && currentRoom.peerUserId && (
              <PeerIntentBanner key={`${currentUserId}/${currentRoom.id}/${currentRoom.peerUserId}`}
                userId={currentUserId} peerId={currentRoom.peerUserId}
                peerName={currentRoom.peerName || currentRoom.name} now={now} />
            )}
            {currentRoom.connectionContext && (
              <div className="g-chat-context">
                <span className="min-w-0 truncate">
                  <b>Connected via</b> {currentRoom.connectionContext.replace(/^Connected via\s*/i, '')}
                </span>
                {onReturnToDiscovery && (
                  <button type="button" onClick={onReturnToDiscovery}>
                    <MapPin className="w-3.5 h-3.5" />Map
                  </button>
                )}
              </div>
            )}
          </div>
          <div ref={feedRef} className="g-chat-feed flex-1 overflow-y-auto p-3 sm:p-4 space-y-3" style={{ paddingTop: `calc(${overlayHeight}px + 12px)` }}
            onScroll={() => { const feed = feedRef.current; if (feed) nearBottomRef.current = feed.scrollHeight - feed.scrollTop - feed.clientHeight < 100; }}>
            {currentMessages.length > visibleCount && (
              <button type="button" className="block mx-auto min-h-[44px] text-xs text-[#C9A24D]" onClick={() => {
                const feed = feedRef.current;
                if (feed) scrollAnchorRef.current = { height: feed.scrollHeight, top: feed.scrollTop };
                setHistoryWindow({ roomId: activeRoomId, count: visibleCount + 100 });
              }}>Show older messages</button>
            )}
            {timeline.length === 0 && currentRoom && (
              <div className="g-chatlist__empty" role="status">
                <span className="g-chatlist__empty-icon"><Lock className="w-5 h-5" /></span>
                <p>{currentRoom.type === 'gathering' ? `Say hello to the group. Everyone in ${currentRoom.name} can read it, and no one else.` : `You're connected with ${currentRoom.peerName || currentRoom.name}. Say hello — it's encrypted on this device.`}</p>
              </div>
            )}
            {timeline.map((entry) => {
              if (entry.kind === 'gayze') {
                const who = currentRoom?.name ?? 'Someone';
                const label = entry.count > 1 ? `${who} sent you ${entry.count} Gayzes` : `${who} sent you a Gayze`;
                return (
                  <div key={entry.key} className="flex items-center gap-2 py-0.5" role="note" aria-label={label} data-gayze-event>
                    <span className="h-px flex-1 bg-gradient-to-r from-transparent to-violet-300/25" aria-hidden="true" />
                    <span className="inline-flex max-w-[86%] items-center gap-2 rounded-full border border-violet-300/30 bg-violet-950/50 py-1 pl-1.5 pr-3 text-[11px] text-violet-100">
                      <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-violet-500/40 to-amber-300/25">
                        <img src="/brand/gayze-nav-v3.svg?v=20261008-8" alt="" className="h-3 w-5 object-contain" width={20} height={12} draggable={false} />
                      </span>
                      <span className="min-w-0 truncate font-medium">{label}</span>
                      <time className="shrink-0 text-[10px] text-violet-100/60" dateTime={entry.latestCreatedAt}>
                        {new Date(entry.latestCreatedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                      </time>
                    </span>
                    <span className="h-px flex-1 bg-gradient-to-l from-transparent to-violet-300/25" aria-hidden="true" />
                  </div>
                );
              }
              if (callRuns.get(entry.key)?.hidden) return null;
              const lockedRun = lockedRuns.get(entry.key);
              if (lockedRun === 0) return null;
              if (lockedRun) {
                return (
                  <div key={entry.key} className="g-locked-run" role="note" data-decrypt-failure="no_key">
                    <Lock className="w-4 h-4 shrink-0" aria-hidden="true" />
                    <span><b>{lockedRun === 1 ? 'An earlier message is' : `${lockedRun} earlier messages are`} locked on this device.</b> {conversationKeyUnavailable ? 'Setting up a fresh secure session so new messages work…' : 'New messages in this chat work normally.'}</span>
                  </div>
                );
              }
              const msg = entry.message;
              const isMe = currentUserId
                ? msg.senderKey === currentUserId
                : msg.senderKey === currentUser.publicKey;
              const isInspecting = inspectedMessageId === msg.id;

              return (
                <div
                  key={msg.id}
                  className={`flex flex-col ${isMe ? 'items-end' : 'items-start'}`}
                >
                  <div className={`g-msg-meta ${isMe ? 'is-me' : ''}`}>
                    {!isMe && currentRoom?.type !== 'direct' && (
                      currentRoom?.type === 'gathering' && groupMembers.some((m) => m.userId === msg.senderKey)
                        ? <button type="button" className="g-msg-meta__name g-msg-meta__name--tap" onClick={() => { hapticLight(); setMemberFocus(msg.senderKey); setShowMembers(true); }}>{msg.senderName}</button>
                        : <span className="g-msg-meta__name">{msg.senderName}</span>
                    )}
                    <span>{new Date(msg.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
                    {msg.sendState === 'sending' && <span>· Sending…</span>}
                    {msg.sendState === 'queued' && <span className="inline-flex items-center gap-1 text-amber-200/90"><Clock className="w-3 h-3" aria-hidden="true" />Waiting to send</span>}
                    {msg.sendState === 'failed' && <span className="text-amber-300">· Not confirmed</span>}
                    <div className="relative">
                      <button
                        type="button"
                        aria-label="Message actions"
                        className="w-7 h-7 rounded-lg text-zinc-500 hover:text-zinc-200 hover:bg-white/[0.08] flex items-center justify-center transition-colors cursor-pointer"
                        onClick={() => setMessageActionId((value) => value === msg.id ? null : msg.id)}
                      >
                        <MoreHorizontal className="w-3.5 h-3.5" />
                      </button>
                      {messageActionId === msg.id && (
                        <div className="absolute right-0 top-8 z-30 w-48 rounded-xl border border-white/10 bg-[#11131a] p-1.5 shadow-2xl">
                          {isMe && onUnsendMessage && !msg.deletedForEveryone && <button type="button" className="w-full rounded-lg px-3 py-2 text-left text-[11px] text-white hover:bg-white/5" onClick={async () => { await onUnsendMessage(msg.id); setMessageActionId(null); }}>Unsend for everyone</button>}
                          <button type="button" className="w-full rounded-lg px-3 py-2 text-left text-[11px] text-zinc-300 hover:bg-white/5" onClick={() => { setInspectedMessageId(isInspecting ? null : msg.id); if (!isInspecting) hapticMessageDecrypted(); setMessageActionId(null); }}>{isInspecting ? 'Hide encryption details' : 'Encryption details'}</button>
                          {onDeleteMessage && <button type="button" className="w-full rounded-lg px-3 py-2 text-left text-[11px] text-zinc-300 hover:bg-white/5" onClick={async () => { await onDeleteMessage(msg.id); setMessageActionId(null); }}>Delete for me</button>}
                          {onSetMessageExpiry && !msg.deletedForEveryone && <div className="border-t border-white/10 mt-1 pt-1"><button type="button" className="w-full rounded-lg px-3 py-2 text-left text-[11px] text-zinc-300 hover:bg-white/5" onClick={async () => { await onSetMessageExpiry(msg.id, 60); setMessageActionId(null); }}>Expire in 1 minute</button><button type="button" className="w-full rounded-lg px-3 py-2 text-left text-[11px] text-zinc-300 hover:bg-white/5" onClick={async () => { await onSetMessageExpiry(msg.id, 3600); setMessageActionId(null); }}>Expire in 1 hour</button><button type="button" className="w-full rounded-lg px-3 py-2 text-left text-[11px] text-zinc-300 hover:bg-white/5" onClick={async () => { await onSetMessageExpiry(msg.id, null); setMessageActionId(null); }}>Never expire</button></div>}
                        </div>
                      )}
                    </div>
                  </div>

                  <div
                    className={`max-w-[88%] sm:max-w-md px-3.5 py-2.5 text-xs sm:text-sm leading-relaxed transition-all ${
                      msg.callData ? 'g-bubble--call' : msg.meetingData ? 'g-bubble--card' : isMe ? 'g-bubble--mine' : 'g-bubble--peer'
                    }`}
                  >
                    {/* Encrypted Photo Attachment if present */}
                    {!msg.deletedForEveryone && msg.mediaUrl && (() => {
                      const hidden = !isMe && !revealedPhotos.has(msg.id);
                      return (
                        <div className="mb-2 rounded-xl overflow-hidden border border-black/10 bg-black/40 max-h-60 relative">
                          <img
                            src={msg.mediaUrl}
                            alt={hidden ? 'Hidden photo' : 'Encrypted attachment'}
                            className={`w-full h-full object-cover transition-opacity ${hidden ? 'g-photo-hidden' : 'cursor-pointer hover:opacity-95'}`}
                            onClick={() => { if (!hidden) setZoomedMediaUrl(msg.mediaUrl || null); }}
                          />
                          {hidden && (
                            <button type="button" className="g-photo-gate" onClick={() => { hapticLight(); setRevealedPhotos((prev) => new Set(prev).add(msg.id)); }}>
                              <EyeOff className="w-5 h-5" aria-hidden="true" />
                              <b>Photo hidden</b>
                              <span>Tap to look. You can report it afterwards.</span>
                            </button>
                          )}
                          {!hidden && !isMe && currentRoom?.type === 'direct' && currentRoom.peerUserId && onReportPeer && (
                            <button type="button" className="g-photo-report" onClick={() => { hapticLight(); onReportPeer(currentRoom.peerUserId!, currentRoom.peerName || currentRoom.name, currentRoom.id); }}>Report</button>
                          )}
                        </div>
                      );
                    })()}

                    {msg.decryptFailure && !msg.deletedForEveryone ? (
                      <p className="flex items-start gap-1.5 text-[13px] italic opacity-80" data-decrypt-failure={msg.decryptFailure}>
                        <Lock className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                        <span>{msg.decryptFailure === 'tampered_or_wrong_key'
                          ? 'This message failed its integrity check and was not shown.'
                          : 'Can\'t decrypt this message on this device. Re-verify this device or open the chat on one that already has the key.'}</span>
                      </p>
                    ) : msg.callData && !msg.deletedForEveryone && currentRoom ? (
                      <CallLineCard
                        call={msg.callData}
                        isCaller={isMe}
                        peerName={currentRoom.peerName || currentRoom.name}
                        time={msg.timestamp}
                        count={callRuns.get(entry.key)?.count ?? 1}
                        canRetry={currentRoom.type === 'direct' && Boolean(onStartCall) && msg.id === lastCallMsgId}
                        onRetry={(type) => onStartCall?.(currentRoom.peerName || currentRoom.name, type, currentRoom.peerUserId, currentRoom.peerAvatar)}
                        onLeaveNote={onSendNote ? (kind) => setNoteRecorder({ kind }) : undefined}
                      />
                    ) : msg.albumData && !msg.deletedForEveryone ? (
                      <AlbumCard share={msg.albumData} mine={isMe} peerName={currentRoom.peerName || currentRoom.name} />
                    ) : msg.noteData && !msg.deletedForEveryone ? (
                      <div className="g-notemsg">
                        {msg.noteData.kind === 'video'
                          ? <video src={msg.noteData.data} controls playsInline preload="metadata" aria-label="Video note" />
                          : <audio src={msg.noteData.data} controls preload="metadata" aria-label="Voice message" />}
                        <span>{msg.noteData.kind === 'video' ? 'Video note' : 'Voice message'} · {msg.noteData.seconds}s</span>
                      </div>
                    ) : (
                      !msg.deletedForEveryone && msg.meetingData ? null : <p className="whitespace-pre-wrap">{msg.deletedForEveryone ? 'Message unsent' : msg.plainText}</p>
                    )}

                    {/* The meetup as a card with its controls; older messages about the same meetup collapse */}
                    {msg.meetingData && currentRoom && (() => {
                      const latest = meetups.get(msg.meetingData.id);
                      const isLatest = !latest || latest.msgId === msg.id;
                      const meeting = isLatest && latest ? latest.meeting : msg.meetingData;
                      return (
                        <MeetupCard
                          meeting={meeting}
                          isLatest={isLatest}
                          isProposer={latest ? latest.proposedByMe : isMe}
                          peerName={currentRoom.peerName || currentRoom.name}
                          userLocation={userLocation ?? null}
                          journeyActive={journeyRoomId === currentRoom.id}
                          onAction={(action, m) => onMeetingAction?.(action, m)}
                        />
                      );
                    })()}

                    {msg.sendState === 'failed' && (
                      <div className="g-bubble__meta">
                        <button
                          type="button"
                          className="text-amber-300 underline"
                          onClick={() => {
                            setInputText(msg.plainText);
                            if (msg.mediaUrl) setAttachedMedia(msg.mediaUrl);
                            setOptimisticMessages((prev) => prev.filter((item) => item.id !== msg.id));
                            setSendError(null);
                          }}
                        >
                          Retry
                        </button>
                      </div>
                    )}
                  </div>

                  {/* Cryptographic Inspector Drawer */}
                  {isInspecting && (
                    <div className="mt-1.5 p-2.5 bg-[#141620] border border-white/10 rounded-xl text-[11px] text-zinc-300 max-w-md space-y-1">
                      <div className="text-[#C9A24D] font-medium flex items-center gap-1.5">
                        <ShieldCheck className="w-3.5 h-3.5 text-emerald-400" />
                        <span>Message Encryption Details</span>
                      </div>
                      <div className="text-zinc-400">Encryption standard: AES-256 (end-to-end)</div>
                      <div className="text-zinc-400 truncate font-mono">Nonce: 0x{msg.nonceHex}</div>
                      <div className="text-emerald-400 font-medium">Decrypted locally on your device</div>
                    </div>
                  )}
                </div>
              );
            })}
            <div ref={messagesEndRef} />
          </div>
          </div>

          {/* Message Input Box */}
          {sendError && <div role="alert" className="shrink-0 px-3 py-2 text-xs text-amber-200">{sendError}</div>}
          <form onSubmit={handleSend} className="shrink-0 p-2.5 sm:p-3 bg-[#0d0e14] border-t border-white/[0.08] pb-[calc(env(safe-area-inset-bottom,0px)+0.75rem)]">
            {/* Attached Photo Preview Thumbnail */}
            {attachedMedia && (
              <div className="relative mb-2.5 inline-flex items-center gap-2.5 p-1.5 bg-[#141620] border border-white/15 rounded-xl animate-in fade-in">
                <img
                  src={attachedMedia}
                  alt="Attachment preview"
                  className="w-12 h-12 object-cover rounded-lg border border-white/10"
                />
                <div className="text-[11px] pr-2">
                  <span className="text-zinc-200 font-semibold block">Photo attached</span>
                  <span className="text-emerald-400/90 text-[11.5px] block">Encrypted on send</span>
                  <button type="button" onClick={() => setPhotoStudioSource(attachedMedia)} className="block text-[#C9A24D] text-[12px] mt-1">Edit in Photo Studio</button>
                </div>
                <button
                  type="button"
                  onClick={() => setAttachedMedia(null)}
                  className="w-5 h-5 rounded-full bg-black/60 hover:bg-black/90 text-zinc-400 hover:text-white flex items-center justify-center cursor-pointer transition-colors"
                  aria-label="Remove photo"
                >
                  <X className="w-3 h-3" />
                </button>
              </div>
            )}

            {conversationKeyUnavailable && (
              <div className="g-secure-chat-error" role="status" aria-live="polite">
                <div className="g-secure-chat-error__copy">
                  <Lock className="h-4 w-4 shrink-0" aria-hidden="true" />
                  <span>{conversationKeyUnavailable
                    ? (conversationKeyReason || 'Secure chat is still setting up on this device. Your messages remain encrypted.')
                    : 'Some saved messages are still encrypted on this device. Reload the secure key and message history to retry decryption.'}</span>
                </div>
                {onRetrySecureChat && <button type="button" className="g-secure-chat-error__retry" onClick={onRetrySecureChat}>Retry</button>}
                {conversationKeyCanRekey && onStartFreshSecureSession && (
                  <button type="button" className="g-secure-chat-error__retry" onClick={onStartFreshSecureSession}>Start fresh secure session</button>
                )}
              </div>
            )}
            <div className="g-chat-composer flex items-center gap-2 rounded-xl px-3 py-1.5 transition-colors">
              {/* Photo Upload Action */}
              <label
                className="w-8 h-8 rounded-lg bg-[#1c1f2b] hover:bg-[#252838] border border-white/10 text-zinc-400 hover:text-white flex items-center justify-center shrink-0 transition-colors cursor-pointer"
                title="Attach encrypted photo (Max 5MB)"
              >
                <ImageIcon className="w-3.5 h-3.5" />
                <input
                  type="file"
                  accept="image/jpeg,image/png,image/webp"
                  className="hidden"
                  onChange={handlePhotoSelect}
                />
              </label>

              <input
                type="text"
                value={inputText}
                disabled={conversationKeyUnavailable}
                onChange={(e) => setInputText(e.target.value)}
                placeholder={conversationKeyUnavailable ? 'Preparing secure chat…' : (currentRoom.ephemeralTtlSeconds > 0 ? `Message · ${getTtlLabel(currentRoom.ephemeralTtlSeconds).replace('Auto-delete: ', '')}` : 'Message…')}
                className="flex-1 bg-transparent text-xs sm:text-sm text-white placeholder-zinc-500 focus:outline-none py-1"
              />

              {currentRoom.type === 'direct' && onSendAlbum && (
                <button
                  type="button"
                  onClick={() => setShowAlbumPicker(true)}
                  className="w-8 h-8 rounded-lg bg-[#1c1f2b] hover:bg-[#252838] border border-white/10 text-[#c9b0f5] flex items-center justify-center shrink-0 transition-colors cursor-pointer"
                  title="Send a private album"
                  aria-label="Send a private album"
                >
                  <Images className="w-3.5 h-3.5" />
                </button>
              )}

              {currentRoom.type === 'direct' && onOpenScheduleMeeting && (
                <button
                  type="button"
                  onClick={() => onOpenScheduleMeeting(currentRoom.peerName || currentRoom.name)}
                  className="w-8 h-8 rounded-lg bg-[#1c1f2b] hover:bg-[#252838] border border-white/10 text-[#C9A24D] flex items-center justify-center shrink-0 transition-colors cursor-pointer"
                  title="Plan a safe meetup at a verified Safe Haven"
                  aria-label="Plan meetup"
                >
                  <Calendar className="w-3.5 h-3.5" />
                </button>
              )}

              <button
                type="submit"
                disabled={(!inputText.trim() && !attachedMedia) || conversationKeyUnavailable}
                className="g-icon-btn g-icon-btn--send shrink-0"
                aria-label="Send message"
              >
                <Send className="w-3.5 h-3.5" />
              </button>
            </div>

            <div className="g-composer-note mt-1.5 flex items-center gap-1 text-[10px] text-zinc-500 px-1">
              <Lock className="w-3 h-3 text-emerald-400/80" />
              <span>End-to-end encrypted · keys stay on your device</span>
            </div>
          </form>
        </div>
      ) : (
        <div className={`flex-1 items-center justify-center p-8 ${mobileView === 'list' ? 'hidden sm:flex' : 'flex'}`}>
          <div className="g-empty max-w-sm !bg-transparent !border-0 !shadow-none">
            <div className="g-empty__icon">
              <Lock className="w-5 h-5" />
            </div>
            <h3>{activeRoomId ? 'Opening requested conversation' : 'No conversation open'}</h3>
            <p>{activeRoomId ? 'Waiting for this conversation. If it is no longer available, choose another chat.' : 'Pick a chat — or message someone from an intent to start an encrypted thread.'}</p>
            {activeRoomId && <button onClick={() => setMobileView('list')} className="sm:hidden min-h-[44px] px-3 text-amber-200">Back to rooms</button>}
          </div>
        </div>
      )}

      {photoStudioSource && <PhotoStudio source={photoStudioSource} onCancel={() => setPhotoStudioSource(null)} onDone={(edited) => { setPhotoStudioSource(null); void compressImageDataUrl(edited).then(setAttachedMedia, () => setAttachedMedia(edited)); }} />}

      {/* Fullscreen Photo Zoom Modal */}
      {zoomedMediaUrl && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/95 backdrop-blur-md animate-in fade-in"
          onClick={() => setZoomedMediaUrl(null)}
        >
          <div className="relative max-w-2xl max-h-[85vh] overflow-hidden rounded-2xl border border-white/10 bg-black">
            <button
              onClick={() => setZoomedMediaUrl(null)}
              className="absolute top-3 right-3 w-8 h-8 rounded-full bg-black/70 text-white flex items-center justify-center hover:bg-black transition-colors z-10 cursor-pointer"
              aria-label="Close photo"
            >
              <X className="w-4 h-4" />
            </button>
            <img
              src={zoomedMediaUrl}
              alt="Zoomed encrypted attachment"
              className="w-full h-full object-contain"
            />
          </div>
        </div>
      )}

      {confirmDeleteRoomId && onDeleteChat && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/85 backdrop-blur-sm" role="dialog" aria-modal="true" aria-labelledby="delete-chat-title">
          <div ref={deleteDialogRef} className="w-full max-w-sm bg-[#11131a] border border-white/10 rounded-2xl p-5 shadow-2xl space-y-4">
            <h3 id="delete-chat-title" className="text-base font-bold text-white">Delete this chat?</h3>
            <p className="text-[12px] text-zinc-400">
              This removes the conversation from your account on every device. The other person keeps their copy and is not notified.
            </p>
            {deleteError && <p role="alert" className="text-[12px] text-red-300">{deleteError}</p>}
            <div className="flex gap-2 justify-end">
              <button
                type="button"
                className="px-3 py-2 rounded-xl text-[12px] text-zinc-300 border border-white/10"
                disabled={isDeletingChat}
                onClick={() => setConfirmDeleteRoomId(null)}
              >
                Cancel
              </button>
              <button
                type="button"
                className="px-3 py-2 rounded-xl text-[12px] font-semibold text-white bg-red-600 disabled:opacity-60"
                disabled={isDeletingChat}
                onClick={async () => {
                  const roomId = confirmDeleteRoomId;
                  setIsDeletingChat(true);
                  setDeleteError(null);
                  try {
                    await onDeleteChat(roomId);
                    setConfirmDeleteRoomId(null);
                  } catch (error: any) {
                    setDeleteError(error?.message || 'Could not delete this chat.');
                  } finally {
                    setIsDeletingChat(false);
                  }
                }}
              >
                {isDeletingChat ? 'Deleting…' : 'Delete Chat'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Safety Fingerprint Modal (Keet / Signal style verification) */}
      {isSafetyModalOpen && currentRoom && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/85 backdrop-blur-sm animate-in fade-in">
          <div className="relative w-full max-w-md bg-[#11131a] border border-white/10 rounded-2xl p-5 sm:p-6 shadow-2xl space-y-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2.5">
                <div className="w-8 h-8 rounded-lg bg-emerald-500/15 border border-emerald-500/30 flex items-center justify-center text-emerald-400">
                  <ShieldCheck className="w-4 h-4" />
                </div>
                <div>
                  <h3 className="text-base font-bold text-white">Safety Verification Code</h3>
                  <p className="text-[11px] text-zinc-400">Confirm private direct connection</p>
                </div>
              </div>
              <button
                onClick={() => setIsSafetyModalOpen(false)}
                className="w-8 h-8 rounded-lg text-zinc-400 hover:text-white flex items-center justify-center hover:bg-white/[0.06] transition-colors cursor-pointer"
                aria-label="Close"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <p className="text-xs text-zinc-300 leading-relaxed">
              Compare this security code with <strong className="text-white">{currentRoom.name}</strong> or scan each other's QR code in person to guarantee your chat is direct and unintercepted.
            </p>

            {/* Real safety code derived from both device keys — never a placeholder. */}
            {safetyBlocks ? (
              <div className="p-4 bg-[#141620] border border-white/[0.07] rounded-xl space-y-2">
                <div className="g-label">Safety code</div>
                <div className="grid grid-cols-3 gap-2 font-mono text-center text-sm font-bold text-emerald-400">
                  {safetyBlocks.slice(0, 6).map((block, index) => (
                    <span key={`${block}-${index}`} className="p-2 bg-[#090a0e] rounded-lg border border-white/10">
                      {block}
                    </span>
                  ))}
                </div>
              </div>
            ) : (
              <div className="p-4 bg-[#141620] border border-white/[0.07] rounded-xl">
                <p className="text-[11px] text-zinc-400 leading-relaxed">
                  This conversation's device keys are not both available on this device yet, so no safety
                  code can be shown. It will appear once the other person's identity key has been loaded.
                </p>
              </div>
            )}

            <div className="flex flex-col sm:flex-row items-center justify-between gap-2.5 pt-2">
              {onOpenQR && currentRoom.type === 'direct' && (
                <button
                  onClick={() => {
                    setIsSafetyModalOpen(false);
                    onOpenQR(currentRoom.peerName || currentRoom.name);
                  }}
                  className="g-btn g-btn--quiet w-full sm:flex-1 !min-h-[42px] !text-[12px] text-[#C9A24D]"
                >
                  <QrCode className="w-4 h-4 text-[#C9A24D]" />
                  <span>Scan QR Key</span>
                </button>
              )}

              <button
                onClick={() => {
                  setIsPeerVerified((prev) => ({ ...prev, [currentRoom.id]: true }));
                  setIsSafetyModalOpen(false);
                }}
                disabled={!safetyBlocks}
                title={safetyBlocks ? 'I compared this code in person' : 'No safety code available to compare yet'}
                className="g-btn g-btn--amber w-full sm:flex-1 !min-h-[42px] !text-[12px] disabled:opacity-50 disabled:cursor-not-allowed"
              >
                <Check className="w-4 h-4" />
                <span>Mark Verified</span>
              </button>
            </div>
          </div>
        </div>
      )}
      {currentRoom && currentRoom.type === 'direct' && (
        <SharePlaceSheet
          isOpen={showSharePlace}
          onClose={() => setShowSharePlace(false)}
          peerName={currentRoom.peerName || currentRoom.name}
          userLocation={userLocation ?? null}
          onSend={async (text) => { await onSendMessage(currentRoom.id, text, currentRoom.ephemeralTtlSeconds); }}
        />
      )}
      {currentRoom && currentRoom.type === 'direct' && onSendAlbum && (
        <AlbumPickerSheet
          isOpen={showAlbumPicker}
          onClose={() => setShowAlbumPicker(false)}
          peerName={currentRoom.peerName || currentRoom.name}
          onSend={async (album, expiresAt) => {
            const me = (await supabase?.auth.getSession())?.data.session?.user.id;
            if (!me) throw new Error('Please sign in again.');
            const { shareId, payload } = await createShare(me, album, currentRoom.id, expiresAt);
            const messageId = crypto.randomUUID();
            try { await onSendAlbum(currentRoom.id, payload, messageId); }
            catch (error) { await revokeShare(shareId).catch(() => undefined); throw error; }
            await linkShareMessage(shareId, messageId);
          }}
        />
      )}
      {currentRoom && currentRoom.type === 'direct' && onSendNote && (
        <NoteRecorder
          isOpen={noteRecorder !== null}
          peerName={currentRoom.peerName || currentRoom.name}
          initialKind={noteRecorder?.kind}
          onClose={() => setNoteRecorder(null)}
          onSend={(note) => onSendNote(currentRoom.id, note)}
        />
      )}
    </div>
      {currentRoom?.type === 'gathering' && (
        <GroupMembersSheet
          isOpen={showMembers}
          onClose={() => { setShowMembers(false); setMemberFocus(null); }}
          title={currentRoom.name}
          members={memberFocus ? groupMembers.filter((m) => m.userId === memberFocus || m.isHost) : groupMembers}
          event={groupEvent}
          onMessage={messageMember}
          onViewProfile={viewMember}
        />
      )}
    </div>
  );
};