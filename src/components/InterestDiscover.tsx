import React, { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Loader2, MapPin, MessageCircle, Search, SlidersHorizontal, UserPlus, X } from 'lucide-react';
import { INTEREST_CATEGORIES } from '../config/profileOptions';
import { discoverPeople, DISCOVER_PAGE, type DiscoverPerson } from '../services/discoverPeople';
import { submitInterest } from '../services/supabaseService';
import { hapticLight } from '../services/hapticService';

interface Props {
  myInterests: string[];
  onEditInterests: () => void;
  onOpenProfile: (userId: string, name: string) => void;
  /** Open the existing chat with this person, if there is one. */
  onOpenChat: (userId: string) => boolean;
  showToast: (message: string) => void;
}

const RADII = [5, 10, 25, 50] as const;

const Avatar: React.FC<{ p: DiscoverPerson }> = ({ p }) => (
  <span className="g-disc__avatar">
    {p.displayName.charAt(0).toUpperCase()}
    {p.avatarUrl && <img src={p.avatarUrl} alt="" onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }} />}
    {p.presence !== 'offline' && <i className={`g-disc__dot g-disc__dot--${p.presence}`} aria-label={p.presence === 'online' ? 'Online' : 'Away'} />}
  </span>
);

/** Find people through what you both enjoy. Everything shown is a real member who allows being discovered. */
export const InterestDiscover: React.FC<Props> = ({ myInterests, onEditInterests, onOpenProfile, onOpenChat, showToast }) => {
  const [selected, setSelected] = useState<string[]>([]);
  const [query, setQuery] = useState('');
  const [radius, setRadius] = useState<number | null>(null);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [category, setCategory] = useState(INTEREST_CATEGORIES[0].key);
  const [people, setPeople] = useState<DiscoverPerson[]>([]);
  const [state, setState] = useState<'loading' | 'ready' | 'error'>('loading');
  const [more, setMore] = useState(false);
  const [hello, setHello] = useState<DiscoverPerson | null>(null);
  const [attempt, setAttempt] = useState(0);
  const reqId = useRef(0);
  const filterKey = `${selected.join('|')}#${query.trim()}#${radius}#${attempt}`;

  useEffect(() => {
    const id = ++reqId.current;
    setState('loading');
    const timer = window.setTimeout(() => {
      discoverPeople({ interests: selected, query, radiusKm: radius })
        .then((rows) => { if (id === reqId.current) { setPeople(rows); setMore(rows.length >= DISCOVER_PAGE); setState('ready'); } })
        .catch(() => { if (id === reqId.current) setState('error'); });
    }, query ? 300 : 0);
    return () => window.clearTimeout(timer);
  }, [filterKey]);   // eslint-disable-line react-hooks/exhaustive-deps

  const loadMore = async () => {
    try {
      const rows = await discoverPeople({ interests: selected, query, radiusKm: radius, offset: people.length });
      setPeople((prev) => [...prev, ...rows.filter((r) => !prev.some((p) => p.userId === r.userId))]);
      setMore(rows.length >= DISCOVER_PAGE);
    } catch { showToast('Could not load more people. Try again.'); }
  };

  const toggle = (v: string) => { hapticLight(); setSelected((cur) => (cur.includes(v) ? cur.filter((x) => x !== v) : [...cur, v])); };
  const activeCat = INTEREST_CATEGORIES.find((c) => c.key === category) ?? INTEREST_CATEGORIES[0];
  const mine = useMemo(() => new Set(myInterests.map((i) => i.toLowerCase())), [myInterests]);
  const filtering = selected.length > 0 || query.trim() !== '' || radius !== null;

  return (
    <section className="g-disc" aria-label="Discover people">
      <header className="g-disc__head">
        <h1>Discover</h1>
        <p>People who enjoy what you enjoy.</p>
      </header>

      <div className="g-disc__search">
        <Search className="w-4 h-4" aria-hidden="true" />
        <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search people or interests" aria-label="Search people or interests" maxLength={40} />
        <button type="button" className={`g-disc__filter ${filtersOpen || selected.length || radius ? 'is-on' : ''}`} aria-expanded={filtersOpen} aria-label="Filters" onClick={() => setFiltersOpen((v) => !v)}>
          <SlidersHorizontal className="w-4 h-4" />{selected.length + (radius ? 1 : 0) > 0 && <b>{selected.length + (radius ? 1 : 0)}</b>}
        </button>
      </div>

      {filtersOpen && (
        <div className="g-disc__filters">
          <div className="g-disc__tabs" role="tablist" aria-label="Interest categories">
            {INTEREST_CATEGORIES.map((c) => (
              <button key={c.key} type="button" role="tab" aria-selected={category === c.key} className={category === c.key ? 'is-on' : ''} onClick={() => setCategory(c.key)}>{c.label}</button>
            ))}
          </div>
          <div className="g-disc__chips">
            {activeCat.items.map((i) => (
              <button key={i} type="button" aria-pressed={selected.includes(i)} className={selected.includes(i) ? 'is-on' : ''} onClick={() => toggle(i)}>{i}</button>
            ))}
          </div>
          <div className="g-disc__radius">
            <span><MapPin className="w-3.5 h-3.5" aria-hidden="true" />Distance</span>
            <button type="button" className={radius === null ? 'is-on' : ''} onClick={() => setRadius(null)}>Anywhere</button>
            {RADII.map((r) => <button key={r} type="button" className={radius === r ? 'is-on' : ''} onClick={() => setRadius(r)}>{r} km</button>)}
          </div>
        </div>
      )}

      {selected.length > 0 && (
        <div className="g-disc__active" aria-label="Selected interests">
          {selected.map((i) => <button key={i} type="button" onClick={() => toggle(i)}>{i}<X className="w-3 h-3" aria-hidden="true" /></button>)}
        </div>
      )}

      {myInterests.length === 0 && !filtering && (
        <button type="button" className="g-disc__nudge" onClick={onEditInterests}>
          <span><strong>Add your interests</strong><small>We rank people by what you share. Pick a few to get better matches.</small></span><UserPlus className="w-5 h-5" aria-hidden="true" />
        </button>
      )}

      {state === 'loading' && <div className="g-disc__skeleton" aria-hidden="true"><i /><i /><i /></div>}
      {state === 'error' && (
        <div className="g-disc__empty"><p>Couldn't load people just now.</p><button type="button" onClick={() => setAttempt((n) => n + 1)} className="g-btn g-btn--quiet">Try again</button></div>
      )}
      {state === 'ready' && people.length === 0 && (
        <div className="g-disc__empty">
          <h2>{filtering ? 'No one matches yet' : 'No one to show yet'}</h2>
          <p>{filtering ? 'Try fewer interests or a wider distance.' : 'GAYZE only shows real members who choose to be discovered. Check back soon, or invite a friend.'}</p>
          {filtering && <button type="button" className="g-btn g-btn--quiet" onClick={() => { setSelected([]); setQuery(''); setRadius(null); }}>Clear filters</button>}
        </div>
      )}

      {state === 'ready' && people.length > 0 && (
        <ul className="g-disc__list">
          {people.map((p) => (
            <li key={p.userId} className="g-disc__card">
              <button type="button" className="g-disc__main" onClick={() => onOpenProfile(p.userId, p.displayName)}>
                <Avatar p={p} />
                <span className="g-disc__body">
                  <strong>{p.displayName}{p.age ? <em>, {p.age}</em> : null}</strong>
                  <small>{[p.neighborhood, p.distanceKm ? `${p.distanceKm} km away` : ''].filter(Boolean).join(' · ') || (p.presence === 'online' ? 'Online now' : '')}</small>
                  {p.bio && <span className="g-disc__bio">{p.bio}</span>}
                  {p.interests.length > 0 && (
                    <span className="g-disc__tags">
                      {p.interests.slice(0, 6).map((i) => <i key={i} className={mine.has(i.toLowerCase()) || selected.some((s) => s.toLowerCase() === i.toLowerCase()) ? 'is-shared' : ''}>{i}</i>)}
                    </span>
                  )}
                </span>
              </button>
              {p.hasConversation ? (
                <button type="button" className="g-disc__cta" onClick={() => { if (!onOpenChat(p.userId)) showToast('Open Chats to continue this conversation.'); }}><MessageCircle className="w-4 h-4" aria-hidden="true" />Message</button>
              ) : p.canContact ? (
                <button type="button" className="g-disc__cta" onClick={() => setHello(p)}><MessageCircle className="w-4 h-4" aria-hidden="true" />Say hello</button>
              ) : (
                <span className="g-disc__locked">Connections only</span>
              )}
            </li>
          ))}
        </ul>
      )}
      {state === 'ready' && more && <button type="button" className="g-btn g-btn--quiet g-disc__more" onClick={() => void loadMore()}>Show more</button>}

      {hello && <HelloSheet person={hello} onClose={() => setHello(null)} onSent={() => { setPeople((prev) => prev.map((x) => (x.userId === hello.userId ? { ...x, canContact: false } : x))); setHello(null); showToast(`Hello sent to ${hello.displayName}`); }} showToast={showToast} sharedHint={hello.sharedInterests} />}
    </section>
  );
};

