import React from 'react';
import { callLog, webrtcCallService } from '../services/webrtcService';

/** A reload in the middle of a call ends it. Hold the reload until the call is over (the next navigation picks up the new version). */
const callInProgress = () => { const s = webrtcCallService.getState(); return s !== 'idle' && s !== 'ended' && s !== 'failed' && s !== 'declined' && s !== 'missed'; };
const reloadForNewVersion = (why: string) => {
  if (callInProgress()) { callLog(`page reload skipped during a call (${why})`); return; }
  callLog(`page reload: ${why}`);
  window.location.reload();
};

interface State { failed: boolean }

const RELOAD_FLAG = 'gayze_error_reload_at';

/** A stale tab after a new release can't load its old script files. One automatic reload gets the new version. */
export function installChunkReload() {
  if (typeof window === 'undefined') return;
  // index.html has its own early handler for the same event; it asks here before reloading.
  (window as unknown as { __gayzeCallInProgress?: () => boolean }).__gayzeCallInProgress = callInProgress;
  window.addEventListener('vite:preloadError', (event) => {
    event.preventDefault();
    try {
      const last = Number(sessionStorage.getItem(RELOAD_FLAG) || 0);
      if (Date.now() - last > 30_000) { sessionStorage.setItem(RELOAD_FLAG, String(Date.now())); reloadForNewVersion('a script file was out of date'); }
    } catch { reloadForNewVersion('a script file was out of date'); }
  });
}

/**
 * Without this, any error while drawing the app leaves a blank black screen. Now people get a way back in, and the
 * error is logged so it can be found.
 */
export class AppErrorBoundary extends React.Component<{ children: React.ReactNode }, State> {
  state: State = { failed: false };
  static getDerivedStateFromError(): State { return { failed: true }; }
  componentDidCatch(error: unknown, info: React.ErrorInfo) {
    console.error('[GAYZE] The app hit an error and could not draw:', error, info.componentStack);
    const message = error instanceof Error ? error.message : String(error);
    // An out-of-date script file is fixed by reloading once.
    if (/Loading chunk|dynamically imported module|Importing a module script failed|error loading dynamically/i.test(message)) {
      try {
        const last = Number(sessionStorage.getItem(RELOAD_FLAG) || 0);
        if (Date.now() - last > 30_000) { sessionStorage.setItem(RELOAD_FLAG, String(Date.now())); reloadForNewVersion('an out-of-date script file broke the screen'); }
      } catch { /* storage unavailable */ }
    }
  }
  render() {
    if (!this.state.failed) return this.props.children;
    return (
      <div role="alert" style={{ minHeight: '100dvh', display: 'grid', placeItems: 'center', padding: 24, background: '#09070f', color: '#fff', textAlign: 'center' }}>
        <div style={{ maxWidth: 340 }}>
          <div style={{ fontSize: 22, fontWeight: 800, letterSpacing: '.2em' }}>GAYZE<span style={{ color: '#C9A24D' }}>.</span></div>
          <h1 style={{ margin: '22px 0 8px', fontSize: 18 }}>Something went wrong</h1>
          <p style={{ margin: '0 0 20px', fontSize: 14, lineHeight: 1.5, color: 'rgba(255,255,255,.65)' }}>The app hit a problem drawing this screen. Your messages are safe. Reloading usually fixes it.</p>
          <button type="button" onClick={() => window.location.reload()} style={{ height: 46, padding: '0 22px', border: 0, borderRadius: 14, fontSize: 15, fontWeight: 700, color: '#fff', background: '#6F3CC3' }}>Reload GAYZE</button>
        </div>
      </div>
    );
  }
}
