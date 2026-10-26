import React, { useEffect, useId, useRef, useState } from 'react';
import { Loader2, MapPin, Search, X } from 'lucide-react';
import { distanceKm, formatDistance, searchPlaces, type LatLng, type PlaceResult } from '../services/placeSearch';

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
  const picked = useRef<string | null>(null);
  const boxRef = useRef<HTMLDivElement | null>(null);
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

  const choose = (p: PlaceResult) => {
    picked.current = p.name.trim();
    onPick(p);
    setResults([]); setOpen(false);
  };

  return (
    <div className="g-place" ref={boxRef}>
      <div className="g-place__field">
        <Search className="w-4 h-4" aria-hidden="true" />
        <input
          id={id} type="text" required={required} value={value} autoComplete="off" autoCapitalize="words" maxLength={120}
          role="combobox" aria-expanded={open && results.length > 0} aria-controls={listId} aria-autocomplete="list"
          onChange={(e) => { picked.current = null; onTextChange(e.target.value); setOpen(true); }}
          onFocus={() => setOpen(true)}
          placeholder={placeholder}
          className={className}
        />
        {loading ? <Loader2 className="w-4 h-4 g-place__spin" aria-hidden="true" />
          : value && <button type="button" className="g-place__clear" aria-label="Clear" onClick={() => { picked.current = null; onTextChange(''); setResults([]); }}><X className="w-3.5 h-3.5" /></button>}
      </div>
      {open && (results.length > 0 || failed) && (
        <ul id={listId} role="listbox" className="g-place__list">
          {results.map((p) => (
            <li key={p.id + p.lat}>
              <button type="button" role="option" aria-selected="false" onClick={() => choose(p)}>
                <MapPin className="w-4 h-4" aria-hidden="true" />
                <span><strong>{p.name}</strong><small>{[p.kind, p.address, p.area].filter(Boolean).join(' · ')}</small></span>
                {near && <em>{formatDistance(distanceKm(near, p))}</em>}
              </button>
            </li>
          ))}
          {failed && results.length === 0 && <li className="g-place__note">Search is unavailable right now. You can type the venue instead.</li>}
          {results.length > 0 && <li className="g-place__note">Places from OpenStreetMap. A search result is not a verified Safe Haven.</li>}
        </ul>
      )}
    </div>
  );
};
