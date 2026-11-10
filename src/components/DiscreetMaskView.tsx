import React, { useEffect, useRef, useState } from 'react';

interface DiscreetMaskViewProps {
  onExitMask: () => void;
}

/* ---------------------------------------------------------------------------------------------
   Discreet mask: a believable ordinary screen that covers GAYZE instantly.
   - A different disguise is picked at random each time (never the same one twice in a row).
   - To go back: press and hold the bottom-right corner (right thumb) for about a second, or press Escape.
     Nothing on screen says how, so a bystander sees an ordinary app.
   --------------------------------------------------------------------------------------------- */

/** Invisible hold target in the bottom-right corner: the way back. */
const RestoreCorner: React.FC<{ onRestore: () => void }> = ({ onRestore }) => {
  const timer = useRef<number | null>(null);
  const clear = () => { if (timer.current != null) { window.clearTimeout(timer.current); timer.current = null; } };
  useEffect(() => clear, []);
  return (
    <div
      aria-hidden="true"
      className="fixed right-0 bottom-0 z-[80] select-none"
      style={{ width: 96, height: 96, paddingBottom: 'env(safe-area-inset-bottom, 0px)', touchAction: 'none', WebkitTouchCallout: 'none' }}
      onPointerDown={() => { clear(); timer.current = window.setTimeout(onRestore, 900); }}
      onPointerUp={clear}
      onPointerLeave={clear}
      onPointerCancel={clear}
      onContextMenu={(e) => e.preventDefault()}
    />
  );
};

/* ---- 1. Calculator -------------------------------------------------------------------------- */
const Calculator: React.FC = () => {
  const [display, setDisplay] = useState('0');
  const [acc, setAcc] = useState<number | null>(null);
  const [op, setOp] = useState<string | null>(null);
  const [fresh, setFresh] = useState(true);
  const apply = (a: number, b: number, o: string) => (o === '+' ? a + b : o === '−' ? a - b : o === '×' ? a * b : b === 0 ? NaN : a / b);
  const fmt = (n: number) => (Number.isFinite(n) ? String(Math.round(n * 1e9) / 1e9) : 'Error');
  const press = (k: string) => {
    if (/^\d$/.test(k)) { setDisplay((d) => (fresh || d === '0' ? k : d.length < 12 ? d + k : d)); setFresh(false); return; }
    if (k === '.') { setDisplay((d) => (fresh ? '0.' : d.includes('.') ? d : d + '.')); setFresh(false); return; }
    if (k === 'AC') { setDisplay('0'); setAcc(null); setOp(null); setFresh(true); return; }
    if (k === '±') { setDisplay((d) => (d.startsWith('-') ? d.slice(1) : d === '0' ? d : '-' + d)); return; }
    if (k === '%') { setDisplay((d) => fmt(parseFloat(d) / 100)); return; }
    const cur = parseFloat(display);
    if (acc != null && op && !fresh) { const r = apply(acc, cur, op); setDisplay(fmt(r)); setAcc(Number.isFinite(r) ? r : null); } else { setAcc(cur); }
    setOp(k === '=' ? null : k); setFresh(true);
  };
  const rows = [['AC', '±', '%', '÷'], ['7', '8', '9', '×'], ['4', '5', '6', '−'], ['1', '2', '3', '+'], ['0', '.', '=']];
  return (
    <div className="fixed inset-0 z-50 bg-black text-white flex flex-col justify-end select-none px-4 pb-8" style={{ paddingBottom: 'calc(env(safe-area-inset-bottom, 0px) + 28px)' }}>
      <div className="text-right text-[76px] font-light leading-none mb-5 truncate tabular-nums">{display}</div>
      <div className="grid gap-3">
        {rows.map((r, i) => (
          <div key={i} className="grid grid-cols-4 gap-3">
            {r.map((k) => {
              const isOp = ['÷', '×', '−', '+', '='].includes(k);
              const isTop = ['AC', '±', '%'].includes(k);
              return (
                <button key={k} type="button" onClick={() => press(k)} aria-label={k}
                  className={`h-[78px] rounded-full text-[30px] active:brightness-125 ${k === '0' ? 'col-span-2 text-left pl-8' : ''} ${isOp ? 'bg-[#ff9f0a] text-white' : isTop ? 'bg-[#a5a5a5] text-black' : 'bg-[#333333] text-white'}`}>{k}</button>
              );
            })}
          </div>
        ))}
      </div>
    </div>
  );
};

/* ---- 2. Notes ------------------------------------------------------------------------------- */
const Notes: React.FC = () => {
  const [text, setText] = useState('Shopping\n\n- oat milk\n- eggs\n- spinach\n- washing-up liquid\n- birthday card for Mum\n\nRemember: parcel collection Thursday');
  return (
    <div className="fixed inset-0 z-50 flex flex-col text-[#f2f2f7]" style={{ background: '#1c1c1e', paddingTop: 'env(safe-area-inset-top, 0px)' }}>
      <div className="flex items-center justify-between px-4 h-12 text-[#ffd60a] text-[17px]"><span>‹ Notes</span><span>Done</span></div>
      <textarea value={text} onChange={(e) => setText(e.target.value)} spellCheck={false}
        className="flex-1 bg-transparent px-5 pt-2 text-[18px] leading-relaxed resize-none outline-none" aria-label="Note" />
    </div>
  );
};