const HelloSheet: React.FC<{ person: DiscoverPerson; onClose: () => void; onSent: () => void; showToast: (m: string) => void; sharedHint: string[] }> = ({ person, onClose, onSent, showToast, sharedHint }) => {
  const [text, setText] = useState(sharedHint.length ? `Hi ${person.displayName}! I saw you're into ${sharedHint[0]} too.` : `Hi ${person.displayName}!`);
  const [busy, setBusy] = useState(false);
  const send = async () => {
    if (busy || !text.trim()) return;
    setBusy(true);
    const r = await submitInterest(person.userId, undefined, text.trim(), []);
    setBusy(false);
    if (r.sent) { onSent(); return; }
    showToast(r.errorCode === 'CONTACT_RESTRICTED' ? `${person.displayName} only accepts messages from connections.`
      : r.errorCode === 'GAYZE_COOLDOWN' ? 'You can say hello to someone new again later today.' : 'Could not send. Please try again.');
  };
  return createPortal(
    <div className="g-plan" role="dialog" aria-modal="true" aria-label={`Say hello to ${person.displayName}`} onClick={onClose}>
      <div className="g-plan__sheet" onClick={(e) => e.stopPropagation()}>
        <span className="g-plan__grip" aria-hidden="true" />
        <header className="g-plan__head">
          <span className="g-plan__badge"><MessageCircle className="w-5 h-5" /></span>
          <div className="g-plan__title"><small>New conversation</small><h3>Say hello to {person.displayName}</h3></div>
          <button type="button" className="g-plan__close" onClick={onClose} aria-label="Close"><X className="w-4 h-4" /></button>
        </header>
        <div className="g-plan__body">
          {sharedHint.length > 0 && <p className="g-plan__note">You both like {sharedHint.slice(0, 3).join(', ')}.</p>}
          <textarea className="g-field" rows={4} maxLength={500} value={text} onChange={(e) => setText(e.target.value)} aria-label="Your message" style={{ width: '100%', borderRadius: 14, padding: 12 }} />
          <p className="g-plan__note">They choose whether to accept. Once they do, you can chat.</p>
        </div>
        <footer className="g-plan__foot">
          <button type="button" className="g-plan__send" disabled={busy || !text.trim()} onClick={() => void send()}>
            <span>{busy ? 'Sending…' : 'Send hello'}</span>{busy && <Loader2 className="w-4 h-4 g-place__spin" />}
          </button>
        </footer>
      </div>
    </div>,
    document.body,
  );
};
