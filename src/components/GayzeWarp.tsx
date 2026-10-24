import React, { useEffect, useRef } from 'react';

/**
 * Hyperspace field for the go-live moment: stars stream out of the centre
 * toward the viewer (the logo is "arriving"), and when `burst` flips on a
 * ring of Gayze-coloured sparks erupts and the field relaxes to a calm drift.
 * Renders nothing animated for reduced-motion users.
 */
const HUES = ['#8b5cf6', '#b85cde', '#f08d9a', '#c9a24d', '#a78bfa', '#ffffff'];

interface Star { x: number; y: number; z: number; pz: number; c: string }
interface Spark { x: number; y: number; vx: number; vy: number; life: number; max: number; size: number; c: string }

export const GayzeWarp: React.FC<{ burst: boolean }> = ({ burst }) => {
  const ref = useRef<HTMLCanvasElement>(null);
  const burstRef = useRef(false);
  const burstAt = useRef<number | null>(null);

  useEffect(() => {
    if (burst && !burstRef.current) { burstRef.current = true; burstAt.current = performance.now(); }
  }, [burst]);

  useEffect(() => {
    const canvas = ref.current;
    const ctx = canvas?.getContext('2d');
    if (!canvas || !ctx) return;
    if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) return;
    let w = 0, h = 0, raf = 0, last = performance.now();
    const rand = (a: number, b: number) => a + Math.random() * (b - a);
    const stars: Star[] = [];
    const sparks: Spark[] = [];
    const start = performance.now();
    let burstDone = false;

    const resize = () => {
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      const r = canvas.getBoundingClientRect();
      w = r.width; h = r.height;
      canvas.width = Math.round(w * dpr); canvas.height = Math.round(h * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    };
    const spawnStar = (): Star => ({ x: rand(-1, 1), y: rand(-1, 1), z: rand(0.15, 1), pz: 0, c: HUES[Math.floor(Math.random() * HUES.length)] });
    resize();
    for (let i = 0; i < 260; i++) { const s = spawnStar(); s.pz = s.z; stars.push(s); }

    const frame = (t: number) => {
      const dt = Math.min(0.05, (t - last) / 1000); last = t;
      const age = (t - start) / 1000;
      // Warp speed: strong rush at the start, relaxing after the burst.
      const sinceBurst = burstAt.current ? (t - burstAt.current) / 1000 : -1;
      let speed = 0.55 + Math.max(0, 1.6 - age) * 1.4;
      if (sinceBurst >= 0) speed = 0.35 + Math.max(0, 0.5 - sinceBurst) * 5;
      const cx = w / 2, cy = h * 0.4, scale = Math.max(w, h) * 0.75;

      ctx.clearRect(0, 0, w, h);
      ctx.globalCompositeOperation = 'lighter';
      ctx.lineCap = 'round';
      for (const s of stars) {
        s.pz = s.z;
        s.z -= dt * speed * 0.5;
        if (s.z <= 0.02) { Object.assign(s, spawnStar()); s.pz = s.z = 1; continue; }
        const x0 = cx + (s.x / s.pz) * scale * 0.18, y0 = cy + (s.y / s.pz) * scale * 0.18;
        const x1 = cx + (s.x / s.z) * scale * 0.18, y1 = cy + (s.y / s.z) * scale * 0.18;
        if (x1 < -50 || x1 > w + 50 || y1 < -50 || y1 > h + 50) { Object.assign(s, spawnStar()); s.pz = s.z = 1; continue; }
        const k = 1 - s.z;
        ctx.globalAlpha = Math.min(1, k * 1.2) * 0.9;
        ctx.strokeStyle = s.c;
        ctx.lineWidth = 0.4 + k * 2.2;
        ctx.beginPath(); ctx.moveTo(x0, y0); ctx.lineTo(x1, y1); ctx.stroke();
      }

      if (sinceBurst >= 0 && !burstDone) {
        burstDone = true;
        for (let ring = 0; ring < 3; ring++) {
          const n = 56;
          for (let i = 0; i < n; i++) {
            const a = (i / n) * Math.PI * 2 + ring * 0.07;
            const v = rand(120, 360) * (1 + ring * 0.35);
            sparks.push({ x: cx, y: cy, vx: Math.cos(a) * v, vy: Math.sin(a) * v, life: 0, max: rand(0.9, 1.9), size: rand(1, 3), c: HUES[(i + ring) % HUES.length] });
          }
        }
      }
      for (let i = sparks.length - 1; i >= 0; i--) {
        const p = sparks[i];
        p.life += dt;
        if (p.life >= p.max) { sparks.splice(i, 1); continue; }
        const px = p.x, py = p.y;
        p.vx *= 0.985; p.vy = p.vy * 0.985 + 60 * dt;
        p.x += p.vx * dt; p.y += p.vy * dt;
        ctx.globalAlpha = (1 - p.life / p.max) * 0.95;
        ctx.strokeStyle = p.c; ctx.lineWidth = p.size;
        ctx.shadowColor = p.c; ctx.shadowBlur = 8;
        ctx.beginPath(); ctx.moveTo(px, py); ctx.lineTo(p.x, p.y); ctx.stroke();
        ctx.shadowBlur = 0;
      }
      ctx.globalAlpha = 1; ctx.globalCompositeOperation = 'source-over';
      raf = requestAnimationFrame(frame);
    };
    raf = requestAnimationFrame(frame);
    const onVis = () => { if (document.visibilityState === 'hidden') { cancelAnimationFrame(raf); raf = 0; } else if (!raf) { last = performance.now(); raf = requestAnimationFrame(frame); } };
    document.addEventListener('visibilitychange', onVis);
    window.addEventListener('resize', resize);
    return () => { cancelAnimationFrame(raf); document.removeEventListener('visibilitychange', onVis); window.removeEventListener('resize', resize); };
  }, []);

  return <canvas ref={ref} className="g-golive__canvas" aria-hidden="true" />;
};
