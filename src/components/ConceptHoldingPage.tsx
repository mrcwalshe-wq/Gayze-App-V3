import React from 'react';
import { ArrowUpRight, Lock } from 'lucide-react';

export const ConceptHoldingPage: React.FC = () => (
  <main className="relative flex min-h-screen w-full items-center justify-center overflow-hidden bg-[#09070f] px-6 py-12 text-white">
    <div aria-hidden="true" className="pointer-events-none absolute inset-0">
      <div className="absolute left-1/2 top-[42%] h-[34rem] w-[34rem] -translate-x-1/2 -translate-y-1/2 rounded-full bg-[#6F3CC3]/10 blur-[120px]" />
      <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_center,transparent_0%,rgba(9,7,15,0.82)_72%)]" />
      <div className="absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-[#C9A24D]/40 to-transparent" />
    </div>

    <div className="relative z-10 flex w-full max-w-xl flex-col items-center text-center">
      <div className="flex items-center gap-2">
        <span className="text-[1.65rem] font-semibold tracking-[0.28em]">GAYZE<span className="text-[#C9A24D]">.</span></span>
        <span className="rounded-full border border-[#6F3CC3]/60 px-2.5 py-1 font-mono text-[9px] tracking-[0.2em] text-[#c6a8f1]">ALPHA</span>
      </div>

      <div className="mt-24 flex flex-col items-center">
        <div className="mb-7 h-px w-12 bg-gradient-to-r from-transparent via-[#C9A24D] to-transparent" />
        <p className="font-mono text-[9px] uppercase tracking-[0.34em] text-[#C9A24D]">Concept Holding</p>
        <h1 className="mt-6 max-w-lg text-balance text-4xl font-light leading-[1.12] tracking-[-0.055em] sm:text-5xl">
          Something is<br />taking shape.
        </h1>
        <p className="mt-6 max-w-sm text-sm leading-7 text-white/45">
          A new perspective is forming.
        </p>
      </div>

      <a
        href="/login"
        className="mt-20 inline-flex min-h-12 items-center justify-center gap-3 rounded-full border border-white/15 bg-white/[0.035] px-6 text-[10px] font-medium uppercase tracking-[0.2em] text-white/75 transition hover:border-[#C9A24D]/60 hover:bg-white/[0.07] hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#C9A24D] focus-visible:ring-offset-4 focus-visible:ring-offset-[#09070f]"
      >
        <Lock size={13} strokeWidth={1.6} />
        Private access
        <ArrowUpRight size={13} strokeWidth={1.6} className="text-[#C9A24D]" />
      </a>

      <p className="mt-16 font-mono text-[9px] uppercase tracking-[0.19em] text-white/25">
        GAYZE LABS LTD <span className="mx-2 text-[#C9A24D]/60">/</span> Private concept development
      </p>
    </div>
  </main>
);
