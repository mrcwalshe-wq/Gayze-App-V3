import React, { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Ban, BadgeCheck, Flag, Check, ChevronDown, MapPin, MessageCircle, ShieldCheck, Sparkles, X } from 'lucide-react';
import { loadPublicProfileSummary, type PublicProfileSummary } from '../services/supabaseService';
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
  onClose: () => void;
  /** Omit when the viewer is already in a conversation with this person. */
  onMessage?: () => void;
  onBlock?: (userId: string) => void;
  onReport?: (userId: string) => void;
}

/**
 * Profile peek. Tap anyone's photo and see their photos and the short version of who
 * they are: name, age, presence, current intent, a line of bio and the few things you
 * have most in common. One tap on "Full profile" opens the rest.
 */
export const PublicProfileSheet: React.FC<PublicProfileSheetProps> = ({
  userId,
  viewerId,
  fallbackPhotoUrl,
  fallbackName,
  fallbackAge,
  fallbackArea,
  fallbackIntent,
  fallbackOnline,
  onClose,
  onMessage,
  onBlock,
  onReport,
}) => {
  const [summary, setSummary] = useState<PublicProfileSummary | null>(null);
  const [mine, setMine] = useState<PublicProfileSummary | null>(null);
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
    setSummary(null); setMine(null); setPhotos([]); setFallbackUrl(null);
    setExpanded(false); setBioOpen(false); setIndex(0); setLightbox(null);
    const valid = isUuid(userId);
    setLoading(valid); setPhotosLoading(valid);
    if (!valid) return;

    void loadPublicProfileSummary(userId)
      .then((nextSummary) => { if (!cancelled) setSummary(nextSummary); })
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
    ].filter((group) => group.values.length > 0);
  }, [summary, chips]);

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
      <section className="g-peek" onClick={(event) => event.stopPropagation()}>
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
            <button type="button" onClick={onClose} className="g-peek__close" aria-label="Close profile"><X className="w-[18px] h-[18px]" /></button>
            {gallery.length > 1 && (
              <>
                <div className="g-peek__dots" aria-hidden="true">
                  {gallery.map((url, i) => <i key={url} data-on={i === index} />)}
                </div>
                <span className="g-peek__count">{index + 1}/{gallery.length}</span>
              </>
            )}
            <div className="g-peek__id">
              <div className="g-peek__name">
                <h2>{name}{age ? <span>{age}</span> : null}</h2>
                {summary?.safetyVerified && <BadgeCheck className="w-5 h-5 text-emerald-300" aria-label="Safety verified" />}
              </div>
              <div className="g-peek__meta">
                {online !== undefined && (
                  <span className={online ? 'is-online' : ''}><i />{online ? 'Online now' : 'Recently active'}</span>
                )}
                {fallbackArea && <span><MapPin className="w-3.5 h-3.5" />{fallbackArea}</span>}
              </div>
            </div>
          </div>

          <div className="g-peek__body">
            {intent && (
              <div className="g-peek__intent"><Sparkles className="w-4 h-4" /><span>Right now</span><strong>{intent}</strong></div>
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

                {chips.length > 0 && (
                  <div>
                    {sharedCount > 0 && <p className="g-peek__common"><Check className="w-3.5 h-3.5" />{sharedCount} in common with you</p>}
                    <div className="g-peek__chips">
                      {chips.map((chip) => (
                        <span key={chip.label} className={`g-peek__chip ${chip.shared ? 'is-shared' : chip.kind === 'lookingFor' ? 'is-look' : ''}`}>{chip.label}</span>
                      ))}
                    </div>
                  </div>
                )}

                {facts.length > 0 && <p className="g-peek__facts">{facts.join(' · ')}</p>}

                {!summary && <p className="g-peek__facts">Only the basics are visible right now.</p>}

                {summary && (summary.verifiedPeersCount ?? 0) > 0 && (
                  <p className="g-peek__trust"><ShieldCheck className="w-4 h-4" />{summary.verifiedPeersCount} verified {summary.verifiedPeersCount === 1 ? 'peer' : 'peers'}</p>
                )}

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

        {onMessage && (
          <div className="g-peek__foot">
            <button type="button" onClick={onMessage} className="g-peek__message"><MessageCircle className="w-[18px] h-[18px]" />Message</button>
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
