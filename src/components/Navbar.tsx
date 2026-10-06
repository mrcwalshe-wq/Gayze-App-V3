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
import { hapticLight } from '../services/hapticService';

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
  group: NavTab;
}

const TABS: TabDef[] = [
  { id: 'later', label: 'Later', icon: <Clock />, group: 'later' },
  { id: 'right_now', label: 'Right Now', icon: <Radio />, group: 'right_now' },
  { id: 'dating', label: 'Discover', icon: <Compass />, group: 'dating' },
  { id: 'swarms', label: 'Messages', icon: <MessageSquare />, group: 'swarms' },
  { id: 'profile', label: 'Profile', icon: <UserRound />, group: 'profile' },
];

const playGayzePressAnimation = (button: HTMLButtonElement) => {
  const action = button.querySelector<HTMLElement>('.g-discover-action');
  const logo = button.querySelector<HTMLImageElement>('.g-discover-logo-image');

  if (window.matchMedia('(prefers-reduced-motion: reduce)').matches || !action?.animate) return;

  action.getAnimations().forEach((animation) => animation.cancel());
  logo?.getAnimations().forEach((animation) => animation.cancel());

  action.animate(
    [
      {
        transform: 'scale(1)',
        boxShadow:
          '0 0 0 1px rgba(111,60,195,.28), 0 0 22px rgba(111,60,195,.34), 0 12px 30px rgba(0,0,0,.58), inset 0 1px 0 rgba(255,255,255,.12)',
      },
      {
        transform: 'scale(.92)',
        boxShadow:
          '0 0 0 2px rgba(201,162,77,.48), 0 0 34px rgba(111,60,195,.58), 0 8px 24px rgba(0,0,0,.62), inset 0 1px 0 rgba(255,255,255,.18)',
        offset: 0.18,
      },
      {
        transform: 'scale(1.07)',
        boxShadow:
          '0 0 0 7px rgba(139,92,246,.16), 0 0 54px rgba(201,162,77,.46), 0 16px 34px rgba(0,0,0,.58), inset 0 1px 0 rgba(255,255,255,.22)',
        offset: 0.48,
      },
      {
        transform: 'scale(1)',
        boxShadow:
          '0 0 0 1px rgba(111,60,195,.28), 0 0 28px rgba(111,60,195,.40), 0 12px 30px rgba(0,0,0,.58), inset 0 1px 0 rgba(255,255,255,.12)',
      },
    ],
    { duration: 520, easing: 'cubic-bezier(.22,1,.36,1)', fill: 'none' },
  );

  logo?.animate(
    [
      { transform: 'translate(-50%, -50%) scale(1)', filter: 'drop-shadow(0 0 8px rgba(212,59,222,.30))' },
      { transform: 'translate(-50%, -50%) scale(.88)', filter: 'drop-shadow(0 0 5px rgba(212,59,222,.22))', offset: 0.18 },
      { transform: 'translate(-50%, -50%) scale(1.10)', filter: 'drop-shadow(0 0 16px rgba(255,158,44,.62))', offset: 0.48 },
      { transform: 'translate(-50%, -50%) scale(1)', filter: 'drop-shadow(0 0 9px rgba(212,59,222,.36))' },
    ],
    { duration: 520, easing: 'cubic-bezier(.22,1,.36,1)', fill: 'none' },
  );
};

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
  const activeGroup = activeTab === 'safe_havens' ? 'profile' : activeTab;

  const renderTabIcon = (tab: TabDef, mobile = false) => {
    if (tab.id !== 'dating') {
      return (
        <span className={mobile ? '[&>svg]:w-5 [&>svg]:h-5 transition-transform duration-150' : '[&>svg]:w-[15px] [&>svg]:h-[15px]'}>
          {tab.icon}
        </span>
      );
    }

    if (mobile) {
      return (
        <span
          aria-hidden="true"
          className="g-discover-action relative flex items-center justify-center transition-transform duration-200"
        >
          <img
            src="/brand/gayze-nav-v3.svg?v=20261008-4"
            alt=""
            className="g-discover-logo-image object-contain"
            draggable={false}
          />
        </span>
      );
    }

    return (
      <span className="relative flex h-8 w-8 items-center justify-center rounded-xl bg-gradient-to-br from-[#6F3CC3] via-[#8B5CF6] to-[#C9A24D] p-[1px] shadow-[0_0_12px_rgba(111,60,195,0.25)]">
        <span className="g-discover-logo flex h-full w-full items-center justify-center rounded-[11px] bg-[#10121a] p-0">
          <GayzeLogo size={20} showWordmark={false} className="!w-auto" />
        </span>
      </span>
    );
  };

  return (
    <>
      <header className="g-desktop-header hidden md:block">
        <div className="g-desktop-header__inner">
          <button onClick={() => onTabChange('dating')} className="flex items-center gap-2.5 group cursor-pointer" aria-label="GAYZE home">
            <GayzeLogo size={30} showWordmark={false} />
            <span className="text-[14.5px] font-semibold tracking-[0.12em] text-white">GAYZE</span>
            <span className="hidden lg:inline text-[11px] text-zinc-500 font-normal pl-2.5 ml-1 border-l border-white/10">{userNeighborhood || 'Near you'}</span>
          </button>

          <nav className="g-navpill" aria-label="Primary">
            {TABS.map((tab) => (
              <button key={tab.id} onClick={() => { hapticLight(); onTabChange(tab.id); }} data-tab={tab.id} data-active={activeGroup === tab.group} className="g-navpill__btn">
                {renderTabIcon(tab)}
                <span>{tab.label}</span>
                {((tab.id === 'swarms' && unreadCount > 0) || (tab.id === 'profile' && notificationCount > 0)) && (
                  <span className="w-1.5 h-1.5 rounded-full bg-[#C9A24D]" aria-label={tab.id === 'profile' ? `${notificationCount} unread notifications` : `${unreadCount} unread messages`} />
                )}
              </button>
            ))}
          </nav>

          <div className="flex items-center gap-2">
            <button onClick={onOpenSafetyTimer} title="Safety check-in" aria-label="Safety check-in" className={`g-btn !min-h-[36px] !px-3 !text-[11.5px] ${isSafetyTimerActive ? 'g-btn--danger-quiet' : 'g-btn--ghost'}`}>
              <Shield className={`w-3.5 h-3.5 ${isSafetyTimerActive ? 'text-rose-400' : 'text-emerald-400'}`} />
              <span className="hidden lg:inline">{isSafetyTimerActive ? 'Check-in active' : 'Safety'}</span>
            </button>
            <button onClick={onOpenMask} title="Discreet mask (Esc)" aria-label="Toggle discreet mask" className="g-btn g-btn--ghost !min-h-[36px] !px-3 !text-[11.5px]">
              <EyeOff className="w-3.5 h-3.5" />
              <span className="hidden lg:inline">Mask</span>
            </button>
            <button onClick={() => onTabChange('profile')} aria-label="Open profile" title="Profile" className="w-9 h-9 rounded-[12px] bg-[#16182a] border border-white/10 hover:border-[#6F3CC3]/60 flex items-center justify-center text-zinc-200 transition-colors cursor-pointer">
              <UserRound className="w-4 h-4 text-[#b796f0]" />
            </button>
          </div>
        </div>
      </header>

      <nav className="g-tabbar md:hidden" aria-label="Primary">
        <div className="g-tabbar__inner">
          {TABS.map((tab) => {
            const isActive = activeGroup === tab.group;
            const isGayzeAction = tab.id === 'dating';
            return (
              <button
                key={tab.id}
                className={`g-tab ${isGayzeAction ? 'g-tab--discover group' : ''}`}
                data-tab={tab.id}
                data-active={isActive}
                aria-current={isActive ? 'page' : undefined}
                aria-label={isGayzeAction ? 'GAYZE Discover' : tab.label}
                onClick={(event) => {
                  hapticLight();
                  if (isGayzeAction) playGayzePressAnimation(event.currentTarget);
                  onTabChange(tab.id);
                }}
              >
                <span className="g-tab__ind" />
                {renderTabIcon(tab, true)}
                <span className={`g-tab__label text-[10px] font-medium tracking-tight mt-0.5 transition-colors duration-150 ${isActive ? 'text-white' : 'text-zinc-500'}`}>{tab.label}</span>
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