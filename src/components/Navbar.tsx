import React, { useEffect, useId, useRef, useState } from 'react';
import { GayzeLogo } from './GayzeLogo';
import {
  Shield,
  EyeOff,
  Compass,
  Radio,
  Clock,
  MessageSquare,
  UsersRound,
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
  activeIntentMode?: 'social' | 'private' | null;
  onOpenIntentHub?: () => void;
}

interface TabDef {
  id: NavTab;
  label: string;
  icon: React.ReactNode;
  group: NavTab;
}

const TABS: TabDef[] = [
  { id: 'later', label: 'Later', icon: <Clock />, group: 'later' },
  { id: 'right_now', label: 'Intents', icon: <Radio />, group: 'right_now' },
  { id: 'dating', label: 'GAYZE', icon: <Compass />, group: 'dating' },
  { id: 'swarms', label: 'Messages', icon: <MessageSquare />, group: 'swarms' },
  { id: 'profile', label: 'Profile', icon: <UserRound />, group: 'profile' },
];


/**
 * The bar's top edge: a line that rises into a dome over the GAYZE logo and carries on.
 * Drawn as SVG (not a CSS mask) so it renders identically in Safari, Chrome and the
 * installed PWA. The hues travel the full width of the bar and back (SMIL on the
 * gradient), and are skipped for people who prefer reduced motion.
 */
const RISE = 16;        // how far the dome clears the bar
const CENTER = 31;      // logo centre below the bar's top edge
const RADIUS = 47;      // dome radius
const HALF = Math.sqrt(RADIUS * RADIUS - CENTER * CENTER); // where the dome meets the line (~35px)

const TabbarEdge: React.FC = () => {
  const ref = useRef<SVGSVGElement | null>(null);
  const [width, setWidth] = useState(0);
  const [still, setStill] = useState(false);
  const uid = useId().replace(/:/g, '');

  useEffect(() => {
    const el = ref.current?.parentElement;
    if (!el) return;
    const measure = () => setWidth(Math.max(0, el.clientWidth - 52));
    measure();
    const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(measure) : null;
    ro?.observe(el);
    const mq = window.matchMedia?.('(prefers-reduced-motion: reduce)');
    setStill(Boolean(mq?.matches));
    return () => ro?.disconnect();
  }, []);

  const cx = width / 2;
  const y = RISE + 1;
  const d = width > HALF * 2 + 20
    ? `M0 ${y} H${cx - HALF} A${RADIUS} ${RADIUS} 0 0 1 ${cx + HALF} ${y} H${width}`
    : '';

  return (
    <svg ref={ref} className="g-tabbar__edge" width={width} height={RISE + 4} viewBox={`0 0 ${width || 1} ${RISE + 4}`} aria-hidden="true" focusable="false">
      {d && (
        <>
          <defs>
            <linearGradient id={`${uid}-paint`} gradientUnits="userSpaceOnUse" x1="0" y1="0" x2={width * 3} y2="0">
              {['1', '2', '3', '4', '3', '2', '1'].map((n, i) => (
                <stop key={i} offset={i / 6} style={{ stopColor: `rgb(var(--gl${n}))` }} />
              ))}
              {!still && (
                <animateTransform attributeName="gradientTransform" type="translate" values={`0 0; ${-width * 2} 0; 0 0`} dur="18s" calcMode="spline" keyTimes="0;.5;1" keySplines=".45 0 .55 1; .45 0 .55 1" repeatCount="indefinite" />
              )}
            </linearGradient>
            <linearGradient id={`${uid}-fade`} gradientUnits="userSpaceOnUse" x1="0" y1="0" x2={width} y2="0">
              <stop offset="0" stopColor="#fff" stopOpacity="0" />
              <stop offset=".08" stopColor="#fff" stopOpacity="1" />
              <stop offset=".92" stopColor="#fff" stopOpacity="1" />
              <stop offset="1" stopColor="#fff" stopOpacity="0" />
            </linearGradient>
            <mask id={`${uid}-mask`} maskUnits="userSpaceOnUse" x="0" y="0" width={width} height={RISE + 4}>
              <path d={d} fill="none" stroke={`url(#${uid}-fade)`} strokeWidth="2" strokeLinecap="round" />
            </mask>
          </defs>
          <path d={`M${cx - HALF} ${y + 1} A${RADIUS} ${RADIUS} 0 0 1 ${cx + HALF} ${y + 1} Z`} fill="rgb(18 16 28)" fillOpacity=".97" />
          <rect x="0" y="0" width={width} height={RISE + 4} fill={`url(#${uid}-paint)`} mask={`url(#${uid}-mask)`} />
        </>
      )}
    </svg>
  );
};

