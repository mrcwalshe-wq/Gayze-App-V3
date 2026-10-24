import React, { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Check, Droplets, Eraser, Eye, FlipHorizontal2, Grid3x3, Maximize, RotateCcw, RotateCw, Undo2, X, ZoomIn, ZoomOut } from 'lucide-react';

interface PhotoStudioProps {
  source: string;
  onCancel: () => void;
  onDone: (editedDataUrl: string) => void;
}

type Effect = 'blur' | 'pixelate';
type Tool = 'paint' | 'erase';
/** A brush stroke in view space: x/y and size are fractions of the preview square. */
interface Stroke { tool: Tool; effect: Effect; strength: number; size: number; points: Array<{ x: number; y: number }> }
type Panel = 'privacy' | 'frame';

const OUTPUT_SIZE = 1200;

const brushSize = (level: number) => 0.04 + level * 0.022;

const makeCanvas = (size: number) => {
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  return canvas;
};

/**
 * Phone-first photo editor.
 *
 * Hiding is painted: strokes build a mask, and the pixelated/blurred copy of the
 * framed photo shows through only where the mask is.
 *
 * Everything is plain canvas drawing (no CanvasRenderingContext2D.filter, which iOS
 * Safari does not reliably support): blur is a two-stage down/up-sample and pixelate
 * is a down-sample re-drawn with smoothing off, so both behave the same on every
 * device and at preview and output resolution.
 *
 * Rendered in a portal: chat containers restyle their direct children, which used
 * to stop a `fixed` editor covering the screen.
 */
