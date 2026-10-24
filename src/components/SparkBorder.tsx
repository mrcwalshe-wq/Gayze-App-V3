import React, { useEffect, useRef } from 'react';

/**
 * A sparkler that runs around the edge of its parent.
 * A white-hot head travels the card's rounded-rectangle outline and sheds sparks
 * the way a real one does: they leave fast, drag slows them, gravity pulls them
 * down, they cool from white through the brand colour to a dull ember, and the
 * bigger ones crackle into smaller sparks as they die. Selecting a card strikes
 * it: a flurry fires from all around the border at once.
 * The canvas is larger than the parent so sparks can fall past its edges.
 */
const PAD = 34;

type Tone = 'private' | 'social';
// [hot, mid, ember] as RGB triples; spark colour is interpolated along its life.
const TEMPS: Record<Tone, [number[], number[], number[]]> = {
  private: [[255, 244, 255], [196, 120, 255], [120, 40, 150]],
  social: [[255, 250, 225], [255, 196, 90], [210, 80, 40]],
};

interface P { x: number; y: number; vx: number; vy: number; age: number; life: number; size: number; child: boolean }

const mix = (a: number[], b: number[], k: number) => [a[0] + (b[0] - a[0]) * k, a[1] + (b[1] - a[1]) * k, a[2] + (b[2] - a[2]) * k];