const playGayzePressAnimation = (button: HTMLButtonElement) => {
  const action = button.querySelector<HTMLElement>('.g-discover-action');
  const logo = button.querySelector<HTMLImageElement>('.g-discover-logo-image');

  if (window.matchMedia('(prefers-reduced-motion: reduce)').matches || !action?.animate) return;

  action.getAnimations().forEach((animation) => animation.cancel());
  logo?.getAnimations().forEach((animation) => animation.cancel());

  action.animate(
    [
      { transform: 'scale(1)', opacity: 1 },
      { transform: 'scale(.965)', opacity: .92, offset: 0.22 },
      { transform: 'scale(1.015)', opacity: 1, offset: 0.58 },
      { transform: 'scale(1)', opacity: 1 },
    ],
    { duration: 220, easing: 'cubic-bezier(.22,1,.36,1)', fill: 'none' },
  );

  logo?.animate(
    [
      { transform: 'translate(-50%, -50%) scale(1)' },
      { transform: 'translate(-50%, -50%) scale(.94)', offset: 0.22 },
      { transform: 'translate(-50%, -50%) scale(1.025)', offset: 0.58 },
      { transform: 'translate(-50%, -50%) scale(1)' },
    ],
    { duration: 220, easing: 'cubic-bezier(.22,1,.36,1)', fill: 'none' },
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
  activeIntentMode = null,
  onOpenIntentHub,
}) => {
  const activeGroup = activeTab === 'safe_havens' ? 'profile' : activeTab;

  const renderTabIcon = (tab: TabDef, mobile = false) => {
    if (tab.id !== 'dating') {
      const intentIcon = tab.id === 'right_now'
        ? (activeIntentMode === 'private' ? <EyeOff /> : activeIntentMode === 'social' ? <UsersRound /> : <Radio />)
        : tab.icon;
      return (
        <span className={mobile ? '[&>svg]:w-5 [&>svg]:h-5 transition-transform duration-150' : '[&>svg]:w-[15px] [&>svg]:h-[15px]'}>
          {intentIcon}
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
            src={activeIntentMode === 'private' ? "/brand/gayze-nav-private.svg?v=20261008-1" : activeIntentMode === 'social' ? "/brand/gayze-nav-social.svg?v=20261008-1" : "/brand/gayze-nav-v3.svg?v=20261008-8"}
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
                {(tab.id === 'swarms' && (unreadCount > 0 || notificationCount > 0)) && (
                  <span className="w-1.5 h-1.5 rounded-full bg-[#C9A24D]" aria-label={`${notificationCount} unread GAYZE activity`} />
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
        <TabbarEdge />
        <div className="g-tabbar__inner">
          {TABS.map((tab) => {
            const isActive = activeGroup === tab.group;
            const isGayzeAction = tab.id === 'dating';
            return (
              <button
                key={tab.id}
                className={`g-tab ${isGayzeAction ? 'g-tab--discover group gayze-intent-glow' : ''}`}
                data-tab={tab.id}
                data-active={isActive}
                data-intent-mode={isGayzeAction ? (activeIntentMode || 'none') : undefined}
                aria-current={isActive ? 'page' : undefined}
                aria-label={isGayzeAction ? 'Open GAYZE intents' : tab.label}
                onClick={(event) => {
                  hapticLight();
                  if (isGayzeAction) {
                    playGayzePressAnimation(event.currentTarget);
                    onOpenIntentHub?.();
                    return;
                  }
                  onTabChange(tab.id);
                }}
              >
                <span className="g-tab__ind" />
                {renderTabIcon(tab, true)}
                <span className={`g-tab__label text-[10px] font-medium tracking-tight mt-0.5 transition-colors duration-150 ${isActive ? 'text-white' : 'text-zinc-500'}`}>{tab.label}</span>
                {(tab.id === 'swarms' && (unreadCount > 0 || notificationCount > 0)) && (
                  <span className="g-tab__badge" aria-label={`${notificationCount} unread GAYZE activity`} />
                )}
              </button>
            );
          })}
        </div>
      </nav>
    </>
  );
};