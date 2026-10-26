import React, { useEffect, useId, useRef, useState } from 'react';
import { Coffee, Hash, Loader2, MapPin, Search, Trees, TrainFront, Utensils, Wine, X } from 'lucide-react';
import { distanceKm, formatDistance, nearbyPlaces, searchPlaces, type LatLng, type PlaceResult } from '../services/placeSearch';

/** One-tap searches for the most common meeting spots. They search near you like anything typed. */
const PRESETS = [
  { label: 'Café', query: 'cafe', Icon: Coffee },
  { label: 'Bar', query: 'bar', Icon: Wine },
  { label: 'Pub', query: 'pub', Icon: Wine },
  { label: 'Restaurant', query: 'restaurant', Icon: Utensils },
  { label: 'Park', query: 'park', Icon: Trees },
  { label: 'Station', query: 'station', Icon: TrainFront },
] as const;

interface PlacePickerProps {
  /** The chosen place name (or whatever was typed). */
  value: string;
  onTextChange: (text: string) => void;
  onPick: (place: PlaceResult) => void;
  near: LatLng | null;
  placeholder?: string;
  id?: string;
  className?: string;
  required?: boolean;
}

/** Type a venue and pick a real place near you. Typing freely still works if the search is unavailable. */
export const PlacePicker: React.FC<PlacePickerProps> = ({ value, onTextChange, onPick, near, placeholder = 'Search for a place', id, className, required }) => {
  const [results, setResults] = useState<PlaceResult[]>([]);
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [failed, setFailed] = useState(false);
  const [postcodeMode, setPostcodeMode] = useState(false);
  const [focused, setFocused] = useState(false);
  const [browse, setBrowse] = useState<string | null>(null);
  const browseAbort = useRef<AbortController | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const picked = useRef<string | null>(null);
  const boxRef = useRef<HTMLDivElement | null>(null);
  const listRef = useRef<HTMLUListElement | null>(null);
  const listId = useId();

  useEffect(() => {
    const q = value.trim();
    if (q.length < 2 || picked.current === q) { setResults([]); setLoading(false); return; }
    const controller = new AbortController();
    setLoading(true);
    const timer = window.setTimeout(async () => {
      try {
        const found = await searchPlaces(q, near, controller.signal);
        if (near) found.sort((a, b) => distanceKm(near, a) - distanceKm(near, b));
        setResults(found); setFailed(false); setOpen(true);
      } catch {
        if (!controller.signal.aborted) { setResults([]); setFailed(true); }
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    }, 350);
    return () => { window.clearTimeout(timer); controller.abort(); };
  }, [value, near?.lat, near?.lng]);

  useEffect(() => {
    const close = (e: PointerEvent) => { if (!boxRef.current?.contains(e.target as Node)) setOpen(false); };
    document.addEventListener('pointerdown', close);
    return () => document.removeEventListener('pointerdown', close);
  }, []);

  // Inside a scrolling sheet the list can open below the visible area: bring it into view when it appears.
  const showing = open && (results.length > 0 || failed);
  useEffect(() => {
    if (showing) requestAnimationFrame(() => listRef.current?.scrollIntoView({ block: 'nearest', behavior: 'smooth' }));
  }, [showing, results.length]);

  // A category chip lists the nearest popular places of that kind around the member.
  const browseNearby = async (label: string, query: string) => {
    picked.current = null; setPostcodeMode(false);
    if (!near) { onTextChange(query); setOpen(true); return; }
    browseAbort.current?.abort();
    const controller = new AbortController();
    browseAbort.current = controller;
    setBrowse(label); setLoading(true); setOpen(true); setFailed(false); setResults([]);
    try {
      const found = await nearbyPlaces(query, near, controller.signal);
      if (controller.signal.aborted) return;
      found.sort((a, b) => distanceKm(near, a) - distanceKm(near, b));
      setResults(found);
      if (found.length === 0) setFailed(true);
    } catch {
      if (!controller.signal.aborted) { setResults([]); setFailed(true); }
    } finally {
      if (!controller.signal.aborted) setLoading(false);
    }
  };

  const choose = (p: PlaceResult) => {
    setBrowse(null);
    picked.current = p.name.trim();
    onPick(p);
    setResults([]); setOpen(false);
  };

  return (
    <div className="g-place" ref={boxRef}>
      <div className="g-place__field">
        <Search className="w-4 h-4" aria-hidden="true" />
        <input
          ref={inputRef} id={id} type="text" required={required} value={value} autoComplete="off" autoCapitalize="words" maxLength={120}
          role="combobox" aria-expanded={open && results.length > 0} aria-controls={listId} aria-autocomplete="list"
          onBlur={() => window.setTimeout(() => setFocused(false), 150)}
          onChange={(e) => { picked.current = null; setBrowse(null); onTextChange(e.target.value); setOpen(true); }}
          onFocus={() => { setFocused(true); setOpen(true); window.setTimeout(() => boxRef.current?.scrollIntoView({ block: 'center', behavior: 'smooth' }), 250); }}
          placeholder={postcodeMode ? 'Enter a postcode, e.g. M1 1AE' : placeholder}
          className={className}
        />
        {loading ? <Loader2 className="w-4 h-4 g-place__spin" aria-hidden="true" />
          : value && <button type="button" className="g-place__clear" aria-label="Clear" onClick={() => { picked.current = null; onTextChange(''); setResults([]); }}><X className="w-3.5 h-3.5" /></button>}
      </div>
      {(focused || browse) && !value.trim() && (
        <div className="g-place__chips" role="group" aria-label="Quick searches near you">
          {PRESETS.map(({ label, query, Icon }) => (
            <button key={query} type="button" onMouseDown={(e) => e.preventDefault()} onClick={() => void browseNearby(label, query)}>
              <Icon className="w-3.5 h-3.5" aria-hidden="true" />{label}
            </button>
          ))}
          <button type="button" className={postcodeMode ? 'is-on' : ''} onMouseDown={(e) => e.preventDefault()} onClick={() => { setPostcodeMode(true); inputRef.current?.focus(); }}>
            <Hash className="w-3.5 h-3.5" aria-hidden="true" />Postcode
          </button>
        </div>
      )}
      {open && (results.length > 0 || failed) && (
        <ul id={listId} ref={listRef} role="listbox" className="g-place__list">
          {browse && results.length > 0 && <li className="g-place__note">Closest {browse.toLowerCase()}s to you</li>}
          {results.map((p) => (
            <li key={p.id + p.lat}>
              <button type="button" role="option" aria-selected="false" onClick={() => choose(p)}>
                <MapPin className="w-4 h-4" aria-hidden="true" />
                <span><strong>{p.name}</strong><small>{[p.kind, p.address, p.area].filter(Boolean).join(' · ')}</small></span>
                {near && <em>{formatDistance(distanceKm(near, p))}</em>}
              </button>
            </li>
          ))}
          {failed && results.length === 0 && <li className="g-place__note">{browse ? `No ${browse.toLowerCase()}s found close by. Try typing a name.` : 'Search is unavailable right now. You can type the venue instead.'}</li>}
          {results.length > 0 && <li className="g-place__note">Places from OpenStreetMap. A search result is not a verified Safe Haven.</li>}
        </ul>
      )}
    </div>
  );
};
