import React, { useEffect, useState } from 'react';
import { X, Minus, Plus } from 'lucide-react';
import type { Gathering } from '../types';
import { hapticLight } from '../services/hapticService';

const pad = (n: number) => String(n).padStart(2, '0');
const toLocalInput = (ms: number) => { const d = new Date(ms); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`; };

export interface PlanChanges { title: string; description: string; timestamp: number; capacity: number }

interface Props {
  plan: Gathering | null;
  onClose: () => void;
  onSave: (plan: Gathering, changes: PlanChanges) => Promise<boolean>;
}

/** The host changes a plan: what it is, when, and how many places. The venue stays as posted. */
export const EditPlanSheet: React.FC<Props> = ({ plan, onClose, onSave }) => {
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [when, setWhen] = useState('');
  const [capacity, setCapacity] = useState(8);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!plan) return;
    setTitle(plan.title); setDescription(plan.description); setWhen(toLocalInput(plan.timestamp)); setCapacity(plan.capacity); setError(null);
  }, [plan?.id]);

  if (!plan) return null;
  const joined = Math.max(1, plan.rsvpCount);
  const quick = (plan.tags ?? []).includes('quick');

  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    const timestamp = new Date(when).getTime();
    if (!title.trim()) { setError('Add a title.'); return; }
    if (!Number.isFinite(timestamp) || timestamp <= Date.now()) { setError('Choose a date and time in the future.'); return; }
    if (capacity < joined) { setError(`${joined} ${joined === 1 ? 'person has' : 'people have'} already joined, so there must be at least ${joined} places.`); return; }
    setBusy(true); setError(null);
    const ok = await onSave(plan, { title: title.trim(), description: description.trim(), timestamp, capacity });
    setBusy(false);
    if (ok) onClose(); else setError('Could not save the changes. Please try again.');
  };

  return (
    <div className="g-overlay flex items-end sm:items-center justify-center sm:p-4" role="dialog" aria-modal="true" aria-label="Edit plan" onClick={onClose}>
      <form className="g-sheet g-sheet--above-nav g-iset g-sheet--dark" onClick={(e) => e.stopPropagation()} onSubmit={save}>
        <div className="g-sheet__grip" />
        <div className="g-sheet__head">
          <div className="min-w-0">
            <h2 className="text-[16px] font-semibold tracking-[-0.015em] text-white leading-tight">{quick ? 'Edit quick plan' : 'Edit event'}</h2>
            <p className="text-[11px] text-zinc-500 leading-tight mt-0.5">{plan.rsvpCount > 1 ? `Everyone joining is told in the group chat when you change it.` : 'Nobody has joined yet.'}</p>
          </div>
          <button type="button" onClick={onClose} className="g-icon-btn g-icon-btn--bare shrink-0" aria-label="Close"><X className="w-5 h-5" /></button>
        </div>
        <div className="g-iset__body space-y-5 px-5 pb-2">
          <div>
            <label htmlFor="edit-title" className="g-label">{quick ? 'What is the plan?' : 'What is it?'}</label>
            <input id="edit-title" className="g-field g-iset__field mt-2.5" value={title} maxLength={80} onChange={(e) => setTitle(e.target.value)} />
          </div>
          <div>
            <label htmlFor="edit-desc" className="g-label">A line about it</label>
            <textarea id="edit-desc" className="g-field g-iset__field mt-2.5" rows={3} maxLength={300} value={description} onChange={(e) => setDescription(e.target.value)} />
          </div>
          <div>
            <label htmlFor="edit-when" className="g-label">When</label>
            <input id="edit-when" type="datetime-local" className="g-field g-iset__field mt-2.5" value={when} onChange={(e) => setWhen(e.target.value)} />
          </div>
          <div>
            <span className="g-label">Places</span>
            <div className="g-stepper mt-2.5">
              <button type="button" aria-label="Fewer places" onClick={() => { hapticLight(); setCapacity((c) => Math.max(joined, c - 1)); }}><Minus className="w-4 h-4" /></button>
              <input aria-label="Places" type="number" readOnly value={capacity} />
              <button type="button" aria-label="More places" onClick={() => { hapticLight(); setCapacity((c) => Math.min(200, c + 1)); }}><Plus className="w-4 h-4" /></button>
            </div>
            <p className="text-[11.5px] text-zinc-500 mt-2">{joined} already in</p>
          </div>
          {error && <p role="alert" className="text-[12.5px] text-red-300">{error}</p>}
        </div>
        <div className="g-sheet__foot">
          <button type="button" onClick={onClose} className="g-btn g-btn--quiet !min-h-[46px] !px-5">Cancel</button>
          <button type="submit" disabled={busy} className="g-btn g-btn--amber flex-1 !min-h-[46px] font-semibold">{busy ? 'Saving…' : 'Save changes'}</button>
        </div>
      </form>
    </div>
  );
};
