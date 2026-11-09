import React, { useEffect, useId, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Ban, BadgeCheck, CalendarClock, Flag, Check, ChevronDown, MapPin, MessageCircle, ShieldCheck, Sparkles, X, Zap } from 'lucide-react';
import type { IntimacyProfile } from '../types';
import { loadIntimacyProfile, loadPublicProfileSummary, type PublicProfileSummary } from '../services/supabaseService';
import { getProfilePhotoUrl, loadPeerPhotos, type PeerPhoto } from '../services/profilePhotoService';
import { isLongBio, isUuid, pickHighlights, shortFacts } from '../services/profilePeek';

export interface PublicProfileSheetProps {
  userId: string | null;
  /** The viewer, so interests they share with this person can lead the short view. */
  viewerId?: string | null;
  fallbackPhotoUrl?: string;
  fallbackName?: string;
  fallbackAge?: number;
  fallbackArea?: string;
  fallbackIntent?: string;
  fallbackOnline?: boolean;
  /** From the people grid / map: distance band and when their live signal ends. */
  fallbackDistance?: string;
  fallbackExpiresAt?: number;
  /** The signal is for later (gold) rather than within a day (purple). */
  fallbackLater?: boolean;
  onClose: () => void;
  /** Omit when the viewer is already in a conversation with this person. */
  onMessage?: () => void;
  /** Opens the plan-a-meetup sheet for this person. Omit when there is no conversation to send it to. */
  onPlan?: () => void;
  /** Sends a Gayze request to this person. Resolves true when it was sent. Omit for yourself or when signed out. */
  onGayze?: () => Promise<boolean>;
  onBlock?: (userId: string) => void;
  onReport?: (userId: string) => void;
}

/**
 * Profile peek. Tap anyone's photo and see their photos and the short version of who
 * they are: name, age, presence, current intent, a line of bio and the few things you
 * have most in common. One tap on "Full profile" opens the rest.
 */
/** A thin ring that fills to `value` (0-100) when it appears. */
const RING_STOPS: Record<'violet' | 'gold', [string, string, string]> = {
  violet: ['#9b6bf0', '#d06ae0', '#e8b84e'],
  gold: ['#e8b84e', '#e8a04e', '#e0707a'],
};
const StatRing: React.FC<{ value: number; label: string; caption: string; tone?: 'violet' | 'green' | 'gold' }> = ({ value, label, caption, tone = 'violet' }) => {
  const [shown, setShown] = useState(0);
  const gradientId = `pk-ring-${useId().replace(/[^a-zA-Z0-9]/g, '')}`;
  const stops = tone === 'green' ? null : RING_STOPS[tone];
  useEffect(() => { const t = window.setTimeout(() => setShown(Math.max(0, Math.min(100, value))), 80); return () => window.clearTimeout(t); }, [value]);
  return (
    <div className={`pk-stat pk-stat--${tone}`}>
      <svg viewBox="0 0 48 48" aria-hidden="true">
        {stops && <defs><linearGradient id={gradientId} x1="0" y1="0" x2="1" y2="1"><stop offset="0" stopColor={stops[0]} /><stop offset="0.55" stopColor={stops[1]} /><stop offset="1" stopColor={stops[2]} /></linearGradient></defs>}
        <circle cx="24" cy="24" r="20" className="pk-ring-track" />
        <circle cx="24" cy="24" r="20" className="pk-ring" pathLength={100} style={{ strokeDasharray: `${shown} 100`, ...(stops ? { stroke: `url(#${gradientId})` } : {}) }} />
      </svg>
      <b>{label}</b>
      <small>{caption}</small>
    </div>
  );
};

