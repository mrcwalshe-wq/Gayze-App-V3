import React, { useEffect, useRef, useState } from 'react';
import { Check, Crop, EyeOff, RotateCcw, Undo2, X, ZoomIn, ZoomOut } from 'lucide-react';

interface PhotoStudioProps {
  source: string;
  onCancel: () => void;
  onDone: (editedDataUrl: string) => void;
}

/**
 * Phone-first photo editor.
 * Uses plain canvas transforms rather than CanvasRenderingContext2D.filter because
 * iOS Safari does not reliably support canvas filters. Blur is therefore rendered
 * with repeated translucent passes and crop is a real square source crop.
 */
export const PhotoStudio: React.FC<PhotoStudioProps> = ({ source, onCancel, onDone }) => {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const imageRef = useRef<HTMLImageElement | null>(null);
  const [rotation, setRotation] = useState(0);
  const [blur, setBlur] = useState(0);
  const [zoom, setZoom] = useState(1);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    let cancelled = false;
    const image = new Image();
    image.onload = () => {
      if (cancelled) return;
      imageRef.current = image;
      setReady(true);
    };
    image.onerror = () => setReady(false);
    image.src = source;
    return () => { cancelled = true; };
  }, [source]);

  const render = (output = false) => {
    const image = imageRef.current;
    const canvas = canvasRef.current;
    if (!image || !canvas) return;

    const size = output ? 1200 : Math.min(900, Math.max(320, Math.floor(Math.min(window.innerWidth, window.innerHeight - 240))));
    canvas.width = size;
    canvas.height = size;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    ctx.clearRect(0, 0, size, size);
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';

    // Square crop from the source, expanded by zoom. The crop is centred so
    // faces remain visible while the user controls the framing with zoom.
    const sourceSide = Math.min(image.naturalWidth, image.naturalHeight) / zoom;
    const sx = (image.naturalWidth - sourceSide) / 2;
    const sy = (image.naturalHeight - sourceSide) / 2;

    const drawPass = (dx: number, dy: number, alpha = 1) => {
      ctx.save();
      ctx.globalAlpha = alpha;
      ctx.translate(size / 2 + dx, size / 2 + dy);
      ctx.rotate(rotation * Math.PI / 180);
      ctx.drawImage(
        image,
        sx, sy, sourceSide, sourceSide,
        -size / 2, -size / 2, size, size,
      );
      ctx.restore();
    };

    if (blur > 0) {
      // Safari/iOS-safe blur approximation: repeated low-alpha passes.
      const radius = Math.max(1, Math.round(blur / 2));
      const passes = Math.min(17, 5 + radius * 2);
      ctx.globalCompositeOperation = 'source-over';
      drawPass(0, 0, 0.34);
      for (let i = 0; i < passes; i += 1) {
        const angle = (i / passes) * Math.PI * 2;
        drawPass(Math.cos(angle) * radius, Math.sin(angle) * radius, 0.06);
      }
    } else {
      drawPass(0, 0, 1);
    }

    ctx.globalAlpha = 1;
  };

  useEffect(() => {
    if (!ready) return;
    render(false);
  }, [ready, rotation, blur, zoom]);

  const done = () => {
    render(true);
    const data = canvasRef.current?.toDataURL('image/jpeg', 0.92);
    if (data) onDone(data);
  };

  return (
    <div
      className="fixed inset-0 z-[100] bg-[#07070b] text-white flex flex-col"
      style={{ paddingTop: 'env(safe-area-inset-top)', paddingBottom: 'env(safe-area-inset-bottom)' }}
      role="dialog"
      aria-modal="true"
      aria-label="Photo Studio"
    >
      <header className="h-16 shrink-0 px-4 flex items-center justify-between border-b border-white/10 bg-[#0b0c10]">
        <button type="button" onClick={onCancel} className="min-w-[44px] min-h-[44px] flex items-center justify-center text-zinc-300" aria-label="Close photo studio">
          <X className="w-5 h-5" />
        </button>
        <div className="text-center">
          <div className="font-semibold">Photo Studio</div>
          <div className="text-[10px] text-zinc-500">Crop, zoom, rotate & blur</div>
        </div>
        <button type="button" onClick={done} disabled={!ready} className="min-w-[44px] min-h-[44px] flex items-center justify-center text-[#C9A24D] disabled:opacity-40" aria-label="Use edited photo">
          <Check className="w-5 h-5" />
        </button>
      </header>

      <main className="flex-1 min-h-0 flex items-center justify-center p-4 overflow-hidden">
        <div className="relative w-full max-w-[560px] aspect-square rounded-3xl overflow-hidden border border-white/10 bg-[#11131a] shadow-2xl">
          <canvas ref={canvasRef} className="absolute inset-0 w-full h-full object-cover" aria-label="Edited photo preview" />
          <div className="absolute inset-0 pointer-events-none border border-white/10 rounded-3xl" />
          <div className="absolute top-3 left-3 right-3 flex justify-between pointer-events-none">
            <span className="rounded-full bg-black/55 px-2.5 py-1 text-[10px] text-zinc-300 backdrop-blur">1:1 crop</span>
            <span className="rounded-full bg-black/55 px-2.5 py-1 text-[10px] text-zinc-300 backdrop-blur">{blur ? `Blur ${blur}px` : 'Original'}</span>
          </div>
        </div>
      </main>

      <footer className="shrink-0 px-3 pt-3 pb-3 border-t border-white/10 bg-[#0d0e14]">
        <div className="max-w-xl mx-auto space-y-3">
          <div className="flex items-center gap-2">
            <ZoomOut className="w-4 h-4 text-zinc-500 shrink-0" />
            <input
              aria-label="Crop zoom"
              type="range"
              min="1"
              max="2.5"
              step="0.05"
              value={zoom}
              onChange={(e) => setZoom(Number(e.target.value))}
              className="flex-1 accent-[#C9A24D]"
            />
            <ZoomIn className="w-4 h-4 text-zinc-400 shrink-0" />
            <span className="w-10 text-right text-[10px] text-zinc-500">{zoom.toFixed(1)}×</span>
          </div>

          <div className="flex items-center gap-2">
            <EyeOff className="w-4 h-4 text-zinc-500 shrink-0" />
            <input
              aria-label="Blur amount"
              type="range"
              min="0"
              max="12"
              step="1"
              value={blur}
              onChange={(e) => setBlur(Number(e.target.value))}
              className="flex-1 accent-[#C9A24D]"
            />
            <span className="w-10 text-right text-[10px] text-zinc-500">{blur ? `${blur}` : 'Off'}</span>
          </div>

          <div className="grid grid-cols-4 gap-2">
            <button type="button" onClick={() => setRotation((value) => (value + 90) % 360)} className="min-h-[46px] rounded-xl border border-white/10 bg-white/[0.03] text-zinc-200">
              <RotateCcw className="mx-auto w-4 h-4" /><span className="block text-[10px] mt-1">Rotate</span>
            </button>
            <button type="button" onClick={() => setZoom((value) => Math.min(2.5, value + 0.25))} className="min-h-[46px] rounded-xl border border-white/10 bg-white/[0.03] text-zinc-200">
              <Crop className="mx-auto w-4 h-4" /><span className="block text-[10px] mt-1">Crop</span>
            </button>
            <button type="button" onClick={() => setBlur((value) => value ? 0 : 6)} className={`min-h-[46px] rounded-xl border ${blur ? 'border-[#C9A24D] bg-[#C9A24D]/10 text-white' : 'border-white/10 bg-white/[0.03] text-zinc-200'}`}>
              <EyeOff className="mx-auto w-4 h-4" /><span className="block text-[10px] mt-1">Blur</span>
            </button>
            <button type="button" onClick={() => { setRotation(0); setZoom(1); setBlur(0); }} className="min-h-[46px] rounded-xl border border-white/10 bg-white/[0.03] text-zinc-200">
              <Undo2 className="mx-auto w-4 h-4" /><span className="block text-[10px] mt-1">Reset</span>
            </button>
          </div>
        </div>
      </footer>
    </div>
  );
};
