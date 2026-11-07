import React, { useEffect, useState } from 'react';
import { isSupabaseConfigured, supabase } from '../services/supabaseClient';
import { loadActiveIntent } from '../services/supabaseService';
import { intentThemeMode } from '../services/intentTiming';

type IntentLike = { mode?: string | null; when?: string | null; isPaused?: boolean | null } | null;

export function IntentEdgeGlow() {
  const [intent, setIntent] = useState<IntentLike>(null);

  useEffect(() => {
    let cancelled = false;
    const refresh = async () => {
      try {
        if (isSupabaseConfigured && supabase) {
          const { data } = await supabase.auth.getSession();
          if (data.session?.user) {
            const active = await loadActiveIntent();
            if (!cancelled) setIntent(active ?? null);
            return;
          }
        }
        if (typeof window !== 'undefined') {
          const raw = window.localStorage.getItem('gayze_active_intent');
          if (raw) {
            try { setIntent(JSON.parse(raw)); } catch { setIntent(null); }
          }
        }
      } catch {
        if (!cancelled) setIntent(null);
      }
    };
    void refresh();
    const timer = window.setInterval(() => { void refresh(); }, 2500);
    return () => { cancelled = true; window.clearInterval(timer); };
  }, []);

  if (!intent || intent.isPaused) return null;
  // Purple for anything within a day, gold for a signal planned for Later.
  const later = intentThemeMode({ when: intent.when ?? '' }) === 'social';
  const rgb = later ? '226,180,84' : '150,100,240';

  return (
    <>
      <style>{`.g-intent-edge-glow{position:fixed;inset:0;z-index:55;pointer-events:none;overflow:hidden;isolation:isolate}.g-intent-edge-glow__layer{position:absolute;inset:-3px;border-radius:30px;mix-blend-mode:screen;box-shadow:inset 0 0 2px rgba(var(--g-intent-rgb),.6),inset 0 0 22px rgba(var(--g-intent-rgb),.38),inset 0 0 60px rgba(var(--g-intent-rgb),.26),inset 0 0 130px rgba(var(--g-intent-rgb),.15);animation:g-intent-edge-breathe 3.8s ease-in-out infinite}.g-intent-edge-glow__layer--soft{inset:-8px;filter:blur(12px);opacity:.55;animation-delay:-1.2s}.g-intent-edge-glow__layer--outer{inset:-13px;filter:blur(24px);opacity:.36;animation-delay:-2.4s}@keyframes g-intent-edge-breathe{0%,100%{opacity:.7;transform:scale(1)}50%{opacity:1;transform:scale(1.002)}}@media (prefers-reduced-motion:reduce){.g-intent-edge-glow__layer{animation:none;opacity:.55}.g-intent-edge-glow__layer--soft,.g-intent-edge-glow__layer--outer{animation:none}}@media (max-width:480px){.g-intent-edge-glow__layer{border-radius:24px;box-shadow:inset 0 0 2px rgba(var(--g-intent-rgb),.6),inset 0 0 18px rgba(var(--g-intent-rgb),.38),inset 0 0 50px rgba(var(--g-intent-rgb),.26),inset 0 0 100px rgba(var(--g-intent-rgb),.15)}}`}</style>
      <div className="g-intent-edge-glow" style={{ '--g-intent-rgb': rgb } as React.CSSProperties} aria-hidden="true">
        <span className="g-intent-edge-glow__layer g-intent-edge-glow__layer--outer" />
        <span className="g-intent-edge-glow__layer g-intent-edge-glow__layer--soft" />
        <span className="g-intent-edge-glow__layer" />
      </div>
    </>
  );
}
