import React, { createContext, useContext } from 'react';
import { isUuid } from '../services/profilePeek';

/** What the opener knows about someone before their profile loads. */
export interface PeekFallback {
  name?: string;
  age?: number;
  area?: string;
  photoUrl?: string;
  intent?: string;
  online?: boolean;
}

type OpenPeek = (userId: string | null | undefined, fallback?: PeekFallback) => void;

const PeekContext = createContext<OpenPeek | null>(null);

export const ProfilePeekProvider: React.FC<{ open: OpenPeek; children: React.ReactNode }> = ({ open, children }) => (
  <PeekContext.Provider value={open}>{children}</PeekContext.Provider>
);

/** Returns a function that opens the profile peek, or null where none is provided. */
export const useProfilePeek = () => useContext(PeekContext);

/**
 * Props that turn any avatar element into a tap target for the peek, without
 * triggering the row, card or button it sits inside. Pure (no hooks) so it can be
 * called inside list renders. Returns {} when there is nobody to show, so
 * non-profile avatars (havens, groups, demo data) stay inert.
 */
export function peekTapProps(open: OpenPeek | null, userId: string | null | undefined, fallback?: PeekFallback) {
  if (!open || !userId || !isUuid(userId)) return {} as Record<string, never>;
  const fire = () => open(userId, fallback);
  return {
    role: 'button' as const,
    tabIndex: 0,
    'aria-label': `View ${fallback?.name || 'profile'}`,
    onClick: (event: React.SyntheticEvent) => { event.stopPropagation(); event.preventDefault(); fire(); },
    onKeyDown: (event: React.KeyboardEvent) => {
      if (event.key === 'Enter' || event.key === ' ') { event.stopPropagation(); event.preventDefault(); fire(); }
    },
    style: { cursor: 'pointer' } as React.CSSProperties,
  };
}
