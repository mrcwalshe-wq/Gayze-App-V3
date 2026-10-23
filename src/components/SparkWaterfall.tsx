import React, { useEffect, useRef } from 'react';

/**
 * Cascading GAYZE light: columns of falling light-streaks (the waterfall) with
 * showers of sparks, flares and the odd burst, drawn on one canvas.
 * Pauses while the page is hidden and renders a single still frame for
 * reduced-motion users.
 */
type Palette = string[];
const PALETTES: Record<'private' | 'social', Palette> = {
  // Gayze hues: violet → magenta → rose → gold, with white-hot cores.
  private: ['#8b5cf6', '#b85cde', '#f08d9a', '#c9a24d', '#a78bfa', '#ffffff'],
  social: ['#c9a24d', '#f0c866', '#f08d9a', '#b85cde', '#ffe9a8', '#ffffff'],
};

interface Spark { x: number; y: number; vx: number; vy: number; life: number; max: number; size: number; color: string; flare: boolean }

export const SparkWaterfall: React.FC<{ mode: 'private' | 'social' }> = ({ mode }) => {
  const ref = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = ref.current;
    const ctx = canvas?.getContext('2d');
    if (!canvas || !ctx) return;
    const palette = PALETTES[mode];
    const reduced = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;
    let width = 0;
    let height = 0;
    let raf = 0;
    let last = 0;
    let spawnCarry = 0;
    let burstTimer = 0.6;
    const sparks: Spark[] = [];
    const rand = (a: number, b: number) => a + Math.random() * (b - a);
    const pick = () => palette[Math.floor(Math.random() * palette.length)];

    // Waterfall columns: each streams dashes of light downward at its own speed.
    interface Column { x: number; speed: number; offset: number; dash: number; gap: number; width: number; color: string; alpha: number }
    let columns: Column[] = [];

    const resize = () => {
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      const rect = canvas.getBoundingClientRect();
      width = Math.max(1, rect.width);
      height = Math.max(1, rect.height);
      canvas.width = Math.round(width * dpr);
      canvas.height = Math.round(height * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      const count = Math.max(14, Math.round(width / 14));
      columns = Array.from({ length: count }, (_, i) => ({
        x: ((i + 0.5) / count) * width + rand(-5, 5),
        speed: rand(70, 190),
        offset: rand(0, 400),
        dash: rand(10, 34),
        gap: rand(14, 60),
        width: rand(0.8, 2.2),
        color: palette[i % palette.length],
        alpha: rand(0.25, 0.6),
      }));
    };

    const emit = (x: number, y: number, vx: number, vy: number, flare = false) => {
      if (sparks.length > 320) return;
      sparks.push({ x, y, vx, vy, life: 0, max: flare ? rand(0.7, 1.4) : rand(0.8, 2.0), size: flare ? rand(1.6, 3.2) : rand(0.6, 2.0), color: pick(), flare });
    };

    const burst = () => {
      const cx = rand(width * 0.15, width * 0.85);
      const cy = rand(height * 0.2, height * 0.6);
      const n = 26;
      for (let i = 0; i < n; i++) {
        const a = (i / n) * Math.PI * 2 + rand(-0.1, 0.1);
        const s = rand(40, 130);
        emit(cx, cy, Math.cos(a) * s, Math.sin(a) * s - 20, true);
      }
    };

    const frame = (t: number, still = false) => {
      const dt = still ? 0 : Math.min(0.05, (t - last) / 1000 || 0.016);
      last = t;
      ctx.clearRect(0, 0, width, height);
      ctx.globalCompositeOperation = 'lighter';

      // Waterfall streaks.
      for (const c of columns) {
        const period = c.dash + c.gap;
        const base = still ? c.offset : (t / 1000) * c.speed + c.offset;
        const grad = ctx.createLinearGradient(0, 0, 0, height);
        grad.addColorStop(0, 'rgba(0,0,0,0)');
        grad.addColorStop(0.18, c.color);
        grad.addColorStop(0.82, c.color);
        grad.addColorStop(1, 'rgba(0,0,0,0)');
        ctx.strokeStyle = grad;
        ctx.lineWidth = c.width;
        ctx.globalAlpha = c.alpha;
        ctx.lineCap = 'round';
        ctx.beginPath();
        for (let y = (base % period) - period; y < height; y += period) {
          ctx.moveTo(c.x, y);
          ctx.lineTo(c.x, y + c.dash);
        }
        ctx.stroke();
      }

      // Spark shower from the top edge, plus occasional bursts.
      if (!still) {
        spawnCarry += dt * 70;
        while (spawnCarry >= 1) {
          spawnCarry -= 1;
          emit(rand(0, width), -4, rand(-14, 14), rand(60, 170));
        }
        burstTimer -= dt;
        if (burstTimer <= 0) { burst(); burstTimer = rand(1.2, 2.6); }
      }

      for (let i = sparks.length - 1; i >= 0; i--) {
        const s = sparks[i];
        s.life += dt;
        if (s.life >= s.max || s.y > height + 8) { sparks.splice(i, 1); continue; }
        s.vy += (s.flare ? 90 : 120) * dt;
        s.vx *= s.flare ? 0.985 : 1;
        const px = s.x;
        const py = s.y;
        s.x += s.vx * dt;
        s.y += s.vy * dt;
        const k = 1 - s.life / s.max;
        ctx.globalAlpha = Math.max(0, k) * 0.95;
        ctx.strokeStyle = s.color;
        ctx.lineWidth = s.size;
        ctx.lineCap = 'round';
        ctx.beginPath();
        ctx.moveTo(px - s.vx * dt * 2.2, py - s.vy * dt * 2.2);
        ctx.lineTo(s.x, s.y);
        ctx.stroke();
        ctx.shadowColor = s.color;
        ctx.shadowBlur = s.flare ? 10 : 6;
        ctx.fillStyle = '#fff6dc';
        ctx.beginPath();
        ctx.arc(s.x, s.y, s.size * 0.55, 0, Math.PI * 2);
        ctx.fill();
        ctx.shadowBlur = 0;
      }
      ctx.globalAlpha = 1;
      ctx.globalCompositeOperation = 'source-over';
    };

    const loop = (t: number) => {
      frame(t);
      raf = requestAnimationFrame(loop);
    };
    const start = () => { if (!raf && !reduced) { last = performance.now(); raf = requestAnimationFrame(loop); } };
    const stop = () => { if (raf) cancelAnimationFrame(raf); raf = 0; };
    const onVisibility = () => (document.visibilityState === 'hidden' ? stop() : start());

    resize();
    if (reduced) frame(0, true); else start();
    const observer = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(() => { resize(); if (reduced) frame(0, true); }) : null;
    observer?.observe(canvas);
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      stop();
      observer?.disconnect();
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, [mode]);

  return <canvas ref={ref} className="peer-intent-card__canvas" aria-hidden="true" />;
};
