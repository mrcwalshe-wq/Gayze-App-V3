import React, { useEffect, useRef, useState } from 'react';

export interface SwipeAction { key: string; label: string; icon: React.ReactNode; tone: 'archive' | 'danger'; onClick: () => void }

interface Props {
  actions: SwipeAction[];
  isOpen: boolean;
  onOpenChange: (open: boolean) => void;
  children: React.ReactNode;
  /** Storage key: the first time it is seen, the row nudges open and back once so people discover the slide. */
  hintKey?: string;
}

const ACTION_W = 84;

/**
 * Slide a row left to reveal actions behind it. Horizontal drags move the row; vertical drags still scroll the list.
 * A drag never counts as a tap on the row underneath.
 */
export const SwipeRow: React.FC<Props> = ({ actions, isOpen, onOpenChange, children, hintKey }) => {
  const [nudge, setNudge] = useState(false);
  useEffect(() => {
    if (!hintKey) return;
    let seen = false;
    try { seen = localStorage.getItem(hintKey) === '1'; } catch { seen = true; }
    if (seen || window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) return;
    const open = window.setTimeout(() => setNudge(true), 900);
    const close = window.setTimeout(() => { setNudge(false); try { localStorage.setItem(hintKey, '1'); } catch { /* shown again next time */ } }, 1700);
    return () => { window.clearTimeout(open); window.clearTimeout(close); };
  }, [hintKey]);
  const full = ACTION_W * actions.length;
  const start = useRef<{ x: number; y: number; base: number; locked: boolean | null } | null>(null);
  const moved = useRef(false);
  const [drag, setDrag] = useState<number | null>(null);
  const offset = drag ?? (isOpen ? -full : nudge ? -Math.min(56, full) : 0);

  const down = (e: React.PointerEvent) => {
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    start.current = { x: e.clientX, y: e.clientY, base: isOpen ? -full : 0, locked: null };
    moved.current = false;
  };
  const move = (e: React.PointerEvent) => {
    const s = start.current;
    if (!s) return;
    const dx = e.clientX - s.x, dy = e.clientY - s.y;
    if (s.locked === null) {
      if (Math.abs(dx) < 8 && Math.abs(dy) < 8) return;
      s.locked = Math.abs(dx) > Math.abs(dy);
      if (s.locked) { try { (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId); } catch { /* not capturable */ } }
    }
    if (!s.locked) return;
    moved.current = true;
    setDrag(Math.max(-full - 24, Math.min(0, s.base + dx)));
  };
  const up = () => {
    const s = start.current;
    start.current = null;
    if (!s || !s.locked || drag === null) { setDrag(null); return; }
    const open = drag < -full / 2.2;
    setDrag(null);
    if (open !== isOpen) onOpenChange(open);
  };
  // After a drag the browser still fires a click on the row: swallow it. A tap on an open row just closes it.
  const click = (e: React.MouseEvent) => {
    if (moved.current) { e.preventDefault(); e.stopPropagation(); moved.current = false; return; }
    if (isOpen) { e.preventDefault(); e.stopPropagation(); onOpenChange(false); }
  };

  if (actions.length === 0) return <>{children}</>;

  return (
    <div className="g-swipe" data-open={isOpen || undefined}>
      <div className="g-swipe__actions" style={{ width: full }} aria-hidden={!isOpen}>
        {actions.map((a) => (
          <button key={a.key} type="button" tabIndex={isOpen ? 0 : -1} className={`g-swipe__act is-${a.tone}`} style={{ width: ACTION_W }} onClick={() => { onOpenChange(false); a.onClick(); }}>
            {a.icon}<span>{a.label}</span>
          </button>
        ))}
      </div>
      <div
        className="g-swipe__body"
        style={{ transform: `translate3d(${offset}px,0,0)`, transition: drag === null ? 'transform .22s cubic-bezier(.2,.9,.3,1)' : 'none' }}
        onPointerDown={down} onPointerMove={move} onPointerUp={up} onPointerCancel={up} onClickCapture={click}
      >
        {children}
      </div>
    </div>
  );
};
