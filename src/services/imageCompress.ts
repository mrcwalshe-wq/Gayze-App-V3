/**
 * Pictures travel inside the encrypted message, and the message is stored as hex, so every byte of the picture costs two.
 * Realtime refuses rows over about 1 MB, which is why large photos never reached the other person live. Shrinking the picture
 * first keeps every photo message well under that limit.
 */
export const MAX_PHOTO_BYTES = 170_000;

const loadImage = (src: string) => new Promise<HTMLImageElement>((resolve, reject) => {
  const img = new Image();
  img.onload = () => resolve(img);
  img.onerror = () => reject(new Error('The photo could not be read.'));
  img.src = src;
});

const dataUrlBytes = (dataUrl: string) => Math.floor((dataUrl.length - dataUrl.indexOf(',') - 1) * 0.75);

/** Scale a picture down (never up) and re-encode it as JPEG until it is small enough to send. */
export async function compressImageDataUrl(source: string, maxSide = 1280, maxBytes = MAX_PHOTO_BYTES): Promise<string> {
  const img = await loadImage(source);
  let side = Math.min(1, maxSide / Math.max(img.naturalWidth, img.naturalHeight));
  let best = source;
  for (let attempt = 0; attempt < 8; attempt += 1) {
    const w = Math.max(1, Math.round(img.naturalWidth * side)), h = Math.max(1, Math.round(img.naturalHeight * side));
    const canvas = document.createElement('canvas');
    canvas.width = w; canvas.height = h;
    const ctx = canvas.getContext('2d');
    if (!ctx) return source;
    ctx.fillStyle = '#fff';          // flatten transparency (PNG, WebP) before JPEG
    ctx.fillRect(0, 0, w, h);
    ctx.drawImage(img, 0, 0, w, h);
    for (const quality of [0.82, 0.72, 0.62, 0.52]) {
      const out = canvas.toDataURL('image/jpeg', quality);
      best = out;
      if (dataUrlBytes(out) <= maxBytes) return out;
    }
    side *= 0.8;
  }
  return best;
}