export const SparkBorder: React.FC<{ tone: Tone }> = ({ tone }) => {
  const ref = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = ref.current;
    const ctx = canvas?.getContext('2d');
    const host = canvas?.parentElement;
    if (!canvas || !ctx || !host) return;
    if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) return;

    const [hot, mid, ember] = TEMPS[tone];
    let w = 0, h = 0, r = 16, raf = 0, last = performance.now(), head = Math.random(), emitCarry = 0, flick = 0;
    const parts: P[] = [];
    const rand = (a: number, b: number) => a + Math.random() * (b - a);

    const measure = () => {
      const rect = host.getBoundingClientRect();
      w = Math.max(40, rect.width); h = Math.max(40, rect.height);
      r = Math.min(parseFloat(getComputedStyle(host).borderTopLeftRadius) || 16, w / 2, h / 2);
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      canvas.width = Math.round((w + PAD * 2) * dpr); canvas.height = Math.round((h + PAD * 2) * dpr);
      canvas.style.width = `${w + PAD * 2}px`; canvas.style.height = `${h + PAD * 2}px`;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    };

    // Point and outward normal at fraction u (0..1) of the outline, clockwise from the top-left.
    const outline = (u: number) => {
      const a = w - 2 * r, b = h - 2 * r, arc = (Math.PI * r) / 2, per = 2 * a + 2 * b + 4 * arc;
      let s = ((u % 1) + 1) % 1 * per;
      const seg = (len: number) => { if (s <= len) return true; s -= len; return false; };
      if (seg(a)) return { x: r + s, y: 0, nx: 0, ny: -1 };
      if (seg(arc)) { const t = s / r; return { x: w - r + Math.sin(t) * r, y: r - Math.cos(t) * r, nx: Math.sin(t), ny: -Math.cos(t) }; }
      if (seg(b)) return { x: w, y: r + s, nx: 1, ny: 0 };
      if (seg(arc)) { const t = s / r; return { x: w - r + Math.cos(t) * r, y: h - r + Math.sin(t) * r, nx: Math.cos(t), ny: Math.sin(t) }; }
      if (seg(a)) return { x: w - r - s, y: h, nx: 0, ny: 1 };
      if (seg(arc)) { const t = s / r; return { x: r - Math.sin(t) * r, y: h - r + Math.cos(t) * r, nx: -Math.sin(t), ny: Math.cos(t) }; }
      if (seg(b)) return { x: 0, y: h - r - s, nx: -1, ny: 0 };
      const t = s / r; return { x: r - Math.cos(t) * r, y: r - Math.sin(t) * r, nx: -Math.cos(t), ny: -Math.sin(t) };
    };

    const emit = (u: number, speed: number, spread: number, big = false) => {
      const o = outline(u);
      const ang = Math.atan2(o.ny, o.nx) + rand(-spread, spread);
      const sp = speed * rand(0.35, 1);
      parts.push({ x: o.x, y: o.y, vx: Math.cos(ang) * sp, vy: Math.sin(ang) * sp - rand(0, 40), age: 0, life: rand(0.45, 1.25) * (big ? 1.2 : 1), size: big ? rand(1.4, 2.4) : rand(0.7, 1.6), child: false });
    };

    // Strike: the whole border throws sparks at once.
    for (let i = 0; i < 46; i++) emit(Math.random(), rand(90, 260), 0.9, i % 4 === 0);

    measure();
    const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(measure) : null;
    ro?.observe(host);

    const frame = (t: number) => {
      const dt = Math.min(0.04, (t - last) / 1000); last = t;
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      ctx.save(); ctx.translate(PAD, PAD);
      ctx.globalCompositeOperation = 'lighter'; ctx.lineCap = 'round';

      // Head travels the outline at a steady pace and sheds sparks backwards and outwards.
      const lap = 3.4; // seconds per lap
      head = (head + dt / lap) % 1;
      emitCarry += dt * 120;
      while (emitCarry >= 1) { emitCarry -= 1; emit(head - rand(0, 0.004), rand(60, 210), 1.15, Math.random() < 0.18); }
      // Occasional spit: a fast, long spark.
      if (Math.random() < dt * 3.2) emit(head, rand(220, 340), 0.5, true);

      for (let i = parts.length - 1; i >= 0; i--) {
        const p = parts[i];
        p.age += dt;
        if (p.age >= p.life) {
          if (!p.child && p.size > 1.5 && Math.random() < 0.7) {
            // Crackle: the spark pops into a few tiny ones.
            for (let c = 0; c < 4; c++) {
              const a = rand(0, Math.PI * 2), sp = rand(30, 120);
              parts.push({ x: p.x, y: p.y, vx: p.vx * 0.3 + Math.cos(a) * sp, vy: p.vy * 0.3 + Math.sin(a) * sp, age: 0, life: rand(0.15, 0.4), size: 0.7, child: true });
            }
          }
          parts.splice(i, 1); continue;
        }
        const k = p.age / p.life;
        const drag = Math.exp(-2.1 * dt);
        p.vx = p.vx * drag + rand(-1, 1) * 9; // flutter
        p.vy = p.vy * drag + 420 * dt;        // gravity
        const px = p.x, py = p.y;
        p.x += p.vx * dt; p.y += p.vy * dt;
        const c = k < 0.25 ? mix(hot, mid, k / 0.25) : mix(mid, ember, (k - 0.25) / 0.75);
        const flicker = 0.75 + Math.random() * 0.25;
        ctx.globalAlpha = Math.pow(1 - k, 1.25) * flicker;
        ctx.strokeStyle = `rgb(${c[0] | 0},${c[1] | 0},${c[2] | 0})`;
        ctx.lineWidth = Math.max(0.4, p.size * (1 - k * 0.55));
        ctx.shadowColor = ctx.strokeStyle; ctx.shadowBlur = p.size > 1.4 ? 7 : 3;
        ctx.beginPath();
        // The streak is the distance travelled this frame, stretched, so fast sparks read as motion blur.
        ctx.moveTo(px - p.vx * dt * 0.9, py - p.vy * dt * 0.9); ctx.lineTo(p.x, p.y); ctx.stroke();
      }
      ctx.shadowBlur = 0;

      // The burning tip: hot core, soft bloom, and a flickering four-point glint.
      const o = outline(head);
      flick = 0.7 + Math.random() * 0.3;
      const g = ctx.createRadialGradient(o.x, o.y, 0, o.x, o.y, 16);
      g.addColorStop(0, `rgba(${hot[0]},${hot[1]},${hot[2]},${0.95 * flick})`);
      g.addColorStop(0.25, `rgba(${mid[0] | 0},${mid[1] | 0},${mid[2] | 0},${0.55 * flick})`);
      g.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.globalAlpha = 1; ctx.fillStyle = g;
      ctx.beginPath(); ctx.arc(o.x, o.y, 16, 0, Math.PI * 2); ctx.fill();
      const arm = 9 + Math.random() * 7;
      ctx.strokeStyle = `rgba(${hot[0]},${hot[1]},${hot[2]},${0.8 * flick})`; ctx.lineWidth = 1;
      ctx.beginPath(); ctx.moveTo(o.x - arm, o.y); ctx.lineTo(o.x + arm, o.y); ctx.moveTo(o.x, o.y - arm); ctx.lineTo(o.x, o.y + arm); ctx.stroke();

      ctx.restore();
      ctx.globalCompositeOperation = 'source-over'; ctx.globalAlpha = 1;
      raf = requestAnimationFrame(frame);
    };
    raf = requestAnimationFrame(frame);
    const onVis = () => { if (document.visibilityState === 'hidden') { cancelAnimationFrame(raf); raf = 0; } else if (!raf) { last = performance.now(); raf = requestAnimationFrame(frame); } };
    document.addEventListener('visibilitychange', onVis);
    return () => { cancelAnimationFrame(raf); ro?.disconnect(); document.removeEventListener('visibilitychange', onVis); };
  }, [tone]);

  return <canvas ref={ref} className="g-sparkborder" aria-hidden="true" />;
};
