import React, { useEffect, useRef, useState } from 'react';
import { Check, Crop, EyeOff, RotateCcw, Undo2, X } from 'lucide-react';

interface PhotoStudioProps {
  source: string;
  onCancel: () => void;
  onDone: (editedDataUrl: string) => void;
}

/** Lightweight client-side editor. The original image never leaves the device until the user sends it. */
export const PhotoStudio: React.FC<PhotoStudioProps> = ({ source, onCancel, onDone }) => {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [rotation, setRotation] = useState(0);
  const [blur, setBlur] = useState(0);
  const [scale, setScale] = useState(1);

  useEffect(() => {
    const image = new Image();
    image.onload = () => {
      const canvas = canvasRef.current;
      const ctx = canvas?.getContext('2d');
      if (!canvas || !ctx) return;
      const maxDimension = 1600;
      const factor = Math.min(1, maxDimension / Math.max(image.naturalWidth, image.naturalHeight));
      const width = Math.max(1, Math.round(image.naturalWidth * factor));
      const height = Math.max(1, Math.round(image.naturalHeight * factor));
      canvas.width = width;
      canvas.height = height;
      ctx.clearRect(0, 0, width, height);
      ctx.save();
      ctx.translate(width / 2, height / 2);
      ctx.rotate(rotation * Math.PI / 180);
      ctx.scale(scale, scale);
      ctx.filter = blur ? `blur(${blur}px)` : 'none';
      ctx.drawImage(image, -width / 2, -height / 2, width, height);
      ctx.restore();
    };
    image.src = source;
  }, [source, rotation, blur, scale]);

  const done = () => {
    const data = canvasRef.current?.toDataURL('image/jpeg', 0.9);
    if (data) onDone(data);
  };

  return (
    <div className="fixed inset-0 z-[80] bg-black flex flex-col" style={{ paddingTop: 'env(safe-area-inset-top)', paddingBottom: 'env(safe-area-inset-bottom)' }}>
      <header className="h-14 shrink-0 px-4 flex items-center justify-between border-b border-white/10 bg-[#0b0c10]">
        <button type="button" onClick={onCancel} className="min-w-[44px] min-h-[44px] text-zinc-300" aria-label="Close photo studio"><X /></button>
        <span className="font-semibold text-white">Photo Studio</span>
        <button type="button" onClick={done} className="min-w-[44px] min-h-[44px] text-[#C9A24D]" aria-label="Use edited photo"><Check /></button>
      </header>
      <main className="flex-1 min-h-0 flex items-center justify-center p-4 overflow-hidden">
        <canvas ref={canvasRef} className="max-w-full max-h-full rounded-2xl" aria-label="Photo preview" />
      </main>
      <footer className="shrink-0 p-3 border-t border-white/10 bg-[#0d0e14]">
        <div className="grid grid-cols-4 gap-2">
          <button type="button" onClick={() => setRotation((value) => (value + 90) % 360)} className="min-h-[48px] rounded-xl border border-white/10 text-zinc-300"><RotateCcw className="mx-auto w-4 h-4" /><span className="block text-[10px] mt-1">Rotate</span></button>
          <button type="button" onClick={() => setScale((value) => value === 1 ? 1.18 : 1)} className="min-h-[48px] rounded-xl border border-white/10 text-zinc-300"><Crop className="mx-auto w-4 h-4" /><span className="block text-[10px] mt-1">Crop / Zoom</span></button>
          <button type="button" onClick={() => setBlur((value) => value ? 0 : 8)} className={`min-h-[48px] rounded-xl border ${blur ? 'border-[#C9A24D] text-white' : 'border-white/10 text-zinc-300'}`}><EyeOff className="mx-auto w-4 h-4" /><span className="block text-[10px] mt-1">Blur</span></button>
          <button type="button" onClick={() => { setRotation(0); setScale(1); setBlur(0); }} className="min-h-[48px] rounded-xl border border-white/10 text-zinc-300"><Undo2 className="mx-auto w-4 h-4" /><span className="block text-[10px] mt-1">Reset</span></button>
        </div>
      </footer>
    </div>
  );
};
