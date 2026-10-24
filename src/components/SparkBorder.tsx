import React, { useEffect, useRef } from 'react';

/**
 * A sparkler that runs around the edge of its parent.
 * A white-hot head travels the card's rounded-rectangle outline and sheds sparks
 * the way a real one does: they leave fast, drag slows them, gravity pulls them
 * down, they cool from white through the brand colour to a dull ember, and the
 * bigger ones crackle into smaller sparks as they die. Selecting a card strikes
 * it: a flurry fires from all around the border at once.
 *
 * Every sparkler shares one full-screen, click-through canvas on the body, so sparks
 * are never clipped to a box: they fall past the card's edge, over the next card and
 * on down the screen. One canvas and one animation loop serve all of them. When a
 * card is deselected its emitter stops, but its sparks keep falling until they burn
 * out, and the canvas is removed once nothing is left.
 */

type Tone = 'private' | 'social';
// [hot, mid, ember] as RGB triples; spark colour is interpolated along its life.
const TEMPS: Record<Tone, [number[], number[], number[]]> = {
  private: [[255, 244, 255], [196, 120, 255], [120, 40, 150]],
  social: [[255, 250, 225], [255, 196, 90], [210, 80, 40]],
};

interface P { x: number; y: number; vx: number; vy: number; age: number; life: number; size: number; child: boolean; tone: Tone }
interface Emitter { host: HTMLElement; tone: Tone; head: number; carry: number; w: number; h: number; r: number; ox: number; oy: number }

const MAX_PARTICLES = 420;
const rand = (a: number, b: number) => a + Math.random() * (b - a);
const mix = (a: number[], b: number[], k: number) => [a[0] + (b[0] - a[0]) * k, a[1] + (b[1] - a[1]) * k, a[2] + (b[2] - a[2]) * k];

const emitters = new Set<Emitter>();
const parts: P[] = [];
let canvas: HTMLCanvasElement | null = null;
let ctx: CanvasRenderingContext2D | null = null;
let raf = 0;
let last = 0;

const measureEmitter = (e: Emitter, withRadius = false) => {
  const rect = e.host.getBoundingClientRect();
  e.ox = rect.left; e.oy = rect.top;
  e.w = Math.max(40, rect.width); e.h = Math.max(40, rect.height);
  if (withRadius) e.r = Math.min(parseFloat(getComputedStyle(e.host).borderTopLeftRadius) || 16, e.w / 2, e.h / 2);
};

