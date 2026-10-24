import React, { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Ban, Check, Droplets, Eye, FlipHorizontal2, Grid3x3, RotateCw, Undo2, X, ZoomIn, ZoomOut } from 'lucide-react';

interface PhotoStudioProps {
  source: string;
  onCancel: () => void;
  onDone: (editedDataUrl: string) => void;
}

type Effect = 'none' | 'blur' | 'pixelate';
type Panel = 'privacy' | 'frame';

const OUTPUT_SIZE = 1200;

const makeCanvas = (size: number) => {
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  return canvas;
};

/**
 * Phone-first photo editor.
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
  const [ready, setReady] = useState(false);
  const [failed, setFailed] = useState(false);
  const [panel, setPanel] = useState<Panel>('privacy');
  const [effect, setEffect] = useState<Effect>('none');
  const [strength, setStrength] = useState(5);
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
    const f = strength / 10;

    if (!withEffect || effect === 'none') {
      ctx.drawImage(base, 0, 0);
      return;
    }

    if (effect === 'pixelate') {
      const cells = Math.max(6, Math.round(72 - f * 62));
      const small = makeCanvas(cells);
      const sctx = small.getContext('2d');
      if (!sctx) return;
      sctx.imageSmoothingEnabled = true;
      sctx.imageSmoothingQuality = 'high';
      sctx.drawImage(base, 0, 0, cells, cells);
      ctx.imageSmoothingEnabled = false;
      ctx.drawImage(small, 0, 0, cells, cells, 0, 0, size, size);
      return;
    }

    // Blur: step down in two stages, then smooth back up.
    const low = Math.max(8, Math.round(size / (1 + f * f * 44)));
    const mid = Math.min(size, low * 2);
    const midCanvas = makeCanvas(mid);
    const lowCanvas = makeCanvas(low);
    const mctx = midCanvas.getContext('2d');
    const lctx = lowCanvas.getContext('2d');
    if (!mctx || !lctx) return;
    mctx.imageSmoothingEnabled = true;
    mctx.imageSmoothingQuality = 'high';
    lctx.imageSmoothingEnabled = true;
    lctx.imageSmoothingQuality = 'high';
    mctx.drawImage(base, 0, 0, mid, mid);
    lctx.drawImage(midCanvas, 0, 0, low, low);
    const upCanvas = makeCanvas(mid);
    const uctx = upCanvas.getContext('2d');
    if (!uctx) return;
    uctx.imageSmoothingEnabled = true;
    uctx.imageSmoothingQuality = 'high';
    uctx.drawImage(lowCanvas, 0, 0, low, low, 0, 0, mid, mid);
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(upCanvas, 0, 0, mid, mid, 0, 0, size, size);
  };

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!ready || !canvas) return;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    draw(canvas, Math.round(stageSize * dpr), !comparing);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, stageSize, effect, strength, zoom, pan, rotation, flip, comparing]);

  const done = () => {
    const out = makeCanvas(OUTPUT_SIZE);
    draw(out, OUTPUT_SIZE, true);
    const data = out.toDataURL('image/jpeg', 0.92);
    if (data) onDone(data);
  };

  const reset = () => {
    setEffect('none');
    setStrength(5);
    setZoom(1);
    setPan({ x: 0, y: 0 });
    setRotation(0);
    setFlip(false);
  };

  const onPointerDown = (event: React.PointerEvent) => {
    if (!ready || zoom <= 1) return;
    (event.currentTarget as HTMLElement).setPointerCapture?.(event.pointerId);
    dragRef.current = { x: event.clientX, y: event.clientY };
    setDragging(true);
  };
  const onPointerMove = (event: React.PointerEvent) => {
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
  const endDrag = () => { dragRef.current = null; setDragging(false); };

  const effects: Array<{ id: Effect; label: string; icon: React.ReactNode }> = [
    { id: 'none', label: 'Original', icon: <Ban className="w-[18px] h-[18px]" /> },
    { id: 'blur', label: 'Blur', icon: <Droplets className="w-[18px] h-[18px]" /> },
    { id: 'pixelate', label: 'Pixelate', icon: <Grid3x3 className="w-[18px] h-[18px]" /> },
  ];
  const badge = effect === 'none' ? 'Original' : `${effect === 'blur' ? 'Blur' : 'Pixelate'} ${strength}`;

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
          <span>Frame it, then hide what you like</span>
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
            className={`g-studio__frame ${dragging ? 'is-dragging' : ''} ${zoom > 1 ? 'can-pan' : ''}`}
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
            {zoom > 1 && !dragging && <span className="g-studio__hint">Drag to reposition</span>}
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
              {effects.map((item) => (
                <button key={item.id} type="button" data-active={effect === item.id} onClick={() => setEffect(item.id)}>
                  {item.icon}<span>{item.label}</span>
                </button>
              ))}
            </div>
            <label className={`g-studio__slider ${effect === 'none' ? 'is-off' : ''}`}>
              <span>Strength</span>
              <input
                aria-label="Effect strength"
                type="range"
                min="1"
                max="10"
                step="1"
                value={strength}
                disabled={effect === 'none'}
                onChange={(e) => setStrength(Number(e.target.value))}
              />
              <b>{effect === 'none' ? '—' : strength}</b>
            </label>
          </div>
        ) : (
          <div className="g-studio__panel">
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
                  if (next === 1) setPan({ x: 0, y: 0 });
                }}
              />
              <ZoomIn className="w-4 h-4" />
              <b>{zoom.toFixed(1)}×</b>
            </label>
            <div className="g-studio__actions">
              <button type="button" onClick={() => setRotation((value) => (value + 90) % 360)}><RotateCw className="w-4 h-4" /><span>Rotate</span></button>
              <button type="button" onClick={() => setFlip((value) => !value)} data-active={flip}><FlipHorizontal2 className="w-4 h-4" /><span>Flip</span></button>
              <button type="button" onClick={reset}><Undo2 className="w-4 h-4" /><span>Reset</span></button>
            </div>
          </div>
        )}
      </footer>
    </div>,
    document.body,
  );
};
