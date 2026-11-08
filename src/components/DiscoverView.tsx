import React, { useEffect, useMemo, useState } from 'react';
import { peekTapProps, useProfilePeek } from './ProfilePeek';
import { intentDisplayLabel } from '../services/intentLabels';
import { ACTIVITIES, legacyActivityFor } from '../services/intentModel';
import {
  Map as MapIcon,
  MessageSquare,
  Calendar,
  Eye,
  QrCode,
  ShieldCheck,
  X,
  Plus,
  Radio,
  Lock,
  User,
} from 'lucide-react';
import { Pulse, DatingProfile, UserActiveIntent, UserProfile, SafeHaven } from '../types';
import { CountdownPill } from './CountdownPill';
import { hapticLight } from '../services/hapticService';

interface DiscoverViewProps {
  profiles: DatingProfile[];
  pulses: Pulse[];
  safeHavens?: SafeHaven[];
  userNeighborhood: string;
  activeUserIntent?: UserActiveIntent | null;
  currentUser?: UserProfile;
  onOpenDirectChat: (pulse: Pulse) => void;
  onOpenDirectChatWithProfile: (profile: DatingProfile) => void;
  onGazeAtPeer?: (peerName: string, peerId?: string, intentId?: string) => boolean | void | Promise<boolean | void>;
  onOpenScheduleMeeting?: (peerName: string) => void;
  onOpenQRWithPeer?: (profile: DatingProfile) => void;
  onOpenSetIntent?: () => void;
  onOpenMap?: () => void;
  onOpenProfileEdit?: (section?: string) => void;
  onOpenPublicProfile?: (
    userId: string,
    fallback?: {
      name?: string;
      age?: number;
      area?: string;
      photoUrl?: string;
      intent?: string;
      online?: boolean;
    }
  ) => void;
}

/** Distances are approximate by design; unknown distances are never guessed. */
const formatDistance = (km?: number): string => {
  if (typeof km !== 'number' || !isFinite(km) || km <= 0) return 'distance unavailable';
  if (km < 0.1) return 'under 100 m';
  return km < 10 ? `~${km.toFixed(1)} km` : `~${Math.round(km)} km`;
};

type ModeFilter = 'All' | 'Social' | 'Private';

type DiscoverRow =
  | {
      kind: 'profile';
      id: string;
      item: DatingProfile;
      name: string;
      age?: number;
      mode: 'social' | 'private';
      intentLabel: string;
      description: string;
      area: string;
      km: number;
      expiresAt?: number;
      live: boolean;
      verified: boolean;
      reliability: number;
    }
  | {
      kind: 'pulse';
      id: string;
      item: Pulse;
      name: string;
      age?: number;
      mode: 'social' | 'private';
      intentLabel: string;
      description: string;
      area: string;
      km: number;
      expiresAt?: number;
      live: boolean;
      verified: boolean;
      reliability: number;
    };

/**
 * Discover — intent-first browsing. One column, sorted by what people actually
 * want to do (live intents first), never a photo grid.
 */
