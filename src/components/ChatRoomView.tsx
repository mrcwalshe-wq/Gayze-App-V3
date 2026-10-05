import { PeerIntentBanner } from './PeerIntentBanner';
import { beginChatTrace, traceChat, countChatWork } from '../services/chatTrace';
import type { ChatConnectionState } from '../services/realtimeRecovery';
import React, { useState, useEffect, useLayoutEffect, useMemo, useRef } from 'react';
import { SwarmRoom, EncryptedMessage, UserProfile, MeetingProposal, TopLevelIntentMode } from '../types';
import { hapticMessageDecrypted, hapticLight, hapticSensitiveAction } from '../services/hapticService';
import {
  Lock,
  ShieldCheck,
  Send,
  Clock,
  Flame,
  Key,
  Check,
  Info,
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
  MoreHorizontal,
  Trash2
} from 'lucide-react';
import { preparePhotoAttachment } from '../services/supabaseService';
import { getProfilePhotoUrl } from '../services/profilePhotoService';

interface ChatRoomViewProps {
  rooms: SwarmRoom[];
  messages: Record<string, EncryptedMessage[]>;
  activeRoomId: string;
  openRequest?: { roomId: string; sequence: number } | null;
  onVisibleRoomChange?: (roomId: string | null) => void;
  onSelectRoom: (roomId: string) => void;
  currentUser: UserProfile;
  /** Authenticated Supabase user id; live message sender_id values use this, not the device public-key fingerprint. */
  currentUserId?: string | null;
  onSendMessage: (roomId: string, plainText: string, ephemeralTtlSeconds?: number, meetingData?: MeetingProposal, mediaUrl?: string, messageId?: string) => Promise<void>;
  onUpdateRoomTtl: (roomId: string, ttl: number) => void;
  /** Removes only the current user's membership; resolves once the backend confirms. */
  onDeleteChat?: (roomId: string) => Promise<void>;
  onOpenQR?: (peerName?: string) => void;
  onStartCall?: (peerName: string, callType: 'audio' | 'video', targetUserId?: string, peerAvatar?: string) => void;
  onOpenScheduleMeeting?: (peerName: string) => void;
  onAcceptMeeting?: (meeting: MeetingProposal) => void;
  onReturnToDiscovery?: () => void;
  onlineUserIds?: Set<string>;
  connectionState?: ChatConnectionState;
  /** True when no conversation key could be resolved on this device. */
  conversationKeyUnavailable?: boolean;
  conversationKeyReason?: string;
  /** Current GAYZE mode controls the live chat border hue. */
  activeIntentMode?: TopLevelIntentMode;
}

