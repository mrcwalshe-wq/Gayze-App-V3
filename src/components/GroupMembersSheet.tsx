import React, { useState } from 'react';
import { SwipeRow } from './SwipeRow';
import { X, MessageCircle, Crown, UserRound, CalendarDays, MapPin, CalendarX } from 'lucide-react';
import { hapticLight } from '../services/hapticService';

export interface GroupMember { userId: string; name: string; isYou: boolean; isHost: boolean; hasChat: boolean }
export interface GroupEventInfo { title: string; startsAt: number; placeName?: string; address?: string; cancelled?: boolean }

interface Props {
  isOpen: boolean;
  onClose: () => void;
  title: string;
  members: GroupMember[];
  event?: GroupEventInfo | null;
  /** Start (or open) a private chat with this member. */
  onMessage: (member: GroupMember) => void;
  onViewProfile: (member: GroupMember) => void;
}

const hue = (s: string) => { let h = 0; for (const c of s) h = (h * 31 + c.charCodeAt(0)) % 360; return h; };

export function formatEventWhen(ts: number) {
  return new Date(ts).toLocaleString([], { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
}

/** Who is in an event group, with a way to start a private chat with each of them. */
export const GroupMembersSheet: React.FC<Props> = ({ isOpen, onClose, title, members, event, onMessage, onViewProfile }) => {
  const [swipeId, setSwipeId] = useState<string | null>(null);
  if (!isOpen) return null;
  const sorted = [...members].sort((a, b) => Number(b.isHost) - Number(a.isHost) || Number(b.isYou) - Number(a.isYou) || a.name.localeCompare(b.name));
  return (
    <div className="g-overlay" role="dialog" aria-modal="true" aria-label={`${title} members`} onClick={onClose}>
      <div className="g-sheet g-sheet--dark gm-sheet" onClick={(e) => e.stopPropagation()}>
        <header className="gm-head">
          <div>
            <small>EVENT GROUP</small>
            <h2>{title}</h2>
          </div>
          <button type="button" className="gm-x" aria-label="Close" onClick={() => { hapticLight(); onClose(); }}><X className="w-5 h-5" /></button>
        </header>

        {event && (
          <div className={`gm-event ${event.cancelled ? 'is-cancelled' : ''}`}>
            <span>{event.cancelled ? <CalendarX className="w-4 h-4" aria-hidden="true" /> : <CalendarDays className="w-4 h-4" aria-hidden="true" />}{event.cancelled ? 'Cancelled · ' : ''}{formatEventWhen(event.startsAt)}</span>
            {(event.placeName || event.address) && <span><MapPin className="w-4 h-4" aria-hidden="true" />{[event.placeName, event.address].filter(Boolean).join(' · ')}</span>}
          </div>
        )}

        <p className="gm-count">{members.length} {members.length === 1 ? 'person' : 'people'} in this group</p>
        <ul className="gm-list">
          {sorted.map((m) => (
            <li key={m.userId}>
            <SwipeRow isOpen={swipeId === m.userId} onOpenChange={(open) => setSwipeId(open ? m.userId : null)}
              actions={m.isYou ? [] : [
                { key: 'profile', label: 'Profile', tone: 'archive', icon: <UserRound className="w-5 h-5" aria-hidden="true" />, onClick: () => onViewProfile(m) },
                { key: 'message', label: m.hasChat ? 'Open chat' : 'Message', tone: 'archive', icon: <MessageCircle className="w-5 h-5" aria-hidden="true" />, onClick: () => onMessage(m) },
              ]}>
            <div className="gm-row">
              <button type="button" className="gm-av" style={{ ['--h' as string]: hue(m.name) }} onClick={() => { if (!m.isYou) onViewProfile(m); }} aria-label={m.isYou ? 'You' : `View ${m.name}`} disabled={m.isYou}>
                <b>{m.name.charAt(0).toUpperCase()}</b>
              </button>
              <span className="gm-who">
                <strong>{m.isYou ? 'You' : m.name}</strong>
                {m.isHost && <em><Crown className="w-3 h-3" aria-hidden="true" />Host</em>}
              </span>
              {!m.isYou && (
                <span className="gm-acts">
                  <button type="button" className="gm-btn" onClick={() => { hapticLight(); onViewProfile(m); }}><UserRound className="w-4 h-4" aria-hidden="true" />Profile</button>
                  <button type="button" className="gm-btn is-primary" onClick={() => { hapticLight(); onMessage(m); }}>
                    <MessageCircle className="w-4 h-4" aria-hidden="true" />{m.hasChat ? 'Open chat' : 'Message'}
                  </button>
                </span>
              )}
            </div>
            </SwipeRow>
            </li>
          ))}
        </ul>
        <p className="gm-fine">Messaging someone sends them a private chat request. The chat opens when they accept, and anyone can say no.</p>
      </div>
    </div>
  );
};