export const PublicProfileSheet: React.FC<PublicProfileSheetProps> = ({
  userId,
  viewerId,
  fallbackPhotoUrl,
  fallbackName,
  fallbackAge,
  fallbackArea,
  fallbackIntent,
  fallbackOnline,
  fallbackDistance,
  fallbackExpiresAt,
  fallbackLater,
  onClose,
  onMessage,
  onPlan,
  onGayze,
  onBlock,
  onReport,
}) => {
  const [gayzeState, setGayzeState] = useState<'idle' | 'sending' | 'sent'>('idle');
  useEffect(() => { setGayzeState('idle'); }, [userId]);
  const sendGayze = async () => {
    if (!onGayze || gayzeState !== 'idle') return;
    setGayzeState('sending');
    let sent = false;
    try { sent = await onGayze(); } catch { sent = false; }
    setGayzeState(sent ? 'sent' : 'idle');
  };
  const [summary, setSummary] = useState<PublicProfileSummary | null>(null);
  const [mine, setMine] = useState<PublicProfileSummary | null>(null);
  const [intimacy, setIntimacy] = useState<IntimacyProfile | null>(null);
  const [photos, setPhotos] = useState<PeerPhoto[]>([]);
  const [fallbackUrl, setFallbackUrl] = useState<string | null>(null);
  const [loading, setLoading] = useState(Boolean(userId));
  const [photosLoading, setPhotosLoading] = useState(isUuid(userId));
  const [expanded, setExpanded] = useState(false);
  const [bioOpen, setBioOpen] = useState(false);
  const [index, setIndex] = useState(0);
  const [lightbox, setLightbox] = useState<number | null>(null);
  const trackRef = useRef<HTMLDivElement | null>(null);
  const lightboxRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    let cancelled = false;
    setSummary(null); setMine(null); setIntimacy(null); setPhotos([]); setFallbackUrl(null);
    setExpanded(false); setBioOpen(false); setIndex(0); setLightbox(null);
    const valid = isUuid(userId);
    setLoading(valid); setPhotosLoading(valid);
    if (!valid) return;

    void Promise.all([loadPublicProfileSummary(userId), loadIntimacyProfile(userId)])
      .then(([nextSummary, nextIntimacy]) => { if (!cancelled) { setSummary(nextSummary); setIntimacy(nextIntimacy); } })
      .finally(() => { if (!cancelled) setLoading(false); });
    void loadPeerPhotos(userId)
      .then((next) => { if (!cancelled) setPhotos(next); })
      .finally(() => { if (!cancelled) setPhotosLoading(false); });
    if (isUuid(viewerId) && viewerId !== userId) {
      void loadPublicProfileSummary(viewerId).then((own) => { if (!cancelled) setMine(own); });
    }
    return () => { cancelled = true; };
  }, [userId, viewerId]);

  // The opener may hand over a storage path or an avatar reference rather than a ready URL.
  useEffect(() => {
    let cancelled = false;
    if (!fallbackPhotoUrl) { setFallbackUrl(null); return; }
    void getProfilePhotoUrl(fallbackPhotoUrl).then((url) => { if (!cancelled) setFallbackUrl(url); });
    return () => { cancelled = true; };
  }, [fallbackPhotoUrl]);

  useEffect(() => {
    const previous = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const onKey = (event: KeyboardEvent) => { if (event.key === 'Escape') { if (lightbox !== null) setLightbox(null); else onClose(); } };
    window.addEventListener('keydown', onKey);
    return () => { document.body.style.overflow = previous; window.removeEventListener('keydown', onKey); };
  }, [onClose, lightbox]);

  const name = summary?.displayName || fallbackName || 'Gayze member';
  const age = summary?.age ?? fallbackAge;
  const gallery = useMemo<string[]>(() => {
    if (photos.length) return photos.map((photo) => photo.url);
    return fallbackUrl ? [fallbackUrl] : [];
  }, [photos, fallbackUrl]);

  const { chips, sharedCount } = useMemo(
    () => pickHighlights(
      { lookingFor: summary?.lookingFor ?? [], hobbies: summary?.hobbies ?? [] },
      mine ? { lookingFor: mine.lookingFor, hobbies: mine.hobbies } : null,
      5,
    ),
    [summary, mine],
  );
  // "Match": how much of what they list you share. Shown only when both profiles are readable.
  const matchPct = useMemo(() => {
    if (!summary || !mine) return null;
    const theirs = new Set([...summary.lookingFor, ...summary.hobbies].map((v) => v.trim().toLowerCase()).filter(Boolean));
    const ours = new Set([...mine.lookingFor, ...mine.hobbies].map((v) => v.trim().toLowerCase()).filter(Boolean));
    if (theirs.size === 0 || ours.size === 0) return null;
    let shared = 0; theirs.forEach((v) => { if (ours.has(v)) shared += 1; });
    return Math.min(99, Math.round((shared / Math.min(theirs.size, ours.size)) * 100));
  }, [summary, mine]);
  const minutesLeft = fallbackExpiresAt ? Math.max(0, Math.round((fallbackExpiresAt - Date.now()) / 60000)) : 0;
  const leftLabel = minutesLeft >= 60 ? `${Math.floor(minutesLeft / 60)}h ${String(minutesLeft % 60).padStart(2, '0')}m` : `${minutesLeft}m`;
  const hasStats = Boolean(summary) && (summary!.reliabilityScore != null || (summary!.verifiedPeersCount ?? 0) > 0 || matchPct != null);
  const facts = shortFacts({ pronouns: summary?.pronouns, heightCm: summary?.heightCm, bodyType: summary?.bodyType });
  const bio = summary?.bio?.trim();

  const moreGroups = useMemo(() => {
    if (!summary) return [];
    const shown = new Set(chips.map((chip) => chip.label.toLowerCase()));
    const rest = (values: string[]) => values.filter((value) => !shown.has(value.toLowerCase()));
    return [
      { label: 'Looking for', values: rest(summary.lookingFor), tone: 'purple' },
      { label: 'Interests', values: rest(summary.hobbies), tone: 'amber' },
      { label: 'My setup', values: [...summary.mySetup, ...summary.availability], tone: 'quiet' },
      { label: 'Boundaries', values: summary.boundaries, tone: 'quiet' },
      { label: 'Intimacy', values: intimacy ? [intimacy.role, ...intimacy.preferences, intimacy.experience].filter((v): v is string => Boolean(v)) : [], tone: 'purple' },
    ].filter((group) => group.values.length > 0);
  }, [summary, chips, intimacy]);

  const goTo = (next: number) => {
    const el = trackRef.current;
    if (!el || gallery.length < 2) return;
    const i = (next + gallery.length) % gallery.length;
    el.scrollTo({ left: i * el.clientWidth, behavior: 'smooth' });
    setIndex(i);
  };

  const onTrackScroll = () => {
    const el = trackRef.current;
    if (!el || !el.clientWidth) return;
    setIndex(Math.round(el.scrollLeft / el.clientWidth));
  };

  useEffect(() => {
    if (lightbox === null) return;
    const el = lightboxRef.current;
    if (el) el.scrollLeft = lightbox * el.clientWidth;
  }, [lightbox]);

  const online = fallbackOnline;
  const intent = fallbackIntent;

  return createPortal(
    <div className="g-peek-overlay" onClick={onClose} role="dialog" aria-modal="true" aria-label={`${name}'s profile`}>
      <section className="g-peek" data-tone={fallbackLater ? 'gold' : 'violet'} onClick={(event) => event.stopPropagation()}>
        {/* Outside the scroll area so it stays reachable however far the card is scrolled. */}
        <button type="button" onClick={onClose} className="g-peek__close" aria-label="Close profile"><X className="w-[18px] h-[18px]" /></button>
        <div className="g-peek__scroll">
          <div className="g-peek__gallery">
            {gallery.length > 0 ? (
              <div className="g-peek__track no-scrollbar" ref={trackRef} onScroll={onTrackScroll}>
                {gallery.map((url, i) => (
                  <button type="button" key={url} className="g-peek__slide" onClick={() => setLightbox(i)} aria-label={`Open photo ${i + 1} of ${gallery.length}`}>
                    <img src={url} alt="" draggable={false} />
                  </button>
                ))}
              </div>
            ) : (
              <div className={`g-peek__initial ${photosLoading ? 'is-loading' : ''}`}>{name.charAt(0).toUpperCase()}</div>
            )}
            <div className="g-peek__shade" aria-hidden="true" />
            {gallery.length > 1 && (
              <>
                <div className="g-peek__bars" aria-hidden="true">
                  {gallery.map((url, i) => <i key={url} data-state={i < index ? 'done' : i === index ? 'on' : 'next'} />)}
                </div>
                <button type="button" className="g-peek__zone g-peek__zone--prev" aria-label="Previous photo" onClick={() => goTo(index - 1)} />
                <button type="button" className="g-peek__zone g-peek__zone--next" aria-label="Next photo" onClick={() => goTo(index + 1)} />
              </>
            )}
            <div className="g-peek__id" data-tone={fallbackLater ? 'gold' : 'purple'}>
              {intent && (
                <span className="g-peek__signal"><i aria-hidden="true" /><b>{intent}</b>{minutesLeft > 0 && <em>{leftLabel} left</em>}</span>
              )}
              <div className="g-peek__name">
                <h2>{name}{age ? <span>{age}</span> : null}</h2>
                {summary?.safetyVerified && <BadgeCheck className="w-5 h-5 text-emerald-300" aria-label="Safety verified" />}
              </div>
              <div className="g-peek__meta">
                {online !== undefined && (
                  <span className={online ? 'is-online' : ''}><i />{online ? 'Online now' : 'Offline'}</span>
                )}
                {fallbackArea && <span><MapPin className="w-3.5 h-3.5" />{fallbackArea}</span>}
              </div>
            </div>
          </div>

          <div className="g-peek__body">
            {(hasStats || fallbackDistance) && (
              <div className="pk-stats" aria-label="Profile at a glance">
                {matchPct != null && <StatRing value={matchPct} label={`${matchPct}%`} caption="Match" tone={fallbackLater ? 'gold' : 'violet'} />}
                {summary?.reliabilityScore != null && <StatRing value={summary.reliabilityScore} label={String(Math.round(summary.reliabilityScore))} caption="Reliable" tone="green" />}
                {(summary?.verifiedPeersCount ?? 0) > 0 && (
                  <div className="pk-stat pk-stat--plain"><b>{summary!.verifiedPeersCount}</b><small>Verified</small></div>
                )}
                {fallbackDistance && <div className="pk-stat pk-stat--plain"><b>{fallbackDistance}</b><small>Away</small></div>}
              </div>
            )}

            {loading ? (
              <div className="g-peek__skeleton" aria-label="Loading profile"><i /><i /><i /></div>
            ) : (
              <>
                {bio && (
                  <div className="g-peek__bio">
                    <p className={bioOpen ? '' : 'is-clamped'}>{bio}</p>
                    {isLongBio(bio) && (
                      <button type="button" onClick={() => setBioOpen((v) => !v)}>{bioOpen ? 'Less' : 'More'}</button>
                    )}
                  </div>
                )}

                {summary && (summary.safetyVerified || (summary.verifiedPeersCount ?? 0) > 0) && (
                  <div className="g-peek__badges">
                    {summary.safetyVerified && <span><BadgeCheck className="w-4 h-4" />Safety verified</span>}
                    {(summary.verifiedPeersCount ?? 0) > 0 && <span><ShieldCheck className="w-4 h-4" />{summary.verifiedPeersCount} verified {summary.verifiedPeersCount === 1 ? 'peer' : 'peers'}</span>}
                  </div>
                )}

                {sharedCount > 0 && (
                  <div className="g-peek__shared" aria-label={`${sharedCount} in common with you`}>
                    <p><Sparkles className="w-3.5 h-3.5" /><b>{sharedCount}</b> in common with you</p>
                    <div className="g-peek__chips">
                      {chips.filter((chip) => chip.shared).map((chip) => <span key={chip.label} className="g-peek__chip is-shared">{chip.label}</span>)}
                    </div>
                  </div>
                )}

                {chips.some((chip) => !chip.shared) && (
                  <div className="g-peek__chips">
                    {chips.filter((chip) => !chip.shared).map((chip) => (
                      <span key={chip.label} className={`g-peek__chip ${chip.kind === 'lookingFor' ? 'is-look' : ''}`}>{chip.label}</span>
                    ))}
                  </div>
                )}

                {facts.length > 0 && <p className="g-peek__facts">{facts.join(' · ')}</p>}

                {!summary && <p className="g-peek__facts">Only the basics are visible right now.</p>}

                {moreGroups.length > 0 && (
                  <>
                    <button type="button" className="g-peek__more" aria-expanded={expanded} onClick={() => setExpanded((v) => !v)}>
                      {expanded ? 'Hide full profile' : 'Full profile'}
                      <ChevronDown className={`w-4 h-4 ${expanded ? 'is-open' : ''}`} />
                    </button>
                    {expanded && (
                      <div className="g-peek__full">
                        {moreGroups.map((group) => (
                          <div key={group.label}>
                            <span className="g-label">{group.label}</span>
                            <div className="g-peek__chips mt-2">
                              {group.values.map((value) => (
                                <span key={value} className={`g-peek__chip ${group.tone === 'purple' ? 'is-look' : ''}`}>{value}</span>
                              ))}
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </>
                )}
              </>
            )}

            {userId && onReport && expanded && (
              <button type="button" onClick={() => onReport(userId)} className="g-peek__block" aria-label={`Report ${name}`}>
                <Flag className="w-4 h-4" /> Report {name}
              </button>
            )}

            {userId && onBlock && expanded && (
              <button type="button" onClick={() => onBlock(userId)} className="g-peek__block" aria-label={`Block ${name}`}>
                <Ban className="w-4 h-4" /> Block {name}
              </button>
            )}
          </div>
        </div>

        {(onMessage || onPlan || onGayze) && (
          <div className={`g-peek__foot ${onMessage && onPlan ? 'g-peek__foot--two' : ''}`}>
            {onGayze && (
              <button
                type="button"
                onClick={() => void sendGayze()}
                disabled={gayzeState !== 'idle'}
                className={`g-peek__gayze${gayzeState === 'sent' ? ' is-sent' : ''}`}
              >
                {gayzeState === 'sent' ? <Check className="w-[18px] h-[18px]" /> : <Zap className="w-[18px] h-[18px]" />}
                {gayzeState === 'sent' ? 'Gayze sent' : gayzeState === 'sending' ? 'Sending…' : 'Send a Gayze'}
              </button>
            )}
            {onPlan && <button type="button" onClick={onPlan} className="g-peek__plan"><CalendarClock className="w-[18px] h-[18px]" />Plan a safe meet</button>}
            {onMessage && <button type="button" onClick={onMessage} className="g-peek__message"><MessageCircle className="w-[18px] h-[18px]" />Message</button>}
          </div>
        )}
      </section>

      {lightbox !== null && (
        <div className="g-peek__lightbox" onClick={(event) => { event.stopPropagation(); setLightbox(null); }} role="dialog" aria-modal="true" aria-label="Photos">
          <div className="g-peek__lightbox-track no-scrollbar" ref={lightboxRef}>
            {gallery.map((url) => <div key={url} className="g-peek__lightbox-slide"><img src={url} alt="" draggable={false} /></div>)}
          </div>
          <button type="button" className="g-peek__close" aria-label="Close photos" onClick={(event) => { event.stopPropagation(); setLightbox(null); }}><X className="w-[18px] h-[18px]" /></button>
        </div>
      )}
    </div>,
    document.body,
  );
};
