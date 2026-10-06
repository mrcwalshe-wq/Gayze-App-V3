/**
 * Minimal PNG reader for the brand-asset tests — no dependencies, so the
 * checks run anywhere `npm test` runs.
 *
 * Supports what our own icons are: 8-bit, non-interlaced, colour types
 * 0 (grey), 2 (RGB), 3 (palette) and 6 (RGBA).
 */
import { inflateSync } from 'node:zlib';
import { readFileSync } from 'node:fs';

const CHANNELS = { 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 };

/** Chunk walk. Also surfaces the truncation this suite exists to catch. */
export function readChunks(file) {
  const buf = readFileSync(file);
  if (buf.length < 8 || buf.readUInt32BE(0) !== 0x89504e47) {
    throw new Error(`${file}: not a PNG (bad signature)`);
  }
  const chunks = [];
  let offset = 8;
  while (offset + 8 <= buf.length) {
    const length = buf.readUInt32BE(offset);
    const type = buf.toString('latin1', offset + 4, offset + 8);
    if (length > buf.length - offset - 12) {
      // Declared length runs past the end of the file: a truncated PNG.
      chunks.push({ type, length, data: buf.subarray(offset + 8), truncated: true });
      offset = buf.length;
      break;
    }
    chunks.push({
      type,
      length,
      data: buf.subarray(offset + 8, offset + 8 + length),
      truncated: false,
    });
    offset += 12 + length;
    if (type === 'IEND') break;
  }
  return { chunks, trailingBytes: Math.max(0, buf.length - offset), bytes: buf.length };
}

/** PNG is only complete if it ends with IEND (plus its 4-byte CRC). */
export function isComplete(file) {
  const { chunks, trailingBytes } = readChunks(file);
  return chunks.at(-1)?.type === 'IEND' && !chunks.at(-1)?.truncated && trailingBytes === 0;
}

function unfilter(data, width, height, bpp) {
  const stride = width * bpp;
  const out = Buffer.alloc(stride * height);
  let pos = 0;
  for (let y = 0; y < height; y += 1) {
    const filter = data[pos];
    pos += 1;
    const row = out.subarray(y * stride, (y + 1) * stride);
    const prev = y > 0 ? out.subarray((y - 1) * stride, y * stride) : null;
    for (let x = 0; x < stride; x += 1) {
      const raw = data[pos + x];
      const a = x >= bpp ? row[x - bpp] : 0;   // left
      const b = prev ? prev[x] : 0;            // up
      const c = prev && x >= bpp ? prev[x - bpp] : 0; // up-left
      let value;
      switch (filter) {
        case 0: value = raw; break;
        case 1: value = raw + a; break;
        case 2: value = raw + b; break;
        case 3: value = raw + ((a + b) >> 1); break;
        case 4: {
          const p = a + b - c;
          const pa = Math.abs(p - a);
          const pb = Math.abs(p - b);
          const pc = Math.abs(p - c);
          value = raw + (pa <= pb && pa <= pc ? a : pb <= pc ? b : c);
          break;
        }
        default: throw new Error(`unsupported PNG filter ${filter}`);
      }
      row[x] = value & 0xff;
    }
    pos += stride;
  }
  return out;
}

/** Decode to RGBA. Throws if the PNG uses a form we do not handle. */
export function decode(file) {
  const { chunks } = readChunks(file);
  const ihdr = chunks.find((c) => c.type === 'IHDR');
  if (!ihdr) throw new Error(`${file}: no IHDR`);
  const width = ihdr.data.readUInt32BE(0);
  const height = ihdr.data.readUInt32BE(4);
  const depth = ihdr.data[8];
  const colorType = ihdr.data[9];
  const interlace = ihdr.data[12];
  if (depth !== 8 || interlace !== 0 || !(colorType in CHANNELS)) {
    throw new Error(`${file}: unsupported PNG (depth ${depth}, colour ${colorType}, interlace ${interlace})`);
  }
  const idat = Buffer.concat(chunks.filter((c) => c.type === 'IDAT').map((c) => c.data));
  const raw = unfilter(inflateSync(idat), width, height, CHANNELS[colorType]);

  const plte = chunks.find((c) => c.type === 'PLTE')?.data;
  const trns = chunks.find((c) => c.type === 'tRNS')?.data;
  const out = Buffer.alloc(width * height * 4);
  const channels = CHANNELS[colorType];

  for (let i = 0; i < width * height; i += 1) {
    const s = i * channels;
    let r; let g; let b; let a = 255;
    if (colorType === 3) {
      const index = raw[i] * 3;
      r = plte[index]; g = plte[index + 1]; b = plte[index + 2];
      if (trns && raw[i] < trns.length) a = trns[raw[i]];
    } else if (colorType === 0) {
      r = g = b = raw[s];
      if (trns) a = trns[0] ?? 255;
    } else if (colorType === 4) {
      r = g = b = raw[s];
      a = raw[s + 1];
    } else if (colorType === 2) {
      r = raw[s]; g = raw[s + 1]; b = raw[s + 2];
    } else {
      r = raw[s]; g = raw[s + 1]; b = raw[s + 2]; a = raw[s + 3];
    }
    out[i * 4] = r; out[i * 4 + 1] = g; out[i * 4 + 2] = b; out[i * 4 + 3] = a;
  }
  return { width, height, pixels: out };
}

/**
 * How much of a tile carries the brand. `inkFloor` is the luma the eye can
 * still separate from the obsidian plate; the bounding box shows whether the
 * mark actually fills the tile instead of floating in the middle of it.
 */
export function inkStats(file, inkFloor = 26) {
  const { width, height, pixels } = decode(file);
  let ink = 0;
  let minX = width; let maxX = -1; let minY = height; let maxY = -1;
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const i = (y * width + x) * 4;
      const luma = 0.299 * pixels[i] + 0.587 * pixels[i + 1] + 0.114 * pixels[i + 2];
      if (luma > inkFloor) {
        ink += 1;
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
      }
    }
  }
  return {
    width,
    height,
    inkPct: (100 * ink) / (width * height),
    widthPct: maxX < 0 ? 0 : (100 * (maxX - minX + 1)) / width,
    heightPct: maxY < 0 ? 0 : (100 * (maxY - minY + 1)) / height,
  };
}
