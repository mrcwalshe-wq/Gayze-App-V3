import React, { useEffect, useState } from 'react';
import { ShieldCheck, X, Radio } from 'lucide-react';
import { hapticLight } from '../services/hapticService';

export interface PeopleTile {
  key: string;
  userId?: string;
  name: string;
  age?: number;
  photo?: string;
  intent: string;
  area?: string;
  distance: string;
  expiresAt?: number;
  verified?: boolean;
  later?: boolean;
}

const hue = (s: string) => { let h = 0; for (let i = 0; i < s.length; i += 1) h = (h * 31 + s.charCodeAt(i)) % 360; return 250 + (h % 90); };
const left = (t?: number) => {
  if (!t) return '';
  const m = Math.round((t - Date.now()) / 60000);
  if (m <= 0) return '';
  return m < 60 ? `${m}m` : `${Math.floor(m / 60)}h${m % 60 ? ` ${String(m % 60).padStart(2, '0')}m` : ''}`;
};

const Photo: React.FC<{ tile: PeopleTile }> = ({ tile }) => {
  const [failed, setFailed] = useState(false);
  const ok = tile.photo && /^(https?:|data:|blob:)/i.test(tile.photo) && !failed;
  return (
    <div className="pg-tile__photo" style={{ ['--h' as string]: hue(tile.name) }}>
      {ok ? <img src={tile.photo} alt="" loading="lazy" draggable={false} onError={() => setFailed(true)} /> : <b aria-hidden="true">{tile.name.charAt(0).toUpperCase()}</b>}
    </div>
  );
};

/** The people around you as a grid of frosted-glass cards: photo first, one glass panel for the facts. */
export const PeopleGrid: React.FC<{ tiles: PeopleTile[]; onSelect: (key: string) => void; onClose: () => void; onFilter?: () => void }> = ({ tiles, onSelect, onClose, onFilter }) => {
  useEffect(() => { const k = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); }; document.addEventListener('keydown', k); return () => document.removeEventListener('keydown', k); }, [onClose]);
  return (
    <section className="pg" aria-label="People nearby">
      <header className="pg__head">
        <div><span>Right now</span><h2>{tiles.length} {tiles.length === 1 ? 'person' : 'people'} nearby</h2></div>
        {onFilter && <button type="button" className="pg__btn" onClick={() => { hapticLight(); onFilter(); }}>Filter</button>}
        <button type="button" className="pg__btn pg__btn--icon" onClick={() => { hapticLight(); onClose(); }} aria-label="Back to the map"><X className="w-4 h-4" /></button>
      </header>
      {tiles.length === 0 ? (
        <div className="pg__empty">
          <div className="pg__radar" aria-hidden="true"><i /><i /><i /><Radio className="w-5 h-5" /></div>
          <strong>No one live nearby</strong>
          <span>People appear here the moment they go live. Widen your distance to see more.</span>
          {onFilter && <button type="button" className="pg__btn pg__btn--wide" onClick={() => { hapticLight(); onFilter(); }}>Widen distance</button>}
        </div>
      ) : (
        <div className="pg__grid">
          {tiles.map((t, i) => (
            <button key={t.key} type="button" className="pg-tile" style={{ animationDelay: `${Math.min(i * 45, 450)}ms` }} onClick={() => { hapticLight(); onSelect(t.key); }}>
              <Photo tile={t} />
              <span className="pg-tile__shade" aria-hidden="true" />
              <span className="pg-tile__live">{left(t.expiresAt) ? <><i aria-hidden="true" />{left(t.expiresAt)}</> : <><i aria-hidden="true" />Live</>}</span>
              {t.verified && <span className="pg-tile__ver" aria-label="Verified"><ShieldCheck className="w-3.5 h-3.5" /></span>}
              <span className="pg-tile__glass">
                <strong>{t.name}{t.age ? <em>{t.age}</em> : null}</strong>
                <span className="pg-tile__row"><span className="pg-tile__intent">{t.intent}</span><span className="pg-tile__dist">{t.distance}</span></span>
              </span>
            </button>
          ))}
        </div>
      )}
    </section>
  );
};