export const ChatRoomView: React.FC<ChatRoomViewProps> = ({
  rooms,
  messages,
  activeRoomId,
  openRequest,
  onVisibleRoomChange,
  onSelectRoom,
  currentUser,
  currentUserId,
  onSendMessage,
  onUpdateRoomTtl,
  onDeleteChat,
  onOpenQR,
  onStartCall,
  onOpenScheduleMeeting,
  onAcceptMeeting,
  onReturnToDiscovery,
  onlineUserIds,
  connectionState,
  conversationKeyUnavailable = false,
  conversationKeyReason,
  activeIntentMode,
}) => {
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
  const [isSending, setIsSending] = useState(false);
  const pendingSend = useRef<{ draft: string; id: string } | null>(null);
  const [sendError, setSendError] = useState<string | null>(null);
  const [isSafetyModalOpen, setIsSafetyModalOpen] = useState(false);
  const [inspectedMessageId, setInspectedMessageId] = useState<string | null>(null);
  const [attachedMedia, setAttachedMedia] = useState<string | null>(null);
  const [zoomedMediaUrl, setZoomedMediaUrl] = useState<string | null>(null);
  const [showChatActions, setShowChatActions] = useState(false);
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
  // An explicit target may still be hydrating: never show/send to another peer.
  const currentRoom = activeRoomId ? rooms.find((r) => r.id === activeRoomId) : undefined;
  const visibleRoomId = currentRoom && (wideLayout || mobileView === 'chat') ? currentRoom.id : null;
  useLayoutEffect(() => {
    onVisibleRoomChange?.(visibleRoomId);
    return () => onVisibleRoomChange?.(null);
  }, [visibleRoomId, onVisibleRoomChange]);
  const currentMessages = useMemo(() => (messages[currentRoom?.id || ''] || [])
    .filter((message) => !message.isBurned && (!message.expiresAt || message.expiresAt > now)), [messages, currentRoom?.id, now]);
  const [historyWindow, setHistoryWindow] = useState({ roomId: activeRoomId, count: 100 });
  const visibleCount = historyWindow.roomId === activeRoomId ? historyWindow.count : 100;
  const visibleMessages = currentMessages.slice(-visibleCount);
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
    if (!changedRoom && previous.id && lastMessageId !== previous.id && nearBottomRef.current) hapticMessageDecrypted();
    previousTailRef.current = { room: activeRoomId, id: lastMessageId };
  }, [activeRoomId, lastMessageId, visibleCount]);

  const handleSelectRoom = (roomId: string) => {
    hapticLight();
    onSelectRoom(roomId);
    setMobileView('chat');
  };

  const handlePhotoSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      const dataUrl = await preparePhotoAttachment(file);
      setAttachedMedia(dataUrl);
    } catch (err: any) {
      console.warn('[GAYZE] Photo attachment error:', err);
    }
  };

  const handleSend = async (e: React.FormEvent) => {
    e.preventDefault();
    if ((!inputText.trim() && !attachedMedia) || isSending || !currentRoom) return;

    const textToSend = inputText.trim() || (attachedMedia ? 'Shared a photo' : '');
    const mediaToSend = attachedMedia || undefined;

    const draft = JSON.stringify([currentUserId, currentRoom.id, textToSend, mediaToSend, currentRoom.ephemeralTtlSeconds]);
    if (pendingSend.current?.draft !== draft) pendingSend.current = { draft, id: crypto.randomUUID() };
    setSendError(null);
    setIsSending(true);

    try {
      await onSendMessage(currentRoom.id, textToSend, currentRoom.ephemeralTtlSeconds, undefined, mediaToSend, pendingSend.current.id);
      pendingSend.current = null;
      setInputText('');
      setAttachedMedia(null);
    } catch {
      setSendError('Send not confirmed. Your draft is kept; retrying this draft will not send it twice.');
    } finally {
      setIsSending(false);
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

  return (
    <div className="flex flex-col h-full min-h-0">
      {connectionState && (
        <div role="status" aria-live="polite" className="shrink-0 px-3 py-1 text-[11px] text-zinc-400">
          {{ connecting: 'Connecting to messages…', syncing: 'Recovering messages…', connected: 'Live · messages synced', reconnecting: 'Connection interrupted — reconnecting…', offline: 'Offline — messages will sync when you reconnect', suspended: 'Messages paused while the app is in the background', 'sign-in-required': 'Your session has ended. Sign in again to reconnect.' }[connectionState]}
        </div>
      )}
    <div className="gayze-chat-shell flex flex-1 min-h-0 bg-[#090a0e] rounded-2xl border border-white/[0.08] overflow-hidden shadow-2xl">
      {/* Sidebar: Chats & Conversations */}
      <div
        data-testid="conversation-list"
        className={`gayze-chat-sidebar w-full sm:w-72 md:w-80 bg-[#0d0e14] border-r border-white/[0.08] flex flex-col shrink-0 ${mobileView === 'chat' ? 'hidden sm:flex' : 'flex'
          }`}
      >
        {/* Chats header */}
        <div className="p-3.5 border-b border-white/[0.08] flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Lock className="w-4 h-4 text-emerald-400" />
            <span className="text-[15px] font-extrabold text-white tracking-tight">
              Messages
            </span>
            {rooms.length > 0 && (
              <span className="text-[11px] text-zinc-500 font-mono">{rooms.length}</span>
            )}
          </div>
          <span className="flex items-center gap-1.5 text-[10.5px] text-zinc-500 font-medium">
            <Lock className="w-3 h-3 text-emerald-400" />
            Encrypted
          </span>
        </div>

        {/* Room List */}
        <div className="flex-1 overflow-y-auto divide-y divide-white/[0.04]">
          {rooms.length === 0 && (
            <div className="p-6 text-center">
              <p className="text-[13px] font-bold text-white">No messages yet</p>
              <p className="text-[11.5px] text-zinc-500 mt-1 leading-relaxed">
                Conversations open automatically when interest is mutual on an intent.
              </p>
            </div>
          )}
          {rooms.map((room) => {
            const isSelected = room.id === currentRoom?.id;
            const isGathering = room.type === 'gathering';
            const roomAvatar = room.peerAvatar && room.peerAvatar !== 'user'
              ? (avatarUrls[room.peerAvatar] || (room.peerAvatar.startsWith('http') ? room.peerAvatar : null))
              : null;

            return (
              <button
                key={room.id}
                onClick={() => handleSelectRoom(room.id)}
                className={`w-full text-left p-3.5 transition-colors flex items-start gap-3 cursor-pointer min-h-[56px] ${isSelected
                  ? 'bg-[#15131f] border-l-2 border-[#7b48d1]'
                  : 'hover:bg-white/[0.03]'
                  }`}
              >
                <div
                  className={`w-9 h-9 rounded-xl flex items-center justify-center shrink-0 text-xs font-semibold overflow-hidden ${isGathering
                    ? 'bg-[#171922] text-[#C9A24D] border border-[#C9A24D]/30'
                    : 'bg-[#171922] text-zinc-200 border border-white/10'
                    }`}
                >
                  {isGathering ? (
                    <Users className="w-4 h-4" />
                  ) : roomAvatar ? (
                    <img src={roomAvatar} alt="" className="w-full h-full object-cover" />
                  ) : (
                    room.name.charAt(0)
                  )}
                </div>

                <div className="flex-1 min-w-0">
                  <div className="flex items-center justify-between gap-1">
                    <span className="text-xs font-semibold text-white truncate">
                      {room.name}
                    </span>
                    <span className="text-[11px] text-zinc-500 shrink-0 font-mono">
                      {new Date(room.lastTimestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                    </span>
                  </div>

                  <p className="text-[11px] text-zinc-400 truncate mt-0.5">
                    {room.lastMessage || 'No messages yet — encrypted on this device.'}
                  </p>

                  <div className="flex items-center gap-2 mt-1.5 text-[10px] text-zinc-500">
                    <span className="flex items-center gap-1 text-emerald-400/90 font-mono">
                      <Lock className="w-2.5 h-2.5" />
                      {isGathering ? 'Group' : 'Direct'}
                    </span>
                    {room.ephemeralTtlSeconds > 0 && (
                      <span className="flex items-center gap-0.5 text-[#c4a9f7] font-mono">
                        <Flame className="w-2.5 h-2.5" />
                        {getTtlLabel(room.ephemeralTtlSeconds)}
                      </span>
                    )}
                  </div>
                </div>
              </button>
            );
          })}
        </div>

        {/* Footnote */}
        <div className="p-3 bg-[#090a0e] border-t border-white/[0.08] text-[11px] text-zinc-600 flex items-center gap-1.5">
          <Lock className="w-3 h-3 text-emerald-400/80" />
          <span>Encrypted on device · auto-delete per chat</span>
        </div>
      </div>

      {/* Main Chat Area */}
      {currentRoom ? (
        <div data-testid="conversation-pane" data-room-id={currentRoom.id}
          className={`flex-1 flex flex-col bg-[#090a0e] min-w-0 min-h-0 ${mobileView === 'list' ? 'hidden sm:flex' : 'flex'
            }`}
        >
          {/* Header */}
          <div className="gayze-chat-header shrink-0 h-14 px-3 sm:px-4 border-b border-white/[0.08] flex items-center justify-between gap-2 bg-[#0d0e14]">
            <div className="flex items-center gap-2 sm:gap-3 min-w-0">
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

              <div className="w-8 h-8 rounded-xl bg-[#171922] border border-white/10 flex items-center justify-center text-xs font-semibold text-[#C9A24D] shrink-0 overflow-hidden">
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

              <div className="min-w-0">
                <div className="flex items-center gap-1.5">
                  <h2 className="text-xs sm:text-sm font-bold text-white truncate">{currentRoom.name}</h2>
                  {currentRoom.type === 'direct' && isPeerVerified[currentRoom.id] && (
                    <span title="Safety Fingerprint Verified" className="shrink-0 inline-flex">
                      <ShieldCheck className="w-3.5 h-3.5 text-emerald-400" />
                    </span>
                  )}
                </div>
                <div className="text-[10px] text-zinc-400 truncate flex items-center gap-1.5">
                  {currentRoom.peerUserId && onlineUserIds?.has(currentRoom.peerUserId) ? (
                    <>
                      <span className="w-1.5 h-1.5 rounded-full bg-[#C9A24D] inline-block g-breathe" />
                      <span className="text-[#C9A24D] font-semibold font-mono">Online now</span>
                    </>
                  ) : (
                    <>
                      <span className="w-1.5 h-1.5 rounded-full bg-zinc-500 inline-block" />
                      <span className="truncate font-mono">
                        {currentRoom.type === 'direct'
                          ? (currentRoom.peerLastSeenAt
                            ? 'Last seen ' + new Date(currentRoom.peerLastSeenAt).toLocaleString([], { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })
                            : 'Last seen unavailable')
                          : 'Group conversation'}
                      </span>
                    </>
                  )}
                </div>
              </div>
            </div>

            {/* Header Actions — keep the direct actions quiet; secondary controls live in one menu on mobile. */}
            <div className="flex items-center gap-1 shrink-0">
              {currentRoom.type === 'direct' && onStartCall && (
                <button
                  onClick={() => onStartCall(currentRoom.peerName || currentRoom.name, 'video', currentRoom.peerUserId, currentRoom.peerAvatar)}
                  className="g-icon-btn"
                  title="Video call"
                  aria-label="Start video call"
                >
                  <Video className="w-4 h-4 text-[#c4a9f7]" />
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
                  <div className="absolute right-0 top-11 z-40 w-52 g-panel p-1.5 shadow-2xl">
                    {currentRoom.type === 'direct' && onStartCall && (
                      <button
                        type="button"
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
                    {currentRoom.type === 'direct' && onOpenScheduleMeeting && (
                      <button
                        type="button"
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
                      className="g-row !min-h-[42px] !rounded-xl"
                      onClick={() => {
                        setShowChatActions(false);
                        setIsSafetyModalOpen(true);
                      }}
                    >
                      <ShieldCheck className="w-4 h-4 text-emerald-400" />
                      <span className="text-[12px]">Verify safety code</span>
                    </button>
                    {onDeleteChat && (
                      <button
                        type="button"
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

          {visibleRoomId && currentRoom.type === 'direct' && currentUserId && currentRoom.peerUserId && (
            <PeerIntentBanner key={`${currentUserId}/${currentRoom.id}/${currentRoom.peerUserId}`}
              userId={currentUserId} peerId={currentRoom.peerUserId}
              peerName={currentRoom.peerName || currentRoom.name} now={now} />
          )}

          {conversationKeyUnavailable && (
            <div className="px-3 sm:px-4 py-2 bg-amber-500/10 border-b border-amber-500/25 text-[11px] text-amber-200">
              {conversationKeyReason || 'This conversation cannot be decrypted on this device yet.'}
            </div>
          )}

          {currentRoom.connectionContext && (
            <div className="px-3 sm:px-4 py-2 border-b border-white/[0.06] flex items-center justify-between gap-2 text-[11px]">
              <span className="min-w-0 truncate text-zinc-300">
                <span className="text-[#C9A24D] font-semibold">Connected via</span>{' '}
                {currentRoom.connectionContext.replace(/^Connected via\s*/i, '')}
              </span>
              {onReturnToDiscovery && (
                <button
                  type="button"
                  onClick={onReturnToDiscovery}
                  className="min-h-[44px] px-2 flex items-center gap-1 text-[#C9A24D] hover:text-white shrink-0 cursor-pointer"
                >
                  <MapPin className="w-3.5 h-3.5" />
                  <span>Map</span>
                </button>
              )}
            </div>
          )}

          {/* Messages Feed */}
          <div ref={feedRef} className="flex-1 overflow-y-auto p-3 sm:p-4 space-y-3"
            onScroll={() => { const feed = feedRef.current; if (feed) nearBottomRef.current = feed.scrollHeight - feed.scrollTop - feed.clientHeight < 100; }}>
            {currentMessages.length > visibleCount && (
              <button type="button" className="block mx-auto min-h-[44px] text-xs text-[#C9A24D]" onClick={() => {
                const feed = feedRef.current;
                if (feed) scrollAnchorRef.current = { height: feed.scrollHeight, top: feed.scrollTop };
                setHistoryWindow({ roomId: activeRoomId, count: visibleCount + 100 });
              }}>Show older messages</button>
            )}
            {visibleMessages.map((msg) => {
              const isMe = currentUserId
                ? msg.senderKey === currentUserId
                : msg.senderKey === currentUser.publicKey;
              const isInspecting = inspectedMessageId === msg.id;

              return (
                <div
                  key={msg.id}
                  className={`flex flex-col ${isMe ? 'items-end' : 'items-start'}`}
                >
                  <div className="flex items-center gap-2 mb-1 px-1 text-[11px] text-zinc-500">
                    <span>{msg.senderName}</span>
                    <span>·</span>
                    <span>{new Date(msg.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
                  </div>

                  <div
                    className={`max-w-[88%] sm:max-w-md rounded-2xl px-3.5 py-2 text-xs sm:text-sm leading-relaxed border transition-colors ${
                      activeIntentMode === 'private'
                        ? isMe
                          ? 'g-bubble--mine rounded-tr-sm !border-[#6F3CC3]/65 shadow-[0_0_18px_rgba(111,60,195,0.10)]'
                          : 'bg-[#141620] text-zinc-100 rounded-tl-sm !border-[#6F3CC3]/45'
                        : activeIntentMode === 'social'
                          ? isMe
                            ? 'g-bubble--mine rounded-tr-sm !border-[#C9A24D]/65 shadow-[0_0_18px_rgba(201,162,77,0.10)]'
                            : 'bg-[#141620] text-zinc-100 rounded-tl-sm !border-[#C9A24D]/45'
                          : isMe
                            ? 'g-bubble--mine rounded-tr-sm border-white/10'
                            : 'bg-[#141620] text-zinc-100 rounded-tl-sm border-white/[0.08]'
                    }`}
                  >
                    {/* Encrypted Photo Attachment if present */}
                    {msg.mediaUrl && (
                      <div className="mb-2 rounded-xl overflow-hidden border border-black/10 bg-black/40 max-h-60">
                        <img
                          src={msg.mediaUrl}
                          alt="Encrypted attachment"
                          className="w-full h-full object-cover cursor-pointer hover:opacity-95 transition-opacity"
                          onClick={() => setZoomedMediaUrl(msg.mediaUrl || null)}
                        />
                      </div>
                    )}

                    <p className="whitespace-pre-wrap">{msg.plainText}</p>

                    {/* Rich Meeting Proposal Card if present */}
                    {msg.meetingData && (
                      <div className="mt-2.5 p-3 rounded-xl bg-black/40 border border-white/15 text-left text-xs space-y-2">
                        <div className="flex items-center justify-between gap-2">
                          <div className="flex items-center gap-1.5 font-medium text-white text-[12px]">
                            <Calendar className="w-3.5 h-3.5 text-[#C9A24D]" />
                            <span>Safe Meetup Invitation</span>
                          </div>
                          <span className={`text-[11px] px-2 py-0.5 rounded-full capitalize ${msg.meetingData.status === 'accepted'
                            ? 'bg-emerald-500/12 text-emerald-300 border border-emerald-500/25'
                            : 'bg-[#C9A24D]/12 text-[#C9A24D] border border-[#C9A24D]/25'
                            }`}>
                            {msg.meetingData.status}
                          </span>
                        </div>

                        <div className="space-y-0.5 text-zinc-200">
                          <div className="font-medium flex items-center gap-1">
                            <Coffee className="w-3.5 h-3.5 text-[#C9A24D]" />
                            <span>{msg.meetingData.venueName}</span>
                          </div>
                          <div className="text-[11px] text-zinc-300 flex items-center gap-1">
                            <MapPin className="w-3 h-3 text-zinc-400" />
                            <span>{msg.meetingData.address}</span>
                          </div>
                          <div className="text-[11px] text-[#C9A24D] flex items-center gap-1">
                            <Clock className="w-3 h-3" />
                            <span>{msg.meetingData.timeStr}</span>
                          </div>
                        </div>

                        {!isMe && msg.meetingData.status === 'proposed' && onAcceptMeeting && (
                          <button
                            type="button"
                            onClick={() => onAcceptMeeting(msg.meetingData!)}
                            className="g-btn g-btn--amber w-full mt-1.5 !min-h-[40px] !text-[12px]"
                          >
                            <ShieldCheck className="w-3.5 h-3.5" />
                            <span>Accept & Start Local Check-in</span>
                          </button>
                        )}
                      </div>
                    )}

                    <div className="mt-1 flex items-center justify-end gap-1.5 pt-0.5 text-[11px] opacity-70">
                      <Lock className="w-2.5 h-2.5" />
                      <button
                        type="button"
                        onClick={() => {
                          const next = isInspecting ? null : msg.id;
                          setInspectedMessageId(next);
                          if (next) {
                            hapticMessageDecrypted();
                          }
                        }}
                        className="underline hover:opacity-100 cursor-pointer text-[11px]"
                      >
                        {isInspecting ? 'Hide Details' : 'Details'}
                      </button>
                    </div>
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
                  <span className="text-emerald-400/90 text-[10.5px]">Encrypted on send</span>
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

            <div className="flex items-center gap-2 bg-[#141620] border border-white/10 rounded-xl px-3 py-1.5 focus-within:border-[#6F3CC3]/60 transition-colors">
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
                disabled={conversationKeyUnavailable || isSending}
                onChange={(e) => setInputText(e.target.value)}
                placeholder={currentRoom.ephemeralTtlSeconds > 0 ? `Message · ${getTtlLabel(currentRoom.ephemeralTtlSeconds).replace('Auto-delete: ', '')}` : 'Message…'}
                className="flex-1 bg-transparent text-xs sm:text-sm text-white placeholder-zinc-500 focus:outline-none py-1"
              />

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
                disabled={(!inputText.trim() && !attachedMedia) || isSending}
                className="g-icon-btn g-icon-btn--send shrink-0"
                aria-label="Send message"
              >
                <Send className="w-3.5 h-3.5" />
              </button>
            </div>

            <div className="mt-1.5 flex items-center gap-1 text-[10px] text-zinc-600 px-1">
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
    </div>
    </div>
  );
};
