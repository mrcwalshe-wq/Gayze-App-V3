import React, { useEffect, useState } from 'react';
import type { IntimacyProfile } from '../types';
import {
  loadIntimacyProfile,
  loadPublicProfileSummary,
  type PublicProfileSummary,
} from '../services/supabaseService';

/**
 * Compact peer profile summary for the map's detail sheet.
 *
 * Fetches only the PUBLIC profile tier plus the visibility-enforced intimacy
 * section (`get_profile_intimacy` decides server-side whether the caller may
 * see it). Renders nothing at all when there is nothing to show — the map
 * stays intent-first and low-friction.
 */
export const PeerProfileSummary: React.FC<{ userId: string | null }> = ({ userId }) => {
  const [summary, setSummary] = useState<PublicProfileSummary | null>(null);
  const [intimacy, setIntimacy] = useState<IntimacyProfile | null>(null);

  useEffect(() => {
    let cancelled = false;
    setSummary(null);
    setIntimacy(null);
    if (!userId) return;
    void (async () => {
      const [nextSummary, nextIntimacy] = await Promise.all([
        loadPublicProfileSummary(userId),
        loadIntimacyProfile(userId),
      ]);
      if (cancelled) return;
      setSummary(nextSummary);
      setIntimacy(nextIntimacy);
    })();
    return () => {
      cancelled = true;
    };
  }, [userId]);

  if (!userId || !summary) return null;

  const factTags = [
    summary.pronouns || undefined,
    summary.heightCm ? `${summary.heightCm} cm` : undefined,
    summary.bodyType || undefined,
  ].filter((value): value is string => Boolean(value));

  const intimacyChips = intimacy
    ? [
        intimacy.role,
        ...intimacy.preferences,
        intimacy.experience && intimacy.experience !== 'Not specified' ? intimacy.experience : undefined,
      ].filter((value): value is string => Boolean(value))
    : [];

  const hasContent =
    factTags.length > 0
    || summary.lookingFor.length > 0
    || summary.hobbies.length > 0
    || intimacyChips.length > 0
    || summary.mySetup.length > 0
    || summary.boundaries.length > 0;

  if (!hasContent) return null;

  const group = (label: string, chips: string[], tone: 'tag' | 'private' | 'quiet' = 'tag') =>
    chips.length > 0 && (
      <div key={label}>
        <span className="g-label">{label}</span>
        <div className="flex flex-wrap gap-1.5 mt-1.5">
          {chips.map((chip) => (
            <span
              key={chip}
              className={tone === 'private' ? 'g-chip g-chip--private' : tone === 'quiet' ? 'g-chip g-chip--quiet' : 'g-tag'}
            >
              {chip}
            </span>
          ))}
        </div>
      </div>
    );

  return (
    <div className="pt-1 space-y-2.5" data-testid="peer-profile-summary">
      {group('About', factTags)}
      {group('Looking for', summary.lookingFor)}
      {group('Interests', summary.hobbies)}
      {group('Intimacy', intimacyChips, 'private')}
      {group('My setup', [...summary.mySetup, ...summary.availability], 'quiet')}
      {group('Boundaries', summary.boundaries)}
    </div>
  );
};
