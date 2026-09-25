import React, { useState } from 'react';
import { SocialStory, DatingProfile } from '../types';
import { 
  Eye, 
  MessageSquare, 
  MapPin, 
  X, 
  Plus, 
  Sparkles, 
  Coffee, 
  Flame, 
  Wine, 
  Footprints, 
  Compass,
  CheckCircle2,
  Lock,
  ArrowRight
} from 'lucide-react';
import { hapticLight, triggerVibration } from '../services/hapticService';

interface StoriesTrayProps {
  stories: SocialStory[];
  onOpenDirectChatWithProfile: (profile: DatingProfile) => void;
  onGazeAtPeer: (peerName: string) => void;
  datingProfiles: DatingProfile[];
  onOpenSetIntent?: () => void;
}

export const StoriesTray: React.FC<StoriesTrayProps> = ({
  stories,
  onOpenDirectChatWithProfile,
  onGazeAtPeer,
  datingProfiles,
  onOpenSetIntent,
}) => {
  const [activeStory, setActiveStory] = useState<SocialStory | null>(null);
  const [gazedStoryIds, setGazedStoryIds] = useState<Set<string>>(new Set());

  const handleOpenStory = (story: SocialStory) => {
    hapticLight();
    setActiveStory(story);
  };

  const handleGazeInStory = (story: SocialStory) => {
    triggerVibration([50, 80]);
    setGazedStoryIds((prev) => new Set(prev).add(story.id));
    onGazeAtPeer(story.peerName);
  };

  const handleReplyInChat = (story: SocialStory) => {
    const peer = datingProfiles.find(
      (p) => p.name.toLowerCase() === story.peerName.toLowerCase() || p.id === story.peerId
    );
    if (peer) {
      onOpenDirectChatWithProfile(peer);
      setActiveStory(null);
    }
  };

  return (
    <>
      {/* Horizontal Stories Tray */}
      <div className="flex items-center gap-3 overflow-x-auto no-scrollbar py-1 px-0.5">
        {/* User's Add Story / Live Moment button */}
        <button
          onClick={onOpenSetIntent}
          className="flex flex-col items-center gap-1.5 shrink-0 group focus:outline-none cursor-pointer"
          aria-label="Post your intent moment"
        >
          <div className="relative w-14 h-14 rounded-2xl bg-[#141620] border-2 border-dashed border-white/20 group-hover:border-[#C9A24D] flex items-center justify-center transition-all">
            <Plus className="w-5 h-5 text-zinc-400 group-hover:text-[#C9A24D]" />
            <span className="absolute -bottom-1 -right-1 w-5 h-5 rounded-full bg-[#C9A24D] text-black text-xs font-bold flex items-center justify-center shadow-md">
              +
            </span>
          </div>
          <span className="text-[11px] font-medium text-zinc-400 group-hover:text-white truncate max-w-[60px]">
            Your Status
          </span>
        </button>

        {/* Peer Stories */}
        {stories.map((story) => {
          const isPrivate = story.category === 'private' || story.category === 'spicy';
          return (
            <button
              key={story.id}
              onClick={() => handleOpenStory(story)}
              className="flex flex-col items-center gap-1.5 shrink-0 group focus:outline-none cursor-pointer"
              aria-label={`View story from ${story.peerName}`}
            >
              <div
                className={`relative w-14 h-14 rounded-2xl p-0.5 transition-transform group-hover:scale-105 active:scale-95 ${
                  isPrivate
                    ? 'bg-gradient-to-tr from-[#6F3CC3] via-purple-600 to-[#C9A24D] shadow-sm shadow-purple-950/40'
                    : 'bg-gradient-to-tr from-[#C9A24D] to-amber-200 shadow-sm shadow-amber-950/30'
                }`}
              >
                <div className="w-full h-full rounded-[14px] overflow-hidden bg-[#090a0e] relative">
                  <img
                    src={story.avatarUrl}
                    alt={story.peerName}
                    referrerPolicy="no-referrer"
                    className="w-full h-full object-cover object-center"
                  />
                  <div className="absolute inset-0 bg-black/15 group-hover:bg-transparent transition-colors" />
                </div>

                {/* Intent icon badge */}
                <div
                  className={`absolute -bottom-1 -right-1 w-4 h-4 rounded-full flex items-center justify-center text-[9px] shadow border border-[#090a0e] ${
                    isPrivate ? 'bg-[#6F3CC3] text-white' : 'bg-[#C9A24D] text-black font-bold'
                  }`}
                >
                  {story.intent.includes('Hookup') && <Flame className="w-2.5 h-2.5" />}
                  {story.intent === 'Meet' && <Coffee className="w-2.5 h-2.5" />}
                  {story.intent === 'Drinks' && <Wine className="w-2.5 h-2.5" />}
                  {story.intent === 'Date' && <Sparkles className="w-2.5 h-2.5" />}
                  {story.intent === 'Chat' && <Compass className="w-2.5 h-2.5" />}
                  {story.intent === 'Group' && <Sparkles className="w-2.5 h-2.5" />}
                </div>
              </div>

              <span className="text-[11px] font-medium text-zinc-300 group-hover:text-white truncate max-w-[62px]">
                {story.peerName}
              </span>
            </button>
          );
        })}
      </div>

      {/* Story Viewer Modal */}
      {activeStory && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-4 bg-black/90 backdrop-blur-md animate-in fade-in">
          <div className="relative w-full max-w-sm h-[580px] bg-[#090a0e] border border-white/10 rounded-3xl overflow-hidden shadow-2xl flex flex-col justify-between">
            {/* Background Story Image */}
            <div className="absolute inset-0 z-0">
              <img
                src={activeStory.photoUrl}
                alt={activeStory.peerName}
                referrerPolicy="no-referrer"
                className="w-full h-full object-cover object-center"
              />
              <div className="absolute inset-0 bg-gradient-to-b from-black/80 via-black/20 to-black/95" />
            </div>

            {/* Top Bar: Peer info, time, category badge, and close */}
            <div className="relative z-10 p-4 flex items-center justify-between">
              <div className="flex items-center gap-2.5">
                <img
                  src={activeStory.avatarUrl}
                  alt={activeStory.peerName}
                  className="w-9 h-9 rounded-xl border border-white/30 object-cover"
                />
                <div>
                  <div className="flex items-center gap-1.5">
                    <span className="text-sm font-bold text-white tracking-tight">
                      {activeStory.peerName}
                    </span>
                    <span
                      className={`text-[10px] px-1.5 py-0.5 rounded font-bold uppercase tracking-wider ${
                        (activeStory.category === 'private' || activeStory.category === 'spicy')
                          ? 'bg-[#6F3CC3]/80 text-purple-200 border border-purple-500/40'
                          : 'bg-[#C9A24D]/25 text-[#C9A24D] border border-[#C9A24D]/40'
                      }`}
                    >
                      {(activeStory.category === 'private' || activeStory.category === 'spicy') ? 'Private' : 'Social'} · {activeStory.intent}
                    </span>
                  </div>
                  <div className="text-[11px] text-zinc-300 flex items-center gap-1">
                    <MapPin className="w-3 h-3 text-[#C9A24D]" />
                    <span className="truncate max-w-[170px]">{activeStory.locationName}</span>
                  </div>
                </div>
              </div>

              <button
                onClick={() => setActiveStory(null)}
                className="w-10 h-10 min-h-[44px] min-w-[44px] rounded-full bg-black/60 hover:bg-black/90 text-white flex items-center justify-center transition-colors cursor-pointer"
                aria-label="Close story"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {/* Bottom Section: Caption & Immediate Actionable Controls */}
            <div className="relative z-10 p-5 space-y-4">
              {/* Caption */}
              <div className="bg-black/60 backdrop-blur-md p-3.5 rounded-2xl border border-white/10">
                <p className="text-sm text-white leading-relaxed font-medium">
                  "{activeStory.caption}"
                </p>
              </div>

              {/* Action Buttons: Gaze (👀) + Direct Reply Message */}
              <div className="grid grid-cols-2 gap-2.5">
                <button
                  onClick={() => handleGazeInStory(activeStory)}
                  className={`h-12 min-h-[48px] rounded-xl flex items-center justify-center gap-2 text-xs font-bold transition-all cursor-pointer ${
                    gazedStoryIds.has(activeStory.id)
                      ? 'bg-purple-950/80 text-purple-300 border border-purple-500/60 shadow-md'
                      : 'bg-[#171922]/90 hover:bg-[#202330] text-white border border-white/15 active:scale-95'
                  }`}
                >
                  <Eye className="w-4 h-4 text-[#C9A24D]" />
                  <span>{gazedStoryIds.has(activeStory.id) ? 'Gazed! 👀' : 'Gaze 👀'}</span>
                </button>

                <button
                  onClick={() => handleReplyInChat(activeStory)}
                  className="h-12 min-h-[48px] rounded-xl bg-[#C9A24D] hover:bg-[#b58f3b] text-black font-bold text-xs flex items-center justify-center gap-2 shadow-lg transition-all active:scale-95 cursor-pointer"
                >
                  <MessageSquare className="w-4 h-4" />
                  <span>Message</span>
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </>
  );
};
