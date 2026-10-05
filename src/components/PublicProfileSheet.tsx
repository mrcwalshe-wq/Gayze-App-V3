import React, { useEffect, useMemo, useState } from 'react';
import { Album, BadgeCheck, ChevronRight, Clock3, MapPin, MessageCircle, ShieldCheck, X } from 'lucide-react';
import type { IntimacyProfile } from '../types';
import { loadIntimacyProfile, loadPublicProfileSummary, type PublicProfileSummary } from '../services/supabaseService';

export interface PublicProfileSheetProps {
  userId: string | null;
  fallbackPhotoUrl?: string;
  fallbackName?: string;
  fallbackAge?: number;
  fallbackArea?: string;
  fallbackIntent?: string;
  fallbackOnline?: boolean;
  onClose: () => void;
  onMessage?: () => void;
  onAlbum?: () => void;
}

/** Rich, mobile-first public profile surface for Gayze discovery. */
export const PublicProfileSheet: React.FC<PublicProfileSheetProps> = ({
  userId,
  fallbackPhotoUrl,
  fallbackName,
  fallbackAge,
  fallbackArea,
  fallbackIntent,
  fallbackOnline,
  onClose,
  onMessage,
  onAlbum,
}) => {
  const [summary, setSummary] = useState<PublicProfileSummary | null>(null);
  const [intimacy, setIntimacy] = useState<IntimacyProfile | null>(null);
  const [loading, setLoading] = useState(Boolean(userId));

  useEffect(() => {
    let cancelled = false;
    setSummary(null);
    setIntimacy(null);
    if (!userId) {
      setLoading(false);
      return;
    }
    setLoading(true);
    void Promise.all([loadPublicProfileSummary(userId), loadIntimacyProfile(userId)])
      .then(([nextSummary, nextIntimacy]) => {
        if (cancelled) return;
        setSummary(nextSummary);
        setIntimacy(nextIntimacy);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => { cancelled = true; };
  }, [userId]);

  const name = summary?.displayName || fallbackName || 'Gayze user';
  const age = summary?.age ?? fallbackAge;
  const area = fallbackArea;
  const intent = fallbackIntent;
  const online = fallbackOnline;

  const groups = useMemo(() => {
    if (!summary) return [];
    return [
      { label: 'Looking for', values: summary.lookingFor, tone: 'purple' },
      { label: 'Interests', values: summary.hobbies, tone: 'amber' },
      { label: 'My setup', values: [...summary.mySetup, ...summary.availability], tone: 'quiet' },
      { label: 'Boundaries', values: summary.boundaries, tone: 'quiet' },
      {
        label: 'Intimacy',
        values: intimacy ? [intimacy.role, ...intimacy.preferences, intimacy.experience].filter(Boolean) : [],
        tone: 'purple',
      },
    ].filter((group) => group.values.length > 0);
  }, [summary, intimacy]);

  const facts = [
    summary?.pronouns,
    summary?.heightCm ? `${summary.heightCm} cm` : undefined,
    summary?.bodyType,
  ].filter(Boolean) as string[];

  return (
    <div className="g-overlay fixed inset-0 z-[80] flex items-end sm:items-center justify-center sm:p-4" onClick={onClose}>
      <section className="g-sheet w-full max-w-lg max-h-[92dvh] overflow-y-auto" onClick={(event) => event.stopPropagation()}>
        <div className="g-sheet__grip" />
        <button type="button" onClick={onClose} className="absolute top-4 right-4 z-10 h-9 w-9 rounded-full bg-black/45 border border-white/10 grid place-items-center text-white/80" aria-label="Close profile">
          <X className="h-4 w-4" />
        </button>

        <div className="relative -mx-4 -mt-1 h-[340px] overflow-hidden rounded-t-[24px] bg-[#17131e]">
          {fallbackPhotoUrl ? (
            <img src={fallbackPhotoUrl} alt="" className="h-full w-full object-cover" />
          ) : (
            <div className="h-full w-full grid place-items-center text-5xl font-semibold text-white/30">{name.charAt(0)}</div>
          )}
          <div className="absolute inset-0 bg-gradient-to-t from-[#0c0a10] via-transparent to-black/10" />
          <div className="absolute left-5 right-5 bottom-5">
            <div className="flex items-end justify-between gap-3">
              <div className="min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <h2 className="text-[28px] leading-none font-bold tracking-[-.025em] text-white">{name}{age ? `, ${age}` : ''}</h2>
                  {summary?.safetyVerified && <BadgeCheck className="w-5 h-5 text-emerald-300" />}
                </div>
                <div className="flex items-center gap-2 mt-2 text-[12px] text-white/70">
                  {online !== undefined && <span className={`inline-flex items-center gap-1.5 ${online ? 'text-emerald-300' : ''}`}>
                    <span className={`h-1.5 w-1.5 rounded-full ${online ? 'bg-emerald-300' : 'bg-white/30'}`} />
                    {online ? 'Online now' : 'Recently active'}
                  </span>}
                  {area && <><span>·</span><span>{area}</span></>}
                </div>
              </div>
              {intent && <span className="g-chip g-chip--private shrink-0">{intent}</span>}
            </div>
          </div>
        </div>

        <div className="px-0 pt-4 pb-2 space-y-4">
          <div className="grid grid-cols-2 gap-2">
            <button type="button" onClick={onAlbum} className="g-btn g-btn--quiet min-h-11 justify-center">
              <Album className="w-4 h-4" />
              Album
              <ChevronRight className="w-3.5 h-3.5 opacity-50" />
            </button>
            <button type="button" onClick={onMessage} className="g-btn g-btn--primary min-h-11 justify-center">
              <MessageCircle className="w-4 h-4" />
              Message
            </button>
          </div>

          {loading ? (
            <div className="rounded-2xl border border-white/8 bg-white/[.025] p-5 text-sm text-zinc-500">Loading profile details…</div>
          ) : (
            <>
              {summary?.bio && (
                <div className="rounded-2xl border border-white/8 bg-white/[.025] p-4">
                  <span className="g-label">About</span>
                  <p className="mt-2 text-[13.5px] leading-6 text-zinc-300">{summary.bio}</p>
                </div>
              )}

              {facts.length > 0 && (
                <div className="flex flex-wrap gap-2">
                  {facts.map((fact) => <span key={fact} className="g-tag">{fact}</span>)}
                </div>
              )}

              {groups.map((group) => (
                <div key={group.label}>
                  <div className="flex items-center justify-between mb-2">
                    <span className="g-label">{group.label}</span>
                    {group.label === 'Intimacy' && <ShieldCheck className="w-3.5 h-3.5 text-[#c9b0f5]" />}
                  </div>
                  <div className="flex flex-wrap gap-1.5">
                    {group.values.map((value) => (
                      <span key={value} className={group.tone === 'purple' ? 'g-chip g-chip--private' : group.tone === 'amber' ? 'g-tag' : 'g-chip g-chip--quiet'}>{value}</span>
                    ))}
                  </div>
                </div>
              ))}

              {summary?.verifiedPeersCount != null && (
                <div className="rounded-2xl border border-white/8 bg-white/[.025] p-3">
                  <span className="g-label">Verified peers</span>
                  <div className="mt-1 text-[18px] font-semibold text-white">{summary.verifiedPeersCount}</div>
                </div>
              )}

              <div className="flex items-center gap-2 text-[11px] text-zinc-500 pt-1">
                <MapPin className="w-3.5 h-3.5" /> Approximate location only
                <span>·</span>
                <Clock3 className="w-3.5 h-3.5" /> Intent and presence can change
              </div>
            </>
          )}
        </div>
      </section>
    </div>
  );
};