export const DiscoverView: React.FC<DiscoverViewProps> = ({
  profiles,
  pulses,
  userNeighborhood,
  activeUserIntent,
  onOpenDirectChat,
  onOpenDirectChatWithProfile,
  onGazeAtPeer,
  onOpenScheduleMeeting,
  onOpenQRWithPeer,
  onOpenSetIntent,
  onOpenMap,
  onOpenPublicProfile,
}) => {
  const openPeek = useProfilePeek();
  // Activity filter (intent model v2). 'all' shows everything.
  const [activityFilter, setActivityFilter] = useState<string>('all');
  const [selected, setSelected] = useState<DiscoverRow | null>(null);
  const [gazedNames, setGazedNames] = useState<Set<string>>(new Set());

  // Expired intents leave the list without waiting for a discovery refresh.
  const [nowTick, setNowTick] = useState(() => Date.now());
  useEffect(() => {
    const interval = window.setInterval(() => setNowTick(Date.now()), 30000);
    return () => window.clearInterval(interval);
  }, []);

  const rows = useMemo<DiscoverRow[]>(() => {
    const collected: DiscoverRow[] = [];
    // A person is either a live intent row or a local demo profile — never both.
    const pulsePeerIds = new Set(
      pulses.filter((pulse) => pulse.expiresAt > nowTick).map((pulse) => pulse.peerId),
    );

    profiles.forEach((profile) => {
      if (pulsePeerIds.has(profile.id)) return;
      const mode: 'social' | 'private' =
        profile.intentMode === 'private' || profile.lookingFor === 'casual' ? 'private' : 'social';
      const live = Boolean(profile.hasRightNowIntent && profile.intentExpiresAt && profile.intentExpiresAt > Date.now());
      collected.push({
        kind: 'profile',
        id: profile.id,
        item: profile,
        name: `${profile.name} · ${profile.age}`,
        age: profile.age,
        mode,
        intentLabel: intentDisplayLabel(profile.intent || profile.lookingForLabel),
        description: live ? profile.rightNowDetail || profile.headline : profile.headline,
        area: profile.neighborhood,
        km: profile.approxDistanceKm,
        expiresAt: live ? profile.intentExpiresAt : undefined,
        live,
        verified: profile.safetyVerified,
        reliability: profile.reliabilityScore,
      });
    });

    pulses.forEach((pulse) => {
      if (pulse.peerId === 'peer_me') return;
      if (pulse.expiresAt <= nowTick) return;
      const mode: 'social' | 'private' =
        pulse.intentMode === 'private' || pulse.intent?.includes('Hookup') ? 'private' : 'social';
      if (activityFilter !== 'all' && !(pulse.activities ?? legacyActivityFor(pulse.intent)).includes(activityFilter)) return;
      const live = pulse.expiresAt > nowTick;
      collected.push({
        kind: 'pulse',
        id: pulse.id,
        item: pulse,
        name: `${pulse.peerName}${pulse.peerAge ? ` · ${pulse.peerAge}` : ''}`,
        age: pulse.peerAge,
        mode,
        intentLabel: intentDisplayLabel(pulse.intent || pulse.title),
        description: pulse.description,
        area: pulse.neighborhood || userNeighborhood,
        km: pulse.approxDistanceKm,
        expiresAt: live ? pulse.expiresAt : undefined,
        live,
        verified: Boolean(pulse.safetyVerified),
        reliability: pulse.peerReliabilityScore ?? 0,
      });
    });

    // Live intents first, then nearest
    return collected.sort((a, b) => {
      if (a.live !== b.live) return a.live ? -1 : 1;
      // Missing/invalid distances must not produce a NaN comparator; keep those
      // rows after rows with a known distance while preserving their relative order.
      const aDistance = typeof a.km === 'number' && Number.isFinite(a.km) && a.km >= 0
        ? a.km
        : Number.POSITIVE_INFINITY;
      const bDistance = typeof b.km === 'number' && Number.isFinite(b.km) && b.km >= 0
        ? b.km
        : Number.POSITIVE_INFINITY;
      return aDistance - bDistance;
    });
  }, [profiles, pulses, activityFilter, userNeighborhood, nowTick]);

  const liveCount = rows.filter((r) => r.live).length;

  const handleGaze = async (row: DiscoverRow) => {
    const peerName = row.kind === 'pulse' ? row.item.peerName : row.item.name;
    hapticLight();
    const peerId = row.kind === 'pulse' ? row.item.peerId : row.item.id;
    const intentId = row.kind === 'pulse' && row.item.id.startsWith('supabase_') ? row.item.id.slice('supabase_'.length) : undefined;
    try {
      const sent = await onGazeAtPeer?.(peerName, peerId, intentId);
      if (sent === true) setGazedNames((prev) => new Set(prev).add(peerId));
    } catch { /* A failed send must not become a confirmed Gaze. */ }
  };

  const handleMessage = (row: DiscoverRow) => {
    hapticLight();
    if (row.kind === 'pulse') onOpenDirectChat(row.item);
    else onOpenDirectChatWithProfile(row.item);
  };

  return (
    <div className="gayze-premium-page max-w-2xl mx-auto pb-6 px-1">
      {/* In-view header */}
      <header className="flex items-start justify-between gap-3 pt-5 pb-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <span className="g-label">{userNeighborhood || 'Near you'}</span>
          </div>
          <h1 className="text-[26px] leading-tight font-bold tracking-[-0.025em] text-white mt-1">
            Discover
          </h1>
          <p className="text-[13px] text-zinc-400 mt-0.5">
            People here, by what they actually want to do.
          </p>
        </div>
        {onOpenMap && (
          <button
            type="button"
            onClick={() => { hapticLight(); onOpenMap(); }}
            className={`g-btn g-btn--quiet g-discover-map-button shrink-0 !min-h-[38px] !px-3.5 !rounded-xl !text-[12.5px] ${activeUserIntent?.mode === 'private' ? 'g-discover-map-button--private' : activeUserIntent?.mode === 'social' ? 'g-discover-map-button--social' : ''}`}
          >
            <MapIcon className="w-4 h-4" />
            Map
          </button>
        )}
      </header>

      {/* Your signal strip */}
      {activeUserIntent && (
        <button
          type="button"
          onClick={() => { hapticLight(); onOpenSetIntent?.(); }}
          className={`g-discover-signal-strip g-discover-signal-strip--${activeUserIntent.mode === 'private' ? 'private' : 'social'} mb-4 flex items-center gap-3 text-left cursor-pointer`}
        >
          <span
            className={`g-live-dot shrink-0 ${activeUserIntent.isPaused ? 'g-live-dot--paused' : ''}`}
            aria-hidden="true"
          />
          <div className="min-w-0 flex-1">
            <div className="text-[13.5px] font-semibold text-white truncate flex items-center gap-2">
              <span>{intentDisplayLabel(activeUserIntent.intent)}</span>
              <span className="text-[10px] px-1.5 py-0.5 rounded-md font-mono bg-white/10 text-zinc-300">
                {activeUserIntent.mode}
              </span>
            </div>
            <div className="text-[11.5px] text-zinc-400 truncate mt-0.5">
              {activeUserIntent.isPaused ? 'Intent paused' : `Active around ${activeUserIntent.area}`}
            </div>
          </div>
          <span className="text-[12px] font-semibold text-[#c9b0f5] shrink-0 px-2.5 py-1 rounded-lg bg-white/[0.05] border border-white/10">
            Manage
          </span>
        </button>
      )}

      {/* Activity filter */}
      <div className="dc-chips no-scrollbar" role="group" aria-label="Activity">
        <button type="button" aria-pressed={activityFilter === 'all'} onClick={() => { hapticLight(); setActivityFilter('all'); }}>All</button>
        {ACTIVITIES.map((a) => (
          <button key={a.id} type="button" aria-pressed={activityFilter === a.id} onClick={() => { hapticLight(); setActivityFilter(a.id); }}>{a.label}</button>
        ))}
      </div>

      {/* Rows — one surface */}
      {rows.length === 0 ? (
        <div className="g-empty g-discover-empty">
          <div className="g-empty__icon">
            <Radio className="w-5 h-5" />
          </div>
          <h3>No active intent nearby</h3>
          <p>
            Nobody matches this view right now. Set your own intent — it shows here and on the map
            the moment you go live.
          </p>
          {onOpenSetIntent && !activeUserIntent && (
            <button type="button" className="g-btn g-btn--primary w-full mt-1" onClick={() => { hapticLight(); onOpenSetIntent(); }}>
              <Plus className="w-4 h-4" />
              Create your intent
            </button>
          )}
        </div>
      ) : (
        <div className="dc-feed">
          {rows.map((row, i) => {
            const photo = row.kind === 'profile' ? row.item.photoUrl : (row.item.peerAvatar && row.item.peerAvatar !== 'user' ? row.item.peerAvatar : undefined);
            const usable = photo && /^(https?:|data:|blob:)/i.test(photo);
            const hue = 250 + ((row.name.charCodeAt(0) * 37) % 90);
            return (
              <article
                key={row.id}
                className="dc"
                data-tone={row.mode === 'private' ? 'purple' : 'gold'}
                style={{ ['--h' as string]: hue, animationDelay: `${Math.min(i * 60, 480)}ms` }}
              >
                <button type="button" className="dc__open" onClick={() => { hapticLight(); setSelected(row); }} aria-label={`Open ${row.name}`}>
                  <span className="dc__photo">
                    {usable ? <img src={photo} alt="" loading="lazy" draggable={false} onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }} /> : <b aria-hidden="true">{row.name.charAt(0).toUpperCase()}</b>}
                  </span>
                  <span className="dc__shade" aria-hidden="true" />
                  <span className="dc__top">
                    {row.live ? <span className="dc__live"><i aria-hidden="true" />Live</span> : <span className="dc__later">Later</span>}
                    {row.expiresAt ? <CountdownPill expiresAt={row.expiresAt} /> : null}
                  </span>
                  <span className="dc__glass">
                    <span className="dc__name"><strong>{row.name}{row.age ? <em>{row.age}</em> : null}</strong>{row.verified && <ShieldCheck className="w-4 h-4" aria-label="Verified" />}</span>
                    <span className="dc__intent">{row.intentLabel}{row.description ? <span> · {row.description}</span> : null}</span>
                    <span className="dc__meta">{row.area}<i aria-hidden="true" />{formatDistance(row.km)}</span>
                  </span>
                </button>
                {(row.kind === 'pulse' ? row.item.peerId : row.item.id) && (
                  <span
                    {...peekTapProps(openPeek, row.kind === 'pulse' ? row.item.peerId : row.item.id, { name: row.name, age: row.age, area: row.area, intent: row.intentLabel, online: row.live, photoUrl: photo, later: !row.live })}
                    className="dc__profile"
                  >Profile</span>
                )}
              </article>
            );
          })}
        </div>
      )}

      {/* Preview sheet */}
      {selected && (
        <div className="g-overlay flex items-end sm:items-center justify-center sm:p-4" onClick={() => setSelected(null)}>
          <div className="g-sheet g-sheet--above-nav" onClick={(e) => e.stopPropagation()}>
            <div className="g-sheet__grip" />
            <div className="g-sheet__head">
              <div className="flex items-center gap-3 min-w-0">
                <div
                  {...peekTapProps(openPeek, selected.kind === 'pulse' ? selected.item.peerId : selected.item.id, { name: selected.name, age: selected.age, area: selected.area, intent: selected.intentLabel, online: selected.live, photoUrl: selected.kind === 'profile' ? selected.item.photoUrl : (selected.item.peerAvatar && selected.item.peerAvatar !== 'user' ? selected.item.peerAvatar : undefined) })}
                  className={`g-avatar w-12 h-12 text-[15px] ${
                    selected.mode === 'private' ? 'g-avatar--ring-private' : 'g-avatar--ring-social'
                  }`}
                >
                  {selected.kind === 'profile' ? (
                    <img
                      src={selected.item.photoUrl}
                      alt=""
                      onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }}
                    />
                  ) : (selected.item.peerAvatar && selected.item.peerAvatar !== 'user') ? (
                    <img
                      src={selected.item.peerAvatar}
                      alt=""
                      onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }}
                    />
                  ) : (
                    <span>{selected.item.peerName.charAt(0)}</span>
                  )}
                </div>
                <div className="min-w-0">
                  <div className="flex items-center gap-1.5 flex-wrap">
                    <h2 className="text-[16px] font-extrabold text-white tracking-tight truncate">{selected.name}</h2>
                    <span className={`g-chip ${selected.mode === 'private' ? 'g-chip--private' : 'g-chip--social'}`}>
                      {selected.intentLabel}
                    </span>
                  </div>
                  <div className="g-map-state__meta mt-0.5">
                    {selected.live ? 'Live right now' : 'Availability unknown'} · {formatDistance(selected.km)} · {selected.area}
                  </div>
                </div>
              </div>
              <button type="button" className="g-icon-btn g-icon-btn--bare !w-9 !h-9" onClick={() => setSelected(null)} aria-label="Close">
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="g-sheet__body space-y-4">
              <p className="text-[13.5px] text-zinc-300 leading-relaxed">{selected.description}</p>

              <div className="flex flex-wrap items-center gap-2">
                {selected.expiresAt && <CountdownPill expiresAt={selected.expiresAt} />}
                {selected.verified && (
                  <span className="g-badge g-badge--verify">
                    <ShieldCheck className="w-3 h-3" /> Verified
                  </span>
                )}
                {selected.reliability > 0 && (
                  <span className="g-badge g-badge--trust">Reliability {selected.reliability}</span>
                )}
                <span className="g-badge g-badge--quiet">
                  <Lock className="w-3 h-3" /> Encrypted on your device
                </span>
              </div>

              {selected.kind === 'profile' && selected.item.interests.length > 0 && (
                <div className="flex flex-wrap gap-1.5">
                  {selected.item.interests.slice(0, 6).map((interest) => (
                    <span key={interest} className="g-tag">{interest}</span>
                  ))}
                </div>
              )}
            </div>

            <div className="g-sheet__foot">
              {onOpenPublicProfile && (
                <button
                  type="button"
                  className="g-btn g-btn--quiet !px-3"
                  onClick={() => {
                    hapticLight();
                    const peerId = selected.kind === 'pulse' ? selected.item.peerId : selected.item.id;
                    const photo = selected.kind === 'profile'
                      ? selected.item.photoUrl
                      : (selected.item.peerAvatar && selected.item.peerAvatar !== 'user' ? selected.item.peerAvatar : undefined);
                    setSelected(null);
                    onOpenPublicProfile(peerId, {
                      name: selected.name,
                      age: selected.age,
                      area: selected.area,
                      intent: selected.intentLabel,
                      photoUrl: photo,
                      online: selected.live,
                    });
                  }}
                  aria-label="View public profile"
                >
                  <User className="w-4 h-4" />
                  <span>Profile</span>
                </button>
              )}
              <button type="button" className="g-btn g-btn--quiet !px-3" onClick={() => handleGaze(selected)} aria-label="Send Gayze request">
                <Eye className="w-4 h-4" />
                {gazedNames.has(selected.kind === 'pulse' ? selected.item.peerId : selected.item.id) ? 'Gayze sent' : 'Send Gayze'}
              </button>
              <button
                type="button"
                className="g-btn g-btn--quiet !px-3"
                onClick={() => {
                  hapticLight();
                  onOpenScheduleMeeting?.(selected.kind === 'pulse' ? selected.item.peerName : selected.item.name);
                }}
                aria-label="Safe meet"
              >
                <Calendar className="w-4 h-4" />
                Meet
              </button>
              {selected.kind === 'profile' && onOpenQRWithPeer && (
                <button
                  type="button"
                  className="g-btn g-btn--quiet !px-3"
                  onClick={() => { hapticLight(); onOpenQRWithPeer(selected.item); }}
                  aria-label="Verify in person"
                >
                  <QrCode className="w-4 h-4" />
                </button>
              )}
              <button type="button" className="g-btn g-btn--amber flex-1" onClick={() => handleMessage(selected)}>
                <MessageSquare className="w-4 h-4" />
                Message
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
