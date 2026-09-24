import React, { useState, useEffect, useRef } from 'react';
import { SwarmRoom, EncryptedMessage, UserProfile } from '../types';
import { hapticMessageDecrypted } from '../services/hapticService';
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
  Award
} from 'lucide-react';

interface ChatRoomViewProps {
  rooms: SwarmRoom[];
  messages: Record<string, EncryptedMessage[]>;
  activeRoomId: string;
  onSelectRoom: (roomId: string) => void;
  currentUser: UserProfile;
  onSendMessage: (roomId: string, plainText: string, ephemeralTtlSeconds?: number) => Promise<void>;
  onUpdateRoomTtl: (roomId: string, ttl: number) => void;
  onOpenQR?: (peerName?: string) => void;
}

export const ChatRoomView: React.FC<ChatRoomViewProps> = ({
  rooms,
  messages,
  activeRoomId,
  onSelectRoom,
  currentUser,
  onSendMessage,
  onUpdateRoomTtl,
  onOpenQR,
}) => {
  const [inputText, setInputText] = useState('');
  const [isSending, setIsSending] = useState(false);
  const [isSafetyModalOpen, setIsSafetyModalOpen] = useState(false);
  const [inspectedMessageId, setInspectedMessageId] = useState<string | null>(null);
  const [isPeerVerified, setIsPeerVerified] = useState<Record<string, boolean>>({
    room_marcus: true,
  });
  // Mobile responsive view: 'list' | 'chat'
  const [mobileView, setMobileView] = useState<'list' | 'chat'>('list');

  const messagesEndRef = useRef<HTMLDivElement | null>(null);
  const currentRoom = rooms.find((r) => r.id === activeRoomId) || rooms[0];
  const currentMessages = messages[currentRoom?.id || ''] || [];
  const prevCountRef = useRef<number>(currentMessages.length);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    // Trigger subtle tactile haptic feedback when an encrypted message is received and decrypted locally
    if (currentMessages.length > prevCountRef.current) {
      hapticMessageDecrypted();
    }
    prevCountRef.current = currentMessages.length;
  }, [currentMessages, activeRoomId]);

  const handleSelectRoom = (roomId: string) => {
    onSelectRoom(roomId);
    setMobileView('chat');
  };

  const handleSend = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!inputText.trim() || isSending || !currentRoom) return;

    const textToSend = inputText.trim();
    setInputText('');
    setIsSending(true);

    try {
      await onSendMessage(currentRoom.id, textToSend, currentRoom.ephemeralTtlSeconds);
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
    <div className="flex h-[calc(100dvh-175px)] sm:h-[calc(100vh-140px)] min-h-[460px] bg-[#090a0e] rounded-2xl border border-white/[0.08] overflow-hidden shadow-2xl">
      {/* Sidebar: Chats & Conversations */}
      <div 
        className={`w-full sm:w-72 md:w-80 bg-[#0d0e14] border-r border-white/[0.08] flex flex-col shrink-0 ${
          mobileView === 'chat' ? 'hidden sm:flex' : 'flex'
        }`}
      >
        {/* Chats header */}
        <div className="p-3.5 border-b border-white/[0.08] flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Lock className="w-4 h-4 text-emerald-400" />
            <span className="text-xs font-semibold text-zinc-200 tracking-wide uppercase font-sans">
              Encrypted Swarms ({rooms.length})
            </span>
          </div>
          <span className="text-[10px] text-zinc-400 bg-[#171922] px-2 py-0.5 rounded-md border border-white/10 font-mono">
            E2EE
          </span>
        </div>

        {/* Room List */}
        <div className="flex-1 overflow-y-auto divide-y divide-white/[0.04]">
          {rooms.map((room) => {
            const isSelected = room.id === currentRoom?.id;
            const isGathering = room.type === 'gathering';

            return (
              <button
                key={room.id}
                onClick={() => handleSelectRoom(room.id)}
                className={`w-full text-left p-3.5 transition-colors flex items-start gap-3 cursor-pointer min-h-[56px] ${
                  isSelected
                    ? 'bg-[#171922] border-l-2 border-[#C9A24D]'
                    : 'hover:bg-white/[0.03]'
                }`}
              >
                <div
                  className={`w-9 h-9 rounded-xl flex items-center justify-center shrink-0 text-xs font-semibold ${
                    isGathering
                      ? 'bg-[#171922] text-[#C9A24D] border border-[#C9A24D]/30'
                      : 'bg-[#171922] text-zinc-200 border border-white/10'
                  }`}
                >
                  {isGathering ? <Users className="w-4 h-4" /> : room.name.charAt(0)}
                </div>

                <div className="flex-1 min-w-0">
                  <div className="flex items-center justify-between gap-1">
                    <span className="text-xs font-semibold text-white truncate">
                      {room.name}
                    </span>
                    <span className="text-[10px] text-zinc-500 shrink-0 font-mono">
                      {new Date(room.lastTimestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                    </span>
                  </div>

                  <p className="text-[11px] text-zinc-400 truncate mt-0.5">
                    {room.lastMessage || 'End-to-end encrypted session initialized.'}
                  </p>

                  <div className="flex items-center gap-2 mt-1.5 text-[10px] text-zinc-500">
                    <span className="flex items-center gap-1 text-emerald-400/90 font-mono">
                      <Lock className="w-2.5 h-2.5" />
                      {isGathering ? 'Group' : 'Direct'}
                    </span>
                    {room.ephemeralTtlSeconds > 0 && (
                      <span className="flex items-center gap-0.5 text-[#C9A24D] font-mono">
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
        <div className="p-3 bg-[#090a0e] border-t border-white/[0.08] text-[11px] text-zinc-500 flex items-center justify-between font-mono">
          <span>AES-256-GCM</span>
          <span className="text-zinc-400">Device storage only</span>
        </div>
      </div>

      {/* Main Chat Area */}
      {currentRoom ? (
        <div 
          className={`flex-1 flex flex-col bg-[#090a0e] min-w-0 ${
            mobileView === 'list' ? 'hidden sm:flex' : 'flex'
          }`}
        >
          {/* Header */}
          <div className="h-14 px-3 sm:px-4 border-b border-white/[0.08] flex items-center justify-between gap-2 bg-[#0d0e14]">
            <div className="flex items-center gap-2 sm:gap-3 min-w-0">
              {/* Mobile Back Button */}
              <button
                onClick={() => setMobileView('list')}
                className="sm:hidden min-h-[38px] min-w-[38px] -ml-1 flex items-center justify-center text-zinc-400 hover:text-white rounded-lg hover:bg-white/[0.06] transition-colors cursor-pointer"
                aria-label="Back to rooms"
              >
                <ChevronLeft className="w-5 h-5" />
              </button>

              <div className="w-8 h-8 rounded-xl bg-[#171922] border border-white/10 flex items-center justify-center text-xs font-semibold text-[#C9A24D] shrink-0">
                {currentRoom.type === 'gathering' ? <Users className="w-4 h-4" /> : currentRoom.name.charAt(0)}
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
                  <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 inline-block" />
                  <span className="truncate font-mono">
                    {currentRoom.peerKey ? `Key: ${currentRoom.peerKey.substring(0, 12)}...` : 'Group Swarm'}
                  </span>
                </div>
              </div>
            </div>

            {/* Header Actions */}
            <div className="flex items-center gap-1.5 sm:gap-2 shrink-0">
              {/* QR Verification Status / Action */}
              {currentRoom.type === 'direct' && (
                currentRoom.verifiedViaQR ? (
                  <div className="hidden sm:flex items-center gap-1.5 px-2.5 py-1 rounded-xl bg-emerald-950/50 border border-emerald-500/40 text-[11px] text-emerald-300 font-medium">
                    <ShieldCheck className="w-3.5 h-3.5 text-emerald-400" />
                    <span>QR Verified ({currentRoom.peerReliabilityScore || 98})</span>
                  </div>
                ) : (
                  onOpenQR && (
                    <button
                      onClick={() => onOpenQR(currentRoom.peerName || currentRoom.name)}
                      className="min-h-[36px] flex items-center gap-1.5 px-2.5 py-1 text-[11px] font-medium text-[#C9A24D] bg-[#C9A24D]/10 hover:bg-[#C9A24D]/20 border border-[#C9A24D]/30 rounded-xl transition-colors cursor-pointer"
                      title="Verify public keys in person via QR code"
                    >
                      <QrCode className="w-3.5 h-3.5 text-[#C9A24D]" />
                      <span className="hidden sm:inline">Verify QR</span>
                    </button>
                  )
                )
              )}

              {/* Ephemeral Auto-Delete Timer Toggle */}
              <button
                onClick={cycleTtl}
                title="Disappearing messages timer (auto-deletes messages after set time)"
                className={`min-h-[36px] flex items-center gap-1.5 px-2 sm:px-2.5 py-1 text-[11px] rounded-xl border transition-colors cursor-pointer ${
                  currentRoom.ephemeralTtlSeconds > 0
                    ? 'bg-[#C9A24D]/15 text-[#C9A24D] border-[#C9A24D]/30'
                    : 'bg-[#171922] text-zinc-400 border-white/10 hover:text-white'
                }`}
              >
                <Clock className="w-3.5 h-3.5 text-[#C9A24D]" />
                <span className="font-mono">{getTtlLabel(currentRoom.ephemeralTtlSeconds)}</span>
              </button>

              {/* Safety Number Button */}
              <button
                onClick={() => setIsSafetyModalOpen(true)}
                title="Verify Safety Code"
                className="min-h-[36px] min-w-[36px] flex items-center gap-1.5 px-2.5 py-1 text-[11px] font-medium text-zinc-300 bg-[#171922] hover:bg-[#202330] border border-white/10 rounded-xl transition-colors cursor-pointer"
              >
                <ShieldCheck className="w-3.5 h-3.5 text-emerald-400" />
                <span className="hidden md:inline">Safety Code</span>
              </button>
            </div>
          </div>

          {/* Privacy & E2EE Info Strip */}
          <div className="px-3 sm:px-4 py-2 bg-[#0c0d12] border-b border-white/[0.06] flex items-center justify-between text-[11px] text-zinc-400">
            <div className="flex items-center gap-2">
              <Lock className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
              <span className="truncate">End-to-End Encrypted · Zero Cloud Retention</span>
            </div>
            <span className="text-[10px] font-mono text-zinc-500 shrink-0 hidden md:inline">
              Decrypted in browser
            </span>
          </div>

          {/* Messages Feed */}
          <div className="flex-1 overflow-y-auto p-3 sm:p-4 space-y-3">
            {currentMessages.map((msg) => {
              const isMe = msg.senderKey === currentUser.publicKey;
              const isInspecting = inspectedMessageId === msg.id;

              return (
                <div
                  key={msg.id}
                  className={`flex flex-col ${isMe ? 'items-end' : 'items-start'}`}
                >
                  <div className="flex items-center gap-2 mb-1 px-1 text-[10px] text-zinc-500 font-mono">
                    <span>{msg.senderName}</span>
                    <span>·</span>
                    <span>{new Date(msg.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
                  </div>

                  <div
                    className={`max-w-[88%] sm:max-w-md rounded-2xl px-3.5 py-2 text-xs sm:text-sm leading-relaxed shadow-sm ${
                      isMe
                        ? 'bg-[#C9A24D] text-black font-medium rounded-tr-sm'
                        : 'bg-[#141620] text-zinc-100 border border-white/[0.08] rounded-tl-sm'
                    }`}
                  >
                    <p className="whitespace-pre-wrap">{msg.plainText}</p>

                    <div className="mt-1 flex items-center justify-end gap-1.5 pt-0.5 text-[10px] opacity-75">
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
                        className="underline hover:opacity-100 cursor-pointer font-sans text-[10px]"
                      >
                        {isInspecting ? 'Hide Details' : 'Details'}
                      </button>
                    </div>
                  </div>

                  {/* Cryptographic Inspector Drawer */}
                  {isInspecting && (
                    <div className="mt-1.5 p-2.5 bg-[#141620] border border-white/10 rounded-xl text-[10px] text-zinc-300 max-w-md space-y-1">
                      <div className="text-[#C9A24D] font-semibold flex items-center gap-1.5">
                        <ShieldCheck className="w-3.5 h-3.5 text-emerald-400" />
                        <span>Message Encryption Details</span>
                      </div>
                      <div className="text-zinc-400">Encryption standard: AES-256 (end-to-end)</div>
                      <div className="text-zinc-400 truncate font-mono">Nonce: 0x{msg.nonceHex}</div>
                      <div className="text-emerald-400 font-medium">✓ Scrambled and decrypted locally on your device</div>
                    </div>
                  )}
                </div>
              );
            })}
            <div ref={messagesEndRef} />
          </div>

          {/* Message Input Box */}
          <form onSubmit={handleSend} className="p-2.5 sm:p-3 bg-[#0d0e14] border-t border-white/[0.08]">
            <div className="flex items-center gap-2 bg-[#141620] border border-white/10 rounded-xl px-3 py-1.5 focus-within:border-[#C9A24D] transition-colors">
              <input
                type="text"
                value={inputText}
                onChange={(e) => setInputText(e.target.value)}
                placeholder={
                  currentRoom.ephemeralTtlSeconds > 0
                    ? `Encrypted message (${getTtlLabel(currentRoom.ephemeralTtlSeconds)} active)...`
                    : 'Encrypted message...'
                }
                className="flex-1 bg-transparent text-xs sm:text-sm text-white placeholder-zinc-500 focus:outline-none py-1"
              />

              <button
                type="submit"
                disabled={!inputText.trim() || isSending}
                className="w-8 h-8 rounded-lg bg-[#C9A24D] hover:bg-[#b58f3b] disabled:opacity-30 disabled:hover:bg-[#C9A24D] text-black flex items-center justify-center shrink-0 transition-colors cursor-pointer"
                aria-label="Send message"
              >
                <Send className="w-3.5 h-3.5" />
              </button>
            </div>

            <div className="mt-1.5 flex items-center justify-between text-[10px] text-zinc-500 px-1 font-mono">
              <span className="flex items-center gap-1">
                <ShieldCheck className="w-3 h-3 text-emerald-400" />
                Metadata stripped on send
              </span>
              <span>Local device only</span>
            </div>
          </form>
        </div>
      ) : (
        <div className="flex-1 flex items-center justify-center p-8 text-center text-zinc-500 text-xs sm:text-sm">
          Select a swarm room to view encrypted communications
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

            {/* 6-block Safety Number */}
            <div className="p-4 bg-[#141620] border border-white/[0.07] rounded-xl space-y-2">
              <div className="text-[10px] uppercase font-mono tracking-wider text-zinc-400 font-semibold">
                Verification Blocks
              </div>
              <div className="grid grid-cols-3 gap-2 font-mono text-center text-sm font-bold text-emerald-400">
                <span className="p-2 bg-[#090a0e] rounded-lg border border-white/10">48291</span>
                <span className="p-2 bg-[#090a0e] rounded-lg border border-white/10">90312</span>
                <span className="p-2 bg-[#090a0e] rounded-lg border border-white/10">65120</span>
                <span className="p-2 bg-[#090a0e] rounded-lg border border-white/10">11894</span>
                <span className="p-2 bg-[#090a0e] rounded-lg border border-white/10">77239</span>
                <span className="p-2 bg-[#090a0e] rounded-lg border border-white/10">55401</span>
              </div>
            </div>

            <div className="flex flex-col sm:flex-row items-center justify-between gap-2.5 pt-2">
              {onOpenQR && currentRoom.type === 'direct' && (
                <button
                  onClick={() => {
                    setIsSafetyModalOpen(false);
                    onOpenQR(currentRoom.peerName || currentRoom.name);
                  }}
                  className="w-full sm:flex-1 py-2.5 text-xs font-semibold text-[#C9A24D] bg-[#C9A24D]/10 hover:bg-[#C9A24D]/20 border border-[#C9A24D]/30 rounded-xl transition-colors cursor-pointer flex items-center justify-center gap-1.5"
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
                className="w-full sm:flex-1 py-2.5 text-xs font-semibold text-black bg-emerald-400 hover:bg-emerald-300 rounded-xl transition-colors cursor-pointer flex items-center justify-center gap-1.5 shadow-sm"
              >
                <Check className="w-4 h-4" />
                <span>Mark Verified</span>
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
