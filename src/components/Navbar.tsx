import React from 'react';
import { 
  Shield, 
  Eye, 
  EyeOff, 
  Radio, 
  Calendar, 
  Lock, 
  MessageSquare, 
  MapPin, 
  Compass,
  CheckCircle2,
  AlertTriangle,
  Heart,
  Users,
  QrCode,
  Flame
} from 'lucide-react';

interface NavbarProps {
  activeTab: 'dating' | 'right_now' | 'later' | 'swarms' | 'safe_havens';
  onTabChange: (tab: 'dating' | 'right_now' | 'later' | 'swarms' | 'safe_havens') => void;
  unreadCount: number;
  onOpenMask: () => void;
  onOpenIdentity: () => void;
  onOpenSafetyTimer: () => void;
  isSafetyTimerActive: boolean;
  onOpenQR: () => void;
  reliabilityScore?: number;
}

export const Navbar: React.FC<NavbarProps> = ({
  activeTab,
  onTabChange,
  unreadCount,
  onOpenMask,
  onOpenIdentity,
  onOpenSafetyTimer,
  isSafetyTimerActive,
  onOpenQR,
  reliabilityScore,
}) => {
  return (
    <>
      {/* Top App Header */}
      <header className={`sticky top-0 z-40 w-full transition-colors ${
        activeTab === 'right_now'
          ? 'bg-[#090a0e]/75 backdrop-blur-xl border-b border-white/[0.06]'
          : 'bg-[#090a0e]/95 backdrop-blur-md border-b border-white/[0.07]'
      }`}>
        <div className="max-w-7xl mx-auto px-3.5 sm:px-6 h-14 flex items-center justify-between gap-2 sm:gap-4">
          
          {/* Brand Wordmark & Neighborhood Tag */}
          <div className="flex items-center gap-2 sm:gap-3 shrink-0">
            <button
              onClick={() => onTabChange('dating')}
              className="flex items-center gap-2.5 group text-left cursor-pointer focus:outline-none"
              aria-label="GAYZE Home"
            >
              <div className="w-8 h-8 rounded-lg bg-[#141620] border border-white/10 flex items-center justify-center text-white group-hover:border-[#C9A24D]/50 transition-colors">
                <span className="font-bold text-sm tracking-tight text-[#C9A24D]">G</span>
              </div>
              <div className="flex items-baseline gap-1.5">
                <span className="text-base sm:text-lg font-bold tracking-wider text-white uppercase font-sans">
                  GAYZE
                </span>
                <span className="hidden xs:inline text-[11px] font-medium text-zinc-400">
                  · Soho
                </span>
              </div>
            </button>

            {/* Subtle E2EE Security Tag (Desktop) */}
            <div className="hidden lg:flex items-center gap-1.5 pl-3 border-l border-white/[0.08] text-[11px] text-zinc-400 font-mono">
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-400" />
              <span>P2P ENCRYPTED</span>
            </div>
          </div>

          {/* Desktop Navigation Tabs (Hidden on Mobile) */}
          <nav className="hidden md:flex items-center gap-1 bg-[#11131a] p-1 rounded-xl border border-white/[0.07]">
            <button
              onClick={() => onTabChange('dating')}
              className={`flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg transition-colors cursor-pointer ${
                activeTab === 'dating'
                  ? 'text-white bg-[#1c1f2b] border border-white/10 shadow-sm'
                  : 'text-zinc-400 hover:text-white hover:bg-white/[0.04]'
              }`}
            >
              <Heart className={`w-3.5 h-3.5 ${activeTab === 'dating' ? 'text-[#C9A24D] fill-[#C9A24D]' : 'text-zinc-400'}`} />
              <span>Discover</span>
            </button>

            <button
              onClick={() => onTabChange('right_now')}
              className={`flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg transition-colors cursor-pointer ${
                activeTab === 'right_now'
                  ? 'text-white bg-[#221634] border border-[#6F3CC3]/60 shadow-[0_0_14px_rgba(111,60,195,0.4)]'
                  : 'text-zinc-400 hover:text-white hover:bg-white/[0.04]'
              }`}
            >
              <Radio className={`w-3.5 h-3.5 ${activeTab === 'right_now' ? 'text-[#C9A24D] animate-pulse' : 'text-zinc-400'}`} />
              <span className={activeTab === 'right_now' ? 'text-white font-bold' : ''}>Right Now</span>
            </button>

            <button
              onClick={() => onTabChange('later')}
              className={`flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg transition-colors cursor-pointer ${
                activeTab === 'later'
                  ? 'text-white bg-[#1c1f2b] border border-white/10 shadow-sm'
                  : 'text-zinc-400 hover:text-white hover:bg-white/[0.04]'
              }`}
            >
              <Calendar className={`w-3.5 h-3.5 ${activeTab === 'later' ? 'text-[#C9A24D]' : 'text-zinc-400'}`} />
              <span>Later</span>
            </button>

            <button
              onClick={() => onTabChange('swarms')}
              className={`relative flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg transition-colors cursor-pointer ${
                activeTab === 'swarms'
                  ? 'text-white bg-[#1c1f2b] border border-white/10 shadow-sm'
                  : 'text-zinc-400 hover:text-white hover:bg-white/[0.04]'
              }`}
            >
              <MessageSquare className="w-3.5 h-3.5 text-zinc-400" />
              <span>Groups</span>
              {unreadCount > 0 && (
                <span className="w-2 h-2 rounded-full bg-[#C9A24D] inline-block ml-0.5" />
              )}
            </button>

            <button
              onClick={() => onTabChange('safe_havens')}
              className={`flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg transition-colors cursor-pointer ${
                activeTab === 'safe_havens'
                  ? 'text-white bg-[#1c1f2b] border border-white/10 shadow-sm'
                  : 'text-zinc-400 hover:text-white hover:bg-white/[0.04]'
              }`}
            >
              <Shield className={`w-3.5 h-3.5 ${activeTab === 'safe_havens' ? 'text-emerald-400' : 'text-zinc-400'}`} />
              <span>Safe Havens</span>
            </button>
          </nav>

          {/* Action Utilities (Both Mobile & Desktop) */}
          <div className="flex items-center gap-1.5 sm:gap-2 shrink-0">
            {/* Safety Check-in Timer Beacon */}
            <button
              onClick={onOpenSafetyTimer}
              title="Safety Timer Beacon"
              aria-label="Safety Check-in Timer"
              className={`h-9 px-2.5 sm:px-3 flex items-center gap-1.5 text-xs font-medium rounded-xl border transition-all cursor-pointer ${
                isSafetyTimerActive
                  ? 'bg-rose-950/50 text-rose-300 border-rose-500/60 shadow-sm shadow-rose-950 animate-pulse'
                  : 'bg-[#11131a] text-zinc-300 border-white/[0.08] hover:border-white/20 hover:text-white'
              }`}
            >
              <Shield className={`w-3.5 h-3.5 ${isSafetyTimerActive ? 'text-rose-400' : 'text-emerald-400'}`} />
              <span className="text-[11px] sm:text-xs font-medium">
                {isSafetyTimerActive ? 'Beacon Active' : 'Safety'}
              </span>
            </button>

            {/* QR Group Key Exchanger */}
            <button
              onClick={onOpenQR}
              title="Group QR Code & Key Exchange"
              aria-label="QR Code Key Exchange"
              className="h-9 px-2.5 sm:px-3 flex items-center gap-1.5 text-xs font-medium bg-[#11131a] hover:bg-[#171922] border border-white/[0.08] hover:border-[#C9A24D]/40 text-zinc-300 hover:text-white rounded-xl transition-all cursor-pointer"
            >
              <QrCode className="w-3.5 h-3.5 text-[#C9A24D]" />
              <span className="hidden sm:inline text-xs">Verify</span>
              {reliabilityScore && (
                <span className="text-[10px] font-mono text-emerald-400 font-semibold bg-emerald-950/60 px-1.5 py-0.5 rounded border border-emerald-700/40">
                  {reliabilityScore}
                </span>
              )}
            </button>

            {/* Discreet Mask / Panic Disguise */}
            <button
              onClick={onOpenMask}
              title="Discreet Disguise (Esc)"
              aria-label="Toggle Discreet Mask"
              className="h-9 px-2.5 flex items-center gap-1.5 text-xs font-medium text-zinc-400 bg-[#11131a] hover:bg-[#171922] border border-white/[0.08] rounded-xl hover:text-white transition-all cursor-pointer"
            >
              <EyeOff className="w-3.5 h-3.5" />
              <span className="hidden sm:inline text-xs">Mask</span>
            </button>

            {/* User Identity Key Avatar */}
            <button
              onClick={onOpenIdentity}
              title="Your Identity Key"
              aria-label="Open Identity Settings"
              className="h-9 w-9 rounded-xl bg-[#141620] border border-white/[0.10] hover:border-white/25 flex items-center justify-center text-zinc-200 transition-all cursor-pointer font-mono text-xs font-semibold"
            >
              JK
            </button>
          </div>
        </div>
      </header>

      {/* Mobile Fixed Bottom Tab Bar (Thumb Zone) */}
      <nav 
        className={`md:hidden fixed bottom-0 left-0 right-0 z-40 transition-colors pb-safe shadow-2xl ${
          activeTab === 'right_now'
            ? 'bg-[#090a0e]/75 backdrop-blur-xl border-t border-white/[0.07]'
            : 'bg-[#090a0e]/95 backdrop-blur-xl border-t border-white/[0.08]'
        }`}
        aria-label="Mobile Navigation"
      >
        <div className="grid grid-cols-5 h-14 items-center px-1">
          {/* Tab 1: Discover / Dating */}
          <button
            onClick={() => onTabChange('dating')}
            className={`min-h-[44px] flex flex-col items-center justify-center py-1 transition-colors cursor-pointer ${
              activeTab === 'dating' ? 'text-[#C9A24D] font-semibold' : 'text-zinc-400 hover:text-zinc-200'
            }`}
          >
            <Heart className={`w-4 h-4 mb-0.5 ${activeTab === 'dating' ? 'fill-[#C9A24D] text-[#C9A24D]' : ''}`} />
            <span className="text-[10px] tracking-tight">Discover</span>
          </button>

          {/* Tab 2: Right Now */}
          <button
            onClick={() => onTabChange('right_now')}
            className={`min-h-[44px] flex flex-col items-center justify-center py-1 transition-all cursor-pointer relative ${
              activeTab === 'right_now' ? 'text-[#C9A24D] font-bold' : 'text-zinc-400 hover:text-zinc-200'
            }`}
          >
            <div className="relative flex items-center justify-center">
              <Radio className={`w-4 h-4 mb-0.5 ${activeTab === 'right_now' ? 'text-[#C9A24D]' : ''}`} />
              {activeTab === 'right_now' && (
                <span className="absolute -top-0.5 -right-1 w-1.5 h-1.5 rounded-full bg-[#6F3CC3] ring-1 ring-[#C9A24D] animate-ping" />
              )}
            </div>
            <span className="text-[10px] tracking-tight">Right Now</span>
            {activeTab === 'right_now' && (
              <span className="absolute bottom-0.5 w-4 h-0.5 rounded-full bg-[#C9A24D] shadow-[0_0_6px_#C9A24D]" />
            )}
          </button>

          {/* Tab 3: Later */}
          <button
            onClick={() => onTabChange('later')}
            className={`min-h-[44px] flex flex-col items-center justify-center py-1 transition-colors cursor-pointer ${
              activeTab === 'later' ? 'text-[#C9A24D] font-semibold' : 'text-zinc-400 hover:text-zinc-200'
            }`}
          >
            <Calendar className="w-4 h-4 mb-0.5" />
            <span className="text-[10px] tracking-tight">Later</span>
          </button>

          {/* Tab 4: Groups */}
          <button
            onClick={() => onTabChange('swarms')}
            className={`relative min-h-[44px] flex flex-col items-center justify-center py-1 transition-colors cursor-pointer ${
              activeTab === 'swarms' ? 'text-white font-semibold' : 'text-zinc-400 hover:text-zinc-200'
            }`}
          >
            <div className="relative">
              <MessageSquare className="w-4 h-4 mb-0.5" />
              {unreadCount > 0 && (
                <span className="absolute -top-0.5 -right-1 w-2 h-2 rounded-full bg-[#C9A24D]" />
              )}
            </div>
            <span className="text-[10px] tracking-tight">Groups</span>
          </button>

          {/* Tab 5: Safe Havens */}
          <button
            onClick={() => onTabChange('safe_havens')}
            className={`min-h-[44px] flex flex-col items-center justify-center py-1 transition-colors cursor-pointer ${
              activeTab === 'safe_havens' ? 'text-emerald-400 font-semibold' : 'text-zinc-400 hover:text-zinc-200'
            }`}
          >
            <Shield className="w-4 h-4 mb-0.5" />
            <span className="text-[10px] tracking-tight">Havens</span>
          </button>
        </div>
      </nav>
    </>
  );
};