/* ---- 3. Weather ----------------------------------------------------------------------------- */
const Weather: React.FC = () => {
  const hours = [['Now', '9°'], ['14', '10°'], ['15', '10°'], ['16', '9°'], ['17', '8°'], ['18', '7°']];
  const days = [['Tue', '10°', '6°'], ['Wed', '11°', '7°'], ['Thu', '9°', '5°'], ['Fri', '8°', '4°'], ['Sat', '10°', '6°']];
  return (
    <div className="fixed inset-0 z-50 overflow-y-auto text-white select-none" style={{ background: 'linear-gradient(180deg, #3a5a7a 0%, #1f3248 100%)', paddingTop: 'calc(env(safe-area-inset-top, 0px) + 56px)', paddingBottom: 'calc(env(safe-area-inset-bottom, 0px) + 24px)' }}>
      <div className="text-center">
        <div className="text-[30px]">London</div>
        <div className="text-[92px] font-extralight leading-none">9°</div>
        <div className="text-[20px] opacity-80">Mostly cloudy</div>
        <div className="text-[18px] opacity-80">H:11°  L:6°</div>
      </div>
      <div className="mx-4 mt-8 rounded-2xl bg-white/15 p-4">
        <div className="text-[13px] opacity-70 mb-3">Cloudy conditions expected around 16:00</div>
        <div className="flex justify-between">{hours.map(([h, t]) => <div key={h} className="text-center text-[15px]"><div className="opacity-80 mb-2">{h}</div><div>{t}</div></div>)}</div>
      </div>
      <div className="mx-4 mt-4 rounded-2xl bg-white/15 p-4">
        <div className="text-[13px] opacity-70 mb-2">5-day forecast</div>
        {days.map(([d, hi, lo]) => <div key={d} className="flex justify-between py-2 border-t border-white/10 first:border-0 text-[17px]"><span className="w-12">{d}</span><span className="opacity-70">{lo}</span><span>{hi}</span></div>)}
      </div>
    </div>
  );
};

/* ---- 4. Code editor ------------------------------------------------------------------------- */
const CodeEditor: React.FC = () => {
  const [text, setText] = useState(
`// src/engine/distributed_consensus.ts
import { EventEmitter } from 'events';

export interface PeerNodeConfig {
  nodeId: string;
  heartbeatIntervalMs: number;
  maxRetries: number;
  replicationFactor: number;
}

export class DistributedStreamEngine extends EventEmitter {
  private activeStreams: Map<string, ArrayBuffer> = new Map();

  constructor(private readonly config: PeerNodeConfig) {
    super();
    this.initializeClusterTopology();
  }

  private async initializeClusterTopology(): Promise<void> {
    console.log('[cluster] Synchronizing local shard tables...');
  }
}`);
  return (
    <div className="fixed inset-0 z-50 bg-[#1e1e1e] text-[#d4d4d4] font-mono text-xs flex flex-col select-none" style={{ paddingTop: 'env(safe-area-inset-top, 0px)' }}>
      <div className="h-9 bg-[#323233] border-b border-[#252526] px-3 flex items-center text-zinc-400 text-[11px]">distributed_consensus.ts — Workspace</div>
      <textarea value={text} onChange={(e) => setText(e.target.value)} spellCheck={false} aria-label="Editor"
        className="flex-1 bg-transparent text-[#9cdcfe] p-4 text-[13px] resize-none focus:outline-none leading-relaxed" />
      <div className="h-24 bg-[#181818] border-t border-[#2d2d2d] p-3 text-[11px] text-zinc-400">
        <div className="text-emerald-400">➜ cluster-core git:(main) bun run build</div>
        <div className="text-zinc-300">[10:41:02] Transpiled 48 modules in 14ms.</div>
      </div>
    </div>
  );
};

const DISGUISES = [Calculator, Notes, Weather, CodeEditor];
const LAST_KEY = 'gayze_mask_last';

/** A random disguise, never the same as the previous one. */
function pickDisguise(): number {
  let last = -1;
  try { last = Number(sessionStorage.getItem(LAST_KEY) ?? -1); } catch { /* storage may be blocked */ }
  let n = Math.floor(Math.random() * DISGUISES.length);
  if (n === last) n = (n + 1 + Math.floor(Math.random() * (DISGUISES.length - 1))) % DISGUISES.length;
  try { sessionStorage.setItem(LAST_KEY, String(n)); } catch { /* ignore */ }
  return n;
}

export const DiscreetMaskView: React.FC<DiscreetMaskViewProps> = ({ onExitMask }) => {
  const [index] = useState(pickDisguise);
  const Disguise = DISGUISES[index];

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onExitMask(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onExitMask]);

  return (
    <>
      <Disguise />
      <RestoreCorner onRestore={onExitMask} />
    </>
  );
};
