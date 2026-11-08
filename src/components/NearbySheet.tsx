import React, { useCallback, useEffect, useRef, useState } from 'react';
import { ChevronDown, ChevronUp } from 'lucide-react';
import type { PeopleTile } from './PeopleGrid';
import { hapticLight } from '../services/hapticService';

const left = (t?: number) => {
  if (!t) return '';
  const m = Math.round((t - Date.now()) / 60000);
  if (m <= 0) return '';
  return m < 60 ? `${m}m` : `${Math.floor(m / 60)}h${m % 60 ? ` ${String(m % 60).padStart(2, '0')}m` : ''}`;
};
const hue = (s: string) => { let h = 0; for (let i = 0; i < s.length; i += 1) h = (h * 31 + s.charCodeAt(i)) % 360; return 250 + (h % 90); };

const Face: React.FC<{ tile: PeopleTile; size: number }> = ({ tile, size }) => {
  const [failed, setFailed] = useState(false);
  const ok = tile.photo && /^(https?:|data:|blob:)/i.test(tile.photo) && !failed;
  return (
    <span className="ns-face" style={{ width: size, height: size, ['--h' as string]: hue(tile.name) }}>
      {ok ? <img src={tile.photo} alt="" loading="lazy" draggable={false} onError={() => setFailed(true)} /> : <b aria-hidden="true">{tile.name.charAt(0).toUpperCase()}</b>}
    </span>
  );
};

const PEEK = 154;
const halfHeight = () => Math.min(Math.round((typeof window === 'undefined' ? 800 : window.innerHeight) * 0.52), 440);

/**
 * A non-modal sheet over the map. It rests as a short "peek" (a count and a strip of faces) and drags or taps up to a list.
 * The map stays usable behind it. A visible chevron collapses it (a grab handle alone is easy to miss).
 */
export const NearbySheet: React.FC<{ tiles: PeopleTile[]; onSelect: (key: string) => void }> = ({ tiles, onSelect }) => {
  const [open, setOpen] = useState(false);
  const [drag, setDrag] = useState<number | null>(null);
  const start = useRef<{ y: number; base: number } | null>(null);
  const moved = useRef(false);
  const target = open ? halfHeight() : PEEK;
  const height = drag === null ? target : Math.max(PEEK, Math.min(halfHeight(), target + drag));

  // The map controls sit above the sheet, so tell them how tall it is.
  useEffect(() => {
    document.documentElement.style.setProperty('--nearby-sheet-h', `${target + 10}px`);
    return () => { document.documentElement.style.setProperty('--nearby-sheet-h', '0px'); };
  }, [target]);

  useEffect(() => {
    if (!open) return;
    const k = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    window.addEventListener('keydown', k);
    return () => window.removeEventListener('keydown', k);
  }, [open]);

  const onDown = useCallback((e: React.PointerEvent) => {
    start.current = { y: e.clientY, base: target }; moved.current = false;
    (e.currentTarget as HTMLElement).setPointerCapture?.(e.pointerId);
  }, [target]);
  const onMove = useCallback((e: React.PointerEvent) => {
    if (!start.current) return;
    const dy = start.current.y - e.clientY; // up is positive
    if (Math.abs(dy) > 4) moved.current = true;
    setDrag(dy);
  }, []);
  const onUp = useCallback(() => {
    if (!start.current) return;
    const dy = drag ?? 0;
    start.current = null; setDrag(null);
    if (!moved.current) { hapticLight(); setOpen((v) => !v); return; }
    if (dy > 36) setOpen(true); else if (dy < -36) setOpen(false);
  }, [drag]);

  if (tiles.length === 0) return null;

  return (
    <section className={`ns ${open ? 'is-open' : ''}`} style={{ height }} aria-label="People nearby" data-dragging={drag !== null}>
      <div className="ns__head" onPointerDown={onDown} onPointerMove={onMove} onPointerUp={onUp} onPointerCancel={onUp}>
        <span className="ns__grip" aria-hidden="true" />
        <div className="ns__title">
          <i aria-hidden="true" />
          <strong>{tiles.length} {tiles.length === 1 ? 'person' : 'people'} nearby</strong>
          <span>Right now</span>
        </div>
        <button type="button" className="ns__toggle" aria-expanded={open} aria-label={open ? 'Collapse the list' : 'Expand the list'} onPointerDown={(e) => e.stopPropagation()} onClick={() => { hapticLight(); setOpen((v) => !v); }}>
          {open ? <ChevronDown className="w-[18px] h-[18px]" /> : <ChevronUp className="w-[18px] h-[18px]" />}
        </button>
      </div>

      {!open ? (
        <div className="ns__strip no-scrollbar" role="list">
          {tiles.map((t) => (
            <button key={t.key} type="button" role="listitem" className="ns__chip" data-tone={t.later ? 'gold' : 'purple'} onClick={() => { hapticLight(); onSelect(t.key); }} aria-label={`${t.name}, ${t.distance}`}>
              <Face tile={t} size={48} />
              <span className="ns__name">{t.name}</span>
              <span className="ns__dist">{t.distance}</span>
            </button>
          ))}
        </div>
      ) : (
        <ul className="ns__list">
          {tiles.map((t) => (
            <li key={t.key}>
              <button type="button" className="ns__row" data-tone={t.later ? 'gold' : 'purple'} onClick={() => { hapticLight(); onSelect(t.key); }}>
                <Face tile={t} size={44} />
                <span className="ns__who">
                  <strong>{t.name}{t.age ? <em>{t.age}</em> : null}</strong>
                  <span className="ns__intent">{t.intent}</span>
                </span>
                <span className="ns__meta"><b>{t.distance}</b>{left(t.expiresAt) && <small>{left(t.expiresAt)} left</small>}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
};
