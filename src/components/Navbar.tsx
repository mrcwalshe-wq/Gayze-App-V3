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
  QrCode
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
      <header className="sticky top-0 z-40 w-full bg-[#090a0f]/90 backdrop-blur-md border-b border-zinc-800/80 transition-colors">
        <div className="max-w-7xl mx-auto px-3.5 sm:px-6 h-13 sm:h-14 flex items-center justify-between gap-2 sm:gap-4">
          
          {/* Brand Wordmark & Neighborhood */}
          <div className="flex items-center gap-2 sm:gap-3 shrink-0">
            <button
              onClick={() => onTabChange('dating')}
              className="flex items-center gap-2 group text-left cursor-pointer focus:outline-none"
              aria-label="gayze home"
            >
              <div className="w-7 h-7 sm:w-8 sm:h-8 rounded-lg bg-zinc-800 border border-zinc-700/80 flex items-center justify-center text-zinc-100 group-hover:border-zinc-500 transition-colors">
                <Eye className="w-4 h-4 text-amber-400" />
              </div>
              <div className="flex items-baseline gap-1.5">
                <span className="text-lg sm:text-xl font-bold tracking-tight text-white font-sans">
                  gayze
                </span>
                <span className="hidden xs:inline text-[11px] font-medium text-zinc-400">
                  · Soho
                </span>
              </div>
            </button>

            {/* Subtle E2EE Security Tag (Desktop) */}
            <div className="hidden lg:flex items-center gap-1.5 pl-2.5 border-l border-zinc-800 text-[11px] text-zinc-400">
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-500" />
              <span>Encrypted P2P</span>
            </div>
          </div>

          {/* Desktop Navigation Tabs (Hidden on Mobile) */}
          <nav className="hidden md:flex items-center gap-1">
            <button
              onClick={() => onTabChange('dating')}
              className={`flex items-center gap-1.5 px-3 py-1.5 text-xs sm:text-sm font-medium rounded-lg transition-colors cursor-pointer ${
                activeTab === 'dating'
                  ? 'text-white bg-zinc-800 border border-zinc-700/80 shadow-sm'
                  : 'text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800/40'
              }`}
            >
              <Heart className="w-3.5 h-3.5 text-rose-400" />
              <span>Dating</span>
            </button>

            <button
              onClick={() => onTabChange('right_now')}
              className={`flex items-center gap-1.5 px-3 py-1.5 text-xs sm:text-sm font-medium rounded-lg transition-colors cursor-pointer ${
                activeTab === 'right_now'
                  ? 'text-white bg-zinc-800 border border-zinc-700/80 shadow-sm'
                  : 'text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800/40'
              }`}
            >
              <Radio className="w-3.5 h-3.5 text-amber-400" />
              <span>Right Now</span>
            </button>

            <button
              onClick={() => onTabChange('later')}
              className={`flex items-center gap-1.5 px-3 py-1.5 text-xs sm:text-sm font-medium rounded-lg transition-colors cursor-pointer ${
                activeTab === 'later'
                  ? 'text-white bg-zinc-800 border border-zinc-700/80 shadow-sm'
                  : 'text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800/40'
              }`}
            >
              <Calendar className="w-3.5 h-3.5 text-zinc-300" />
              <span>Later</span>
            </button>

            <button
              onClick={() => onTabChange('swarms')}
              className={`relative flex items-center gap-1.5 px-3 py-1.5 text-xs sm:text-sm font-medium rounded-lg transition-colors cursor-pointer ${
                activeTab === 'swarms'
                  ? 'text-white bg-zinc-800 border border-zinc-700/80 shadow-sm'
                  : 'text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800/40'
              }`}
            >
              <MessageSquare className="w-3.5 h-3.5 text-zinc-300" />
              <span>Chats</span>
              {unreadCount > 0 && (
                <span className="w-2 h-2 rounded-full bg-amber-400 inline-block ml-0.5" />
              )}
            </button>

            <button
              onClick={() => onTabChange('safe_havens')}
              className={`flex items-center gap-1.5 px-3 py-1.5 text-xs sm:text-sm font-medium rounded-lg transition-colors cursor-pointer ${
                activeTab === 'safe_havens'
                  ? 'text-white bg-zinc-800 border border-zinc-700/80 shadow-sm'
                  : 'text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800/40'
              }`}
            >
              <Shield className="w-3.5 h-3.5 text-emerald-400" />
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
              className={`min-h-[38px] min-w-[38px] sm:min-h-[36px] flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-medium rounded-lg border transition-colors cursor-pointer ${
                isSafetyTimerActive
                  ? 'bg-rose-950/40 text-rose-300 border-rose-600/50 animate-pulse'
                  : 'bg-zinc-900 text-zinc-300 border-zinc-800 hover:border-zinc-700 hover:text-white'
              }`}
            >
              <Shield className={`w-3.5 h-3.5 ${isSafetyTimerActive ? 'text-rose-400' : 'text-emerald-400'}`} />
              <span className="text-[11px] sm:text-xs">
                {isSafetyTimerActive ? 'Beacon ON' : 'Safety'}
              </span>
            </button>

            {/* QR Swarm Key Exchanger */}
            <button
              onClick={onOpenQR}
              title="Swarm QR Code & Key Exchange"
              aria-label="QR Code Key Exchange"
              className="min-h-[38px] min-w-[38px] sm:min-h-[36px] flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-medium bg-zinc-900 hover:bg-zinc-800 border border-zinc-800 hover:border-amber-500/50 text-zinc-300 hover:text-white rounded-lg transition-colors cursor-pointer"
            >
              <QrCode className="w-3.5 h-3.5 text-amber-400" />
              <span className="hidden sm:inline text-xs">QR Key</span>
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
              className="min-h-[38px] min-w-[38px] sm:min-h-[36px] flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-medium text-zinc-300 bg-zinc-900 hover:bg-zinc-800 border border-zinc-800 rounded-lg hover:text-white transition-colors cursor-pointer"
            >
              <EyeOff className="w-3.5 h-3.5 text-zinc-400" />
              <span className="hidden sm:inline text-xs">Mask</span>
            </button>

            {/* User Identity Key Avatar */}
            <button
              onClick={onOpenIdentity}
              title="Your Swarm Identity Key"
              aria-label="Open Identity Settings"
              className="min-h-[38px] min-w-[38px] sm:min-h-[36px] px-2.5 py-1.5 rounded-lg bg-zinc-900 border border-zinc-800 hover:border-zinc-600 flex items-center justify-center text-zinc-200 transition-colors cursor-pointer font-mono text-xs font-semibold"
            >
              JK
            </button>
          </div>
        </div>
      </header>

      {/* Mobile Fixed Bottom Tab Bar (Thumb Zone) */}
      <nav 
        className="md:hidden fixed bottom-0 left-0 right-0 z-40 bg-[#090a0f]/95 backdrop-blur-xl border-t border-zinc-800/90 pb-safe shadow-lg"
        aria-label="Mobile Navigation"
      >
        <div className="grid grid-cols-5 h-15 items-center px-1">
          {/* Tab 1: Dating */}
          <button
            onClick={() => onTabChange('dating')}
            className={`min-h-[48px] flex flex-col items-center justify-center py-1 transition-colors cursor-pointer ${
              activeTab === 'dating' ? 'text-amber-400 font-semibold' : 'text-zinc-500 hover:text-zinc-300'
            }`}
          >
            <Heart className={`w-4.5 h-4.5 mb-0.5 ${activeTab === 'dating' ? 'fill-amber-400 text-amber-400' : ''}`} />
            <span className="text-[10px] tracking-tight">Dating</span>
          </button>

          {/* Tab 2: Right Now */}
          <button
            onClick={() => onTabChange('right_now')}
            className={`min-h-[48px] flex flex-col items-center justify-center py-1 transition-colors cursor-pointer ${
              activeTab === 'right_now' ? 'text-amber-400 font-semibold' : 'text-zinc-500 hover:text-zinc-300'
            }`}
          >
            <Radio className="w-4.5 h-4.5 mb-0.5" />
            <span className="text-[10px] tracking-tight">Right Now</span>
          </button>

          {/* Tab 3: Later */}
          <button
            onClick={() => onTabChange('later')}
            className={`min-h-[48px] flex flex-col items-center justify-center py-1 transition-colors cursor-pointer ${
              activeTab === 'later' ? 'text-amber-400 font-semibold' : 'text-zinc-500 hover:text-zinc-300'
            }`}
          >
            <Calendar className="w-4.5 h-4.5 mb-0.5" />
            <span className="text-[10px] tracking-tight">Later</span>
          </button>

          {/* Tab 4: Swarms */}
          <button
            onClick={() => onTabChange('swarms')}
            className={`relative min-h-[48px] flex flex-col items-center justify-center py-1 transition-colors cursor-pointer ${
              activeTab === 'swarms' ? 'text-amber-400 font-semibold' : 'text-zinc-500 hover:text-zinc-300'
            }`}
          >
            <div className="relative">
              <MessageSquare className="w-4.5 h-4.5 mb-0.5" />
              {unreadCount > 0 && (
                <span className="absolute -top-0.5 -right-1 w-2 h-2 rounded-full bg-amber-400" />
              )}
            </div>
            <span className="text-[10px] tracking-tight">Chats</span>
          </button>

          {/* Tab 5: Safe Havens */}
          <button
            onClick={() => onTabChange('safe_havens')}
            className={`min-h-[48px] flex flex-col items-center justify-center py-1 transition-colors cursor-pointer ${
              activeTab === 'safe_havens' ? 'text-emerald-400 font-semibold' : 'text-zinc-500 hover:text-zinc-300'
            }`}
          >
            <Shield className="w-4.5 h-4.5 mb-0.5" />
            <span className="text-[10px] tracking-tight">Havens</span>
          </button>
        </div>
      </nav>
    </>
  );
};

