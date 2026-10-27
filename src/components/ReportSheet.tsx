import React, { useState } from 'react';
import { createPortal } from 'react-dom';
import { Flag, Loader2, X } from 'lucide-react';
import { REPORT_REASONS, submitReport, type ReportReason } from '../services/reportService';

interface ReportSheetProps {
  reportedId: string;
  reportedName: string;
  conversationId?: string | null;
  onClose: () => void;
  onSubmitted: () => void;
}

/** Bottom sheet for reporting a member. Required by the App Store and Google Play for user-generated content. */
export default function ReportSheet({ reportedId, reportedName, conversationId, onClose, onSubmitted }: ReportSheetProps) {
  const [reason, setReason] = useState<ReportReason | null>(null);
  const [details, setDetails] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const send = async () => {
    if (!reason || busy) return;
    setBusy(true);
    setError(null);
    try {
      await submitReport({ reportedId, conversationId, reason, details });
      onSubmitted();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not send your report. Try again.');
      setBusy(false);
    }
  };

  return createPortal(
    <div className="fixed inset-0 z-[100] flex items-end justify-center bg-black/70" role="dialog" aria-modal="true" aria-label={`Report ${reportedName}`} onClick={onClose}>
      <div className="w-full max-w-md rounded-t-3xl border border-white/10 bg-[#0b0810] p-5 pb-8 text-white" onClick={(e) => e.stopPropagation()}>
        <div className="mb-3 flex items-center justify-between">
          <h2 className="flex items-center gap-2 text-base font-bold"><Flag className="h-4 w-4 text-red-300" />Report {reportedName}</h2>
          <button type="button" onClick={onClose} aria-label="Close" className="rounded-full p-2 text-zinc-400 hover:text-white"><X className="h-4 w-4" /></button>
        </div>
        <p className="mb-3 text-xs text-zinc-400">Reports are private. Our team reviews them, and the person is not told who reported them.</p>
        <div className="mb-3 flex flex-col gap-2">
          {REPORT_REASONS.map((r) => (
            <button
              key={r}
              type="button"
              onClick={() => setReason(r)}
              aria-pressed={reason === r}
              className={`rounded-xl border px-3 py-2.5 text-left text-sm ${reason === r ? 'border-[#c9a24d] bg-white/10' : 'border-white/10 bg-white/5'}`}
            >{r}</button>
          ))}
        </div>
        <textarea
          value={details}
          onChange={(e) => setDetails(e.target.value.slice(0, 1000))}
          placeholder="Add details (optional)"
          rows={3}
          className="mb-3 w-full rounded-xl border border-white/10 bg-white/5 p-3 text-sm text-white placeholder:text-zinc-500"
        />
        {error && <p role="alert" className="mb-3 text-xs text-red-300">{error}</p>}
        <button
          type="button"
          onClick={() => void send()}
          disabled={!reason || busy}
          className="flex h-12 w-full items-center justify-center gap-2 rounded-xl bg-red-500/90 text-sm font-bold text-white disabled:opacity-40"
        >{busy ? <Loader2 className="h-4 w-4 animate-spin" /> : null}Send report</button>
        <p className="mt-3 text-center text-[11px] text-zinc-500">In immediate danger? Contact your local emergency services.</p>
      </div>
    </div>,
    document.body,
  );
}
