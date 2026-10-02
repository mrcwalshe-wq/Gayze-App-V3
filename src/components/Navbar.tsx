import React from 'react';
import { GayzeLogo } from './GayzeLogo';
import {
  Shield,
  EyeOff,
  Compass,
  Radio,
  Clock,
  MessageSquare,
  UserRound,
} from 'lucide-react';

export type NavTab = 'dating' | 'right_now' | 'later' | 'swarms' | 'safe_havens' | 'profile';

interface NavbarProps {
  activeTab: NavTab;
  onTabChange: (tab: NavTab) => void;
  unreadCount: number;
  notificationCount?: number;
  onOpenMask: () => void;
  onOpenIdentity: () => void;
  onOpenSafetyTimer: () => void;
  isSafetyTimerActive: boolean;
  onOpenQR: () => void;
  reliabilityScore?: number;
  userNeighborhood?: string;
}

interface TabDef {
  id: NavTab;
  label: string;
  icon: React.ReactNode;
  /** Nav item that lights up for sub-views (e.g. Safe Havens lives under Profile). */
  group: NavTab;
}

const TABS: TabDef[] = [
  { id: 'dating', label: 'Discover', icon: <Compass />, group: 'dating' },
  { id: 'right_now', label: 'Right Now', icon: <Radio />, group: 'right_now' },
  { id: 'later', label: 'Later', icon: <Clock />, group: 'later' },
  { id: 'swarms', label: 'Messages', icon: <MessageSquare />, group: 'swarms' },
  { id: 'profile', label: 'Profile', icon: <UserRound />, group: 'profile' },
];

/**
 * GAYZE navigation — five destinations, nothing more.
 * Mobile: bottom tab bar only (map stays full-bleed; views own their headers).
 * Desktop: one translucent top bar.
 */
export const Navbar: React.FC<NavbarProps> = ({
  activeTab,
  onTabChange,
  unreadCount,
  notificationCount = 0,
  onOpenMask,
  onOpenSafetyTimer,
  isSafetyTimerActive,
  userNeighborhood,
}) => {
  // Safe Havens is a Profile/safety sub-view — highlight Profile while inside it.
  const activeGroup =
    activeTab === 'safe_havens' ? 'profile' : (activeTab as NavTab);

  return (
    <>
      {/* ---------------- Desktop top bar ---------------- */}
      <header className="g-desktop-header hidden md:block">
        <div className="g-desktop-header__inner">
          <button
            onClick={() => onTabChange('dating')}
            className="flex items-center gap-2.5 group cursor-pointer"
            aria-label="GAYZE home"
          >
            <GayzeLogo size={30} showWordmark={false} />
            <span className="text-[14.5px] font-semibold tracking-[0.12em] text-white">
              GAYZE
            </span>
            <span className="hidden lg:inline text-[11px] text-zinc-500 font-normal pl-2.5 ml-1 border-l border-white/10">
              {userNeighborhood || 'Near you'}
            </span>
          </button>

          <nav className="g-navpill" aria-label="Primary">
            {TABS.map((tab) => (
              <button
                key={tab.id}
                onClick={() => onTabChange(tab.id)}
                data-active={activeGroup === tab.group}
                className="g-navpill__btn"
              >
                <span className="[&>svg]:w-[15px] [&>svg]:h-[15px]">{tab.icon}</span>
                <span>{tab.label}</span>
                {((tab.id === 'swarms' && unreadCount > 0) || (tab.id === 'profile' && notificationCount > 0)) && (
                  <span className="w-1.5 h-1.5 rounded-full bg-[#C9A24D]" aria-label={tab.id === 'profile' ? `${notificationCount} unread notifications` : `${unreadCount} unread messages`} />
                )}
              </button>
            ))}
          </nav>

          <div className="flex items-center gap-2">
            <button
              onClick={onOpenSafetyTimer}
              title="Safety check-in"
              aria-label="Safety check-in"
              className={`g-btn !min-h-[36px] !px-3 !text-[11.5px] ${
                isSafetyTimerActive ? 'g-btn--danger-quiet' : 'g-btn--ghost'
              }`}
            >
              <Shield className={`w-3.5 h-3.5 ${isSafetyTimerActive ? 'text-rose-400' : 'text-emerald-400'}`} />
              <span className="hidden lg:inline">{isSafetyTimerActive ? 'Check-in active' : 'Safety'}</span>
            </button>

            <button
              onClick={onOpenMask}
              title="Discreet mask (Esc)"
              aria-label="Toggle discreet mask"
              className="g-btn g-btn--ghost !min-h-[36px] !px-3 !text-[11.5px]"
            >
              <EyeOff className="w-3.5 h-3.5" />
              <span className="hidden lg:inline">Mask</span>
            </button>

            <button
              onClick={() => onTabChange('profile')}
              aria-label="Open profile"
              title="Profile"
              className="w-9 h-9 rounded-[12px] bg-[#16182a] border border-white/10 hover:border-[#6F3CC3]/60 flex items-center justify-center text-zinc-200 transition-colors cursor-pointer"
            >
              <UserRound className="w-4 h-4 text-[#b796f0]" />
            </button>
          </div>
        </div>
      </header>

      {/* ---------------- Mobile bottom tab bar ---------------- */}
      <nav className="g-tabbar md:hidden" aria-label="Primary">
        <div className="g-tabbar__inner">
          {TABS.map((tab) => {
            const isActive = activeGroup === tab.group;
            return (
              <button
                key={tab.id}
                className="g-tab"
                data-active={isActive}
                aria-current={isActive ? 'page' : undefined}
                onClick={() => onTabChange(tab.id)}
              >
                <span className="g-tab__ind" />
                <span className="[&>svg]:w-5 [&>svg]:h-5">{tab.icon}</span>
                <span>{tab.label}</span>
                {((tab.id === 'swarms' && unreadCount > 0) || (tab.id === 'profile' && notificationCount > 0)) && (
                  <span className="g-tab__badge" aria-label={tab.id === 'profile' ? `${notificationCount} unread notifications` : `${unreadCount} unread messages`} />
                )}
              </button>
            );
          })}
        </div>
      </nav>
    </>
  );
};