export const PhotoStudio: React.FC<PhotoStudioProps> = ({ source, onCancel, onDone }) => {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const stageRef = useRef<HTMLDivElement | null>(null);
  const imageRef = useRef<HTMLImageElement | null>(null);
  const dragRef = useRef<{ x: number; y: number } | null>(null);
  const frameRef = useRef<HTMLDivElement | null>(null);
  const paintingRef = useRef(false);
  const [ready, setReady] = useState(false);
  const [failed, setFailed] = useState(false);
  const [panel, setPanel] = useState<Panel>('privacy');
  const [effect, setEffect] = useState<Effect>('pixelate');
  const [tool, setTool] = useState<Tool>('paint');
  const [strength, setStrength] = useState(5);
  const [brush, setBrush] = useState(5);
  const [strokes, setStrokes] = useState<Stroke[]>([]);
  const [liveStroke, setLiveStroke] = useState<Stroke | null>(null);
  const [cursor, setCursor] = useState<{ x: number; y: number } | null>(null);
  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [rotation, setRotation] = useState(0);
  const [flip, setFlip] = useState(false);
  const [comparing, setComparing] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [stageSize, setStageSize] = useState(320);

  useEffect(() => {
    let cancelled = false;
    const image = new Image();
    image.onload = () => {
      if (cancelled) return;
      imageRef.current = image;
      setReady(true);
    };
    image.onerror = () => { if (!cancelled) setFailed(true); };
    image.src = source;
    return () => { cancelled = true; };
  }, [source]);

  useEffect(() => {
    const previous = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { document.body.style.overflow = previous; };
  }, []);

  useLayoutEffect(() => {
    const stage = stageRef.current;
    if (!stage) return;
    const measure = () => {
      const { width, height } = stage.getBoundingClientRect();
      setStageSize(Math.max(200, Math.floor(Math.min(width - 28, height - 16))));
    };
    measure();
    const observer = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(measure) : null;
    observer?.observe(stage);
    window.addEventListener('resize', measure);
    return () => { observer?.disconnect(); window.removeEventListener('resize', measure); };
  }, []);

  /** Largest centred-square crop side in source pixels, after zoom. */
  const cropSide = (image: HTMLImageElement) => Math.min(image.naturalWidth, image.naturalHeight) / zoom;

  const clampPan = (image: HTMLImageElement, x: number, y: number) => {
    const side = cropSide(image);
    const maxX = (image.naturalWidth - side) / 2;
    const maxY = (image.naturalHeight - side) / 2;
    return { x: Math.max(-maxX, Math.min(maxX, x)), y: Math.max(-maxY, Math.min(maxY, y)) };
  };

  const draw = (canvas: HTMLCanvasElement, size: number, withEffect: boolean) => {
    const image = imageRef.current;
    if (!image) return;
    canvas.width = size;
    canvas.height = size;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const side = cropSide(image);
    const clamped = clampPan(image, pan.x, pan.y);
    const sx = (image.naturalWidth - side) / 2 + clamped.x;
    const sy = (image.naturalHeight - side) / 2 + clamped.y;

    // Base layer: crop + flip + rotate.
    const base = makeCanvas(size);
    const bctx = base.getContext('2d');
    if (!bctx) return;
    bctx.imageSmoothingEnabled = true;
    bctx.imageSmoothingQuality = 'high';
    bctx.translate(size / 2, size / 2);
    bctx.rotate((rotation * Math.PI) / 180);
    if (flip) bctx.scale(-1, 1);
    bctx.drawImage(image, sx, sy, side, side, -size / 2, -size / 2, size, size);

    ctx.clearRect(0, 0, size, size);
    ctx.drawImage(base, 0, 0);

    const all = liveStroke ? [...strokes, liveStroke] : strokes;
    if (!withEffect || all.length === 0) return;

    // Painted layer: each paint stroke reveals its own pixelated/blurred copy of
    // the framed photo; erase strokes take it away again.
    const layer = makeCanvas(size);
    const lctx = layer.getContext('2d');
    if (!lctx) return;
    const fxCache = new Map<string, HTMLCanvasElement | null>();
    for (const stroke of all) {
      if (stroke.tool === 'erase') {
        lctx.globalCompositeOperation = 'destination-out';
        strokePath(lctx, size, stroke);
        lctx.globalCompositeOperation = 'source-over';
        continue;
      }
      const key = `${stroke.effect}:${stroke.strength}`;
      if (!fxCache.has(key)) fxCache.set(key, makeEffect(base, size, stroke.effect, stroke.strength));
      const fx = fxCache.get(key);
      if (!fx) continue;
      const patch = makeCanvas(size);
      const pctx = patch.getContext('2d');
      if (!pctx) continue;
      strokePath(pctx, size, stroke);
      pctx.shadowBlur = 0;
      pctx.globalCompositeOperation = 'source-in';
      pctx.drawImage(fx, 0, 0);
      lctx.drawImage(patch, 0, 0);
    }
    ctx.drawImage(layer, 0, 0);
  };

  /** Pixelated or blurred copy of the whole framed photo. */
  const makeEffect = (base: HTMLCanvasElement, size: number, kind: Effect, level: number): HTMLCanvasElement | null => {
    const f = level / 10;
    const out = makeCanvas(size);
    const octx = out.getContext('2d');
    if (!octx) return null;

    if (kind === 'pixelate') {
      const cells = Math.max(6, Math.round(72 - f * 62));
      const small = makeCanvas(cells);
      const sctx = small.getContext('2d');
      if (!sctx) return null;
      sctx.imageSmoothingEnabled = true;
      sctx.imageSmoothingQuality = 'high';
      sctx.drawImage(base, 0, 0, cells, cells);
      octx.imageSmoothingEnabled = false;
      octx.drawImage(small, 0, 0, cells, cells, 0, 0, size, size);
      return out;
    }

    // Blur: step down in two stages, then smooth back up.
    const low = Math.max(8, Math.round(size / (1 + f * f * 44)));
    const mid = Math.min(size, low * 2);
    const midCanvas = makeCanvas(mid);
    const lowCanvas = makeCanvas(low);
    const upCanvas = makeCanvas(mid);
    const mctx = midCanvas.getContext('2d');
    const lctx = lowCanvas.getContext('2d');
    const uctx = upCanvas.getContext('2d');
    if (!mctx || !lctx || !uctx) return null;
    for (const c of [mctx, lctx, uctx, octx]) { c.imageSmoothingEnabled = true; c.imageSmoothingQuality = 'high'; }
    mctx.drawImage(base, 0, 0, mid, mid);
    lctx.drawImage(midCanvas, 0, 0, low, low);
    uctx.drawImage(lowCanvas, 0, 0, low, low, 0, 0, mid, mid);
    octx.drawImage(upCanvas, 0, 0, mid, mid, 0, 0, size, size);
    return out;
  };

  const strokePath = (ctx: CanvasRenderingContext2D, size: number, stroke: Stroke) => {
    const width = stroke.size * size;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.strokeStyle = '#fff';
    ctx.fillStyle = '#fff';
    ctx.lineWidth = width;
    // Soft edge for blur so the hidden area does not end in a hard line.
    ctx.shadowColor = '#fff';
    ctx.shadowBlur = stroke.effect === 'blur' ? width * 0.3 : 0;
    const [first, ...rest] = stroke.points;
    if (!first) return;
    ctx.beginPath();
    if (rest.length === 0) {
      ctx.arc(first.x * size, first.y * size, width / 2, 0, Math.PI * 2);
      ctx.fill();
      return;
    }
    ctx.moveTo(first.x * size, first.y * size);
    for (const point of rest) ctx.lineTo(point.x * size, point.y * size);
    ctx.stroke();
  };

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!ready || !canvas) return;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    draw(canvas, Math.round(stageSize * dpr), !comparing);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, stageSize, zoom, pan, rotation, flip, comparing, strokes, liveStroke]);

  const done = () => {
    const out = makeCanvas(OUTPUT_SIZE);
    draw(out, OUTPUT_SIZE, true);
    const data = out.toDataURL('image/jpeg', 0.92);
    if (data) onDone(data);
  };

  const reset = () => {
    setEffect('pixelate');
    setTool('paint');
    setStrength(5);
    setBrush(5);
    setStrokes([]);
    setLiveStroke(null);
    setZoom(1);
    setPan({ x: 0, y: 0 });
    setRotation(0);
    setFlip(false);
  };

  const framePoint = (event: React.PointerEvent) => {
    const rect = frameRef.current?.getBoundingClientRect();
    if (!rect) return { x: 0, y: 0 };
    return {
      x: Math.max(0, Math.min(1, (event.clientX - rect.left) / rect.width)),
      y: Math.max(0, Math.min(1, (event.clientY - rect.top) / rect.height)),
    };
  };

  const onPointerDown = (event: React.PointerEvent) => {
    if (!ready) return;
    (event.currentTarget as HTMLElement).setPointerCapture?.(event.pointerId);
    if (panel === 'privacy') {
      const point = framePoint(event);
      paintingRef.current = true;
      setCursor(point);
      setLiveStroke({ tool, effect, strength, size: brushSize(brush), points: [point] });
      return;
    }
    if (zoom <= 1) return;
    dragRef.current = { x: event.clientX, y: event.clientY };
    setDragging(true);
  };
  const onPointerMove = (event: React.PointerEvent) => {
    if (paintingRef.current) {
      const point = framePoint(event);
      setCursor(point);
      setLiveStroke((current) => (current ? { ...current, points: [...current.points, point] } : current));
      return;
    }
    const last = dragRef.current;
    const image = imageRef.current;
    if (!last || !image) return;
    const dx = event.clientX - last.x;
    const dy = event.clientY - last.y;
    dragRef.current = { x: event.clientX, y: event.clientY };
    // Undo the display rotation/flip so a drag follows the finger.
    const angle = (-rotation * Math.PI) / 180;
    let rx = dx * Math.cos(angle) - dy * Math.sin(angle);
    const ry = dx * Math.sin(angle) + dy * Math.cos(angle);
    if (flip) rx = -rx;
    const scale = cropSide(image) / stageSize;
    setPan((current) => clampPan(image, current.x - rx * scale, current.y - ry * scale));
  };
  const endDrag = () => {
    dragRef.current = null;
    setDragging(false);
    if (paintingRef.current) {
      paintingRef.current = false;
      setLiveStroke((current) => {
        if (current) setStrokes((list) => [...list, current]);
        return null;
      });
      setCursor(null);
    }
  };

  /** Strokes live in view space, so keep them on the same pixels when the view turns. */
  const rotateStrokes = () => setStrokes((list) => list.map((stroke) => ({
    ...stroke,
    points: stroke.points.map((p) => ({ x: 1 - p.y, y: p.x })),
  })));
  const flipStrokes = () => setStrokes((list) => list.map((stroke) => ({
    ...stroke,
    points: stroke.points.map((p) => (rotation % 180 === 0 ? { x: 1 - p.x, y: p.y } : { x: p.x, y: 1 - p.y })),
  })));
  const hideAll = () => setStrokes((list) => [...list, { tool: 'paint', effect, strength, size: 2, points: [{ x: 0.5, y: 0.5 }] }]);

  const hasHiding = strokes.length > 0;
  const lastPaint = [...strokes].reverse().find((stroke) => stroke.tool === 'paint');
  const badge = lastPaint ? `${strokes.filter((stroke) => stroke.tool === 'paint').length} hidden` : 'Original';

  return createPortal(
    <div
      className="g-studio"
      role="dialog"
      aria-modal="true"
      aria-label="Photo Studio"
    >
      <header className="g-studio__head">
        <button type="button" onClick={onCancel} className="g-studio__icon" aria-label="Close photo studio">
          <X className="w-5 h-5" />
        </button>
        <div className="g-studio__title">
          <strong>Photo Studio</strong>
          <span>Paint over anything you want hidden</span>
        </div>
        <button type="button" onClick={done} disabled={!ready} className="g-studio__use" aria-label="Use edited photo">
          <Check className="w-4 h-4" /> Use
        </button>
      </header>

      <div className="g-studio__stage" ref={stageRef}>
        {failed ? (
          <p className="g-studio__error">This photo could not be opened.</p>
        ) : (
          <div
            ref={frameRef}
            className={`g-studio__frame ${dragging ? 'is-dragging' : ''} ${panel === 'frame' && zoom > 1 ? 'can-pan' : ''} ${panel === 'privacy' ? 'can-paint' : ''}`}
            style={{ width: stageSize, height: stageSize }}
            onPointerDown={onPointerDown}
            onPointerMove={onPointerMove}
            onPointerUp={endDrag}
            onPointerCancel={endDrag}
          >
            <canvas ref={canvasRef} className="g-studio__canvas" aria-label="Edited photo preview" />
            <div className="g-studio__grid" aria-hidden="true" />
            <span className="g-studio__chip g-studio__chip--l">{comparing ? 'Original' : '1:1'}</span>
            <span className="g-studio__chip g-studio__chip--r">{comparing ? 'Holding' : badge}</span>
            {panel === 'frame' && zoom > 1 && !dragging && <span className="g-studio__hint">Drag to reposition</span>}
            {panel === 'privacy' && !hasHiding && !liveStroke && <span className="g-studio__hint">Drag your finger over what to hide</span>}
            {cursor && (
              <span
                className={`g-studio__brush ${tool === 'erase' ? 'is-erase' : ''}`}
                style={{ left: cursor.x * stageSize, top: cursor.y * stageSize, width: brushSize(brush) * stageSize, height: brushSize(brush) * stageSize }}
              />
            )}
          </div>
        )}
      </div>

      <footer className="g-studio__tray">
        <div className="g-studio__tabs" role="tablist">
          <button type="button" role="tab" aria-selected={panel === 'privacy'} data-active={panel === 'privacy'} onClick={() => setPanel('privacy')}>Privacy</button>
          <button type="button" role="tab" aria-selected={panel === 'frame'} data-active={panel === 'frame'} onClick={() => setPanel('frame')}>Frame</button>
          <button
            type="button"
            className="g-studio__compare"
            onPointerDown={() => setComparing(true)}
            onPointerUp={() => setComparing(false)}
            onPointerLeave={() => setComparing(false)}
            onPointerCancel={() => setComparing(false)}
            aria-label="Hold to compare with original"
          >
            <Eye className="w-4 h-4" /> Hold
          </button>
        </div>

        {panel === 'privacy' ? (
          <div className="g-studio__panel">
            <div className="g-studio__effects">
              <button type="button" data-active={tool === 'paint' && effect === 'pixelate'} onClick={() => { setEffect('pixelate'); setTool('paint'); }}>
                <Grid3x3 className="w-[18px] h-[18px]" /><span>Pixelate</span>
              </button>
              <button type="button" data-active={tool === 'paint' && effect === 'blur'} onClick={() => { setEffect('blur'); setTool('paint'); }}>
                <Droplets className="w-[18px] h-[18px]" /><span>Blur</span>
              </button>
              <button type="button" data-active={tool === 'erase'} onClick={() => setTool((t) => (t === 'erase' ? 'paint' : 'erase'))}>
                <Eraser className="w-[18px] h-[18px]" /><span>Erase</span>
              </button>
              <button type="button" disabled={!hasHiding} onClick={() => setStrokes((list) => list.slice(0, -1))}>
                <RotateCcw className="w-[18px] h-[18px]" /><span>Undo</span>
              </button>
              <button type="button" onClick={hideAll}>
                <Maximize className="w-[18px] h-[18px]" /><span>All</span>
              </button>
            </div>
            <label className="g-studio__slider">
              <span>Strength</span>
              <input aria-label="Effect strength" type="range" min="1" max="10" step="1" value={strength} onChange={(e) => setStrength(Number(e.target.value))} />
              <b>{strength}</b>
            </label>
            <label className="g-studio__slider">
              <span>Brush</span>
              <input aria-label="Brush size" type="range" min="1" max="10" step="1" value={brush} onChange={(e) => setBrush(Number(e.target.value))} />
              <b>{brush}</b>
            </label>
          </div>
        ) : (
          <div className="g-studio__panel">
            {hasHiding && <p className="g-studio__note">Zooming or moving the photo clears what you've hidden. Rotate and flip keep it.</p>}
            <label className="g-studio__slider">
              <ZoomOut className="w-4 h-4" />
              <input
                aria-label="Crop zoom"
                type="range"
                min="1"
                max="3"
                step="0.05"
                value={zoom}
                onChange={(e) => {
                  const next = Number(e.target.value);
                  setZoom(next);
                  if (strokes.length) setStrokes([]);
                  if (next === 1) setPan({ x: 0, y: 0 });
                }}
              />
              <ZoomIn className="w-4 h-4" />
              <b>{zoom.toFixed(1)}×</b>
            </label>
            <div className="g-studio__actions">
              <button type="button" onClick={() => { rotateStrokes(); setRotation((value) => (value + 90) % 360); }}><RotateCw className="w-4 h-4" /><span>Rotate</span></button>
              <button type="button" onClick={() => { flipStrokes(); setFlip((value) => !value); }} data-active={flip}><FlipHorizontal2 className="w-4 h-4" /><span>Flip</span></button>
              <button type="button" onClick={reset}><Undo2 className="w-4 h-4" /><span>Reset</span></button>
            </div>
          </div>
        )}
      </footer>
    </div>,
    document.body,
  );
};