// Point and outward normal at fraction u (0..1) of the outline, clockwise from the top-left.
const outline = (e: Emitter, u: number) => {
  const { w, h, r } = e;
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

const emit = (e: Emitter, u: number, speed: number, spread: number, big = false) => {
  if (parts.length >= MAX_PARTICLES) return;
  const o = outline(e, u);
  const ang = Math.atan2(o.ny, o.nx) + rand(-spread, spread);
  const sp = speed * rand(0.35, 1);
  parts.push({
    x: e.ox + o.x, y: e.oy + o.y, vx: Math.cos(ang) * sp, vy: Math.sin(ang) * sp - rand(0, 40),
    age: 0, life: rand(0.45, 1.25) * (big ? 1.2 : 1), size: big ? rand(1.4, 2.4) : rand(0.7, 1.6), child: false, tone: e.tone,
  });
};

const sizeCanvas = () => {
  if (!canvas || !ctx) return;
  const dpr = Math.min(window.devicePixelRatio || 1, 1.5);
  canvas.width = Math.round(window.innerWidth * dpr);
  canvas.height = Math.round(window.innerHeight * dpr);
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
};

function stopLoop() {
  cancelAnimationFrame(raf); raf = 0;
  window.removeEventListener('resize', onResize);
  document.removeEventListener('visibilitychange', onVisibility);
  canvas?.remove();
  canvas = null; ctx = null;
}

function onResize() {
  sizeCanvas();
  emitters.forEach((e) => measureEmitter(e, true));
}

function onVisibility() {
  if (document.visibilityState === 'hidden') {
    cancelAnimationFrame(raf); raf = 0;
  } else if (!raf && canvas) {
    last = performance.now();
    raf = requestAnimationFrame(frame);
  }
}

function frame(t: number) {
  const c2d = ctx;
  if (!canvas || !c2d) return;
  const dt = Math.min(0.04, (t - last) / 1000); last = t;
  c2d.clearRect(0, 0, window.innerWidth, window.innerHeight);
  c2d.globalCompositeOperation = 'lighter'; c2d.lineCap = 'round';

  // Each live sparkler: its head travels the outline and sheds sparks backwards and outwards.
  emitters.forEach((e) => {
    measureEmitter(e);
    e.head = (e.head + dt / 3.4) % 1;
    e.carry += dt * 110;
    while (e.carry >= 1) { e.carry -= 1; emit(e, e.head - rand(0, 0.004), rand(60, 210), 1.15, Math.random() < 0.18); }
    // Occasional spit: a fast, long spark.
    if (Math.random() < dt * 3.2) emit(e, e.head, rand(220, 340), 0.5, true);
  });

  const drag = Math.exp(-2.1 * dt);
  for (let i = parts.length - 1; i >= 0; i--) {
    const p = parts[i];
    p.age += dt;
    if (p.age >= p.life) {
      if (!p.child && p.size > 1.5 && Math.random() < 0.7 && parts.length < MAX_PARTICLES) {
        // Crackle: the spark pops into a few tiny ones.
        for (let c = 0; c < 4; c++) {
          const a = rand(0, Math.PI * 2), sp = rand(30, 120);
          parts.push({ x: p.x, y: p.y, vx: p.vx * 0.3 + Math.cos(a) * sp, vy: p.vy * 0.3 + Math.sin(a) * sp, age: 0, life: rand(0.15, 0.4), size: 0.7, child: true, tone: p.tone });
        }
      }
      parts.splice(i, 1); continue;
    }
    const k = p.age / p.life;
    p.vx = p.vx * drag + rand(-1, 1) * 9; // flutter
    p.vy = p.vy * drag + 420 * dt;        // gravity
    const px = p.x, py = p.y;
    p.x += p.vx * dt; p.y += p.vy * dt;
    const [hot, mid, ember] = TEMPS[p.tone];
    const c = k < 0.25 ? mix(hot, mid, k / 0.25) : mix(mid, ember, (k - 0.25) / 0.75);
    c2d.globalAlpha = Math.pow(1 - k, 1.25) * (0.75 + Math.random() * 0.25);
    c2d.strokeStyle = `rgb(${c[0] | 0},${c[1] | 0},${c[2] | 0})`;
    c2d.lineWidth = Math.max(0.4, p.size * (1 - k * 0.55));
    // Only the bigger sparks get a glow; the glow is the costly part.
    if (p.size > 1.4) { c2d.shadowColor = c2d.strokeStyle; c2d.shadowBlur = 6; } else { c2d.shadowBlur = 0; }
    c2d.beginPath();
    // The streak is the distance travelled this frame, stretched, so fast sparks read as motion blur.
    c2d.moveTo(px - p.vx * dt * 0.9, py - p.vy * dt * 0.9); c2d.lineTo(p.x, p.y); c2d.stroke();
  }
  c2d.shadowBlur = 0;

  // The burning tips: hot core, soft bloom, and a flickering four-point glint.
  emitters.forEach((e) => {
    const [hot, mid] = TEMPS[e.tone];
    const o = outline(e, e.head);
    const x = e.ox + o.x, y = e.oy + o.y;
    const flick = 0.7 + Math.random() * 0.3;
    const g = c2d.createRadialGradient(x, y, 0, x, y, 16);
    g.addColorStop(0, `rgba(${hot[0]},${hot[1]},${hot[2]},${0.95 * flick})`);
    g.addColorStop(0.25, `rgba(${mid[0] | 0},${mid[1] | 0},${mid[2] | 0},${0.55 * flick})`);
    g.addColorStop(1, 'rgba(0,0,0,0)');
    c2d.globalAlpha = 1; c2d.fillStyle = g;
    c2d.beginPath(); c2d.arc(x, y, 16, 0, Math.PI * 2); c2d.fill();
    const arm = 9 + Math.random() * 7;
    c2d.strokeStyle = `rgba(${hot[0]},${hot[1]},${hot[2]},${0.8 * flick})`; c2d.lineWidth = 1;
    c2d.beginPath(); c2d.moveTo(x - arm, y); c2d.lineTo(x + arm, y); c2d.moveTo(x, y - arm); c2d.lineTo(x, y + arm); c2d.stroke();
  });

  c2d.globalCompositeOperation = 'source-over'; c2d.globalAlpha = 1;

  // Nothing burning and nothing falling: tidy up.
  if (emitters.size === 0 && parts.length === 0) { stopLoop(); return; }
  raf = requestAnimationFrame(frame);
}

const startLoop = () => {
  if (canvas) return;
  canvas = document.createElement('canvas');
  canvas.setAttribute('aria-hidden', 'true');
  canvas.style.cssText = 'position:fixed;left:0;top:0;width:100vw;height:100vh;pointer-events:none;z-index:5000;';
  ctx = canvas.getContext('2d');
  if (!ctx) { canvas = null; return; }
  document.body.appendChild(canvas);
  sizeCanvas();
  window.addEventListener('resize', onResize);
  document.addEventListener('visibilitychange', onVisibility);
  last = performance.now();
  raf = requestAnimationFrame(frame);
};

export const SparkBorder: React.FC<{ tone: Tone }> = ({ tone }) => {
  const anchor = useRef<HTMLSpanElement>(null);

  useEffect(() => {
    const host = anchor.current?.parentElement;
    if (!host) return;
    if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) return;

    const emitter: Emitter = { host, tone, head: Math.random(), carry: 0, w: 40, h: 40, r: 16, ox: 0, oy: 0 };
    measureEmitter(emitter, true);
    emitters.add(emitter);
    startLoop();

    // Strike: the whole border throws sparks at once.
    for (let i = 0; i < 46; i++) emit(emitter, Math.random(), rand(90, 260), 0.9, i % 4 === 0);

    // Removing the emitter stops new sparks only; those already in the air keep falling.
    return () => { emitters.delete(emitter); };
  }, [tone]);

  return <span ref={anchor} hidden aria-hidden="true" />;
};
