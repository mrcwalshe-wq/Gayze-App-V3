/**
 * Rebuild every GAYZE brand raster asset from the single source logo.
 *
 *   node scripts/build-brand-assets.mjs            # rebuild all
 *   node scripts/build-brand-assets.mjs --check    # verification report only
 *
 * Requires ImageMagick 6/7 (`convert`, or `magick`) on PATH.
 *
 * Why this exists
 * ---------------
 * The raw logo is a wide (2.05:1) mark painted for a *light* background: large
 * parts of its body are near-black, so on the app's near-black surfaces and on
 * the PWA tile roughly a fifth of the mark simply disappeared. The shipped
 * 180px icon was additionally a truncated PNG (no IEND chunk), so iOS/Android
 * could reject it outright.
 *
 * This script produces one transparent master mark with its darks lifted, then
 * composes every icon size from it over a lit brand plate, so the mark keeps
 * its full silhouette at 16px and at 512px.
 */
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, rmSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const PUBLIC = join(ROOT, 'public');
const ICONS = join(PUBLIC, 'icons');

/** Pristine source logo. It lives in public/brand/ and this script never
 *  writes to it — the derived logos in public/ are outputs, and using one of
 *  them as the input would re-crop and re-lift an already processed mark. */
const SOURCE = join(PUBLIC, 'brand', 'gayze-logo-source.webp');
const SOURCE_SIZE = '1536x874'; // guard against a swapped or re-exported source
const SOURCE_CROP = '942x459+295+206'; // verified stable from threshold 2%..10%
const BACKGROUND_KEY = '#030303'; // flood-fill key of the source backdrop
const BACKGROUND_FUZZ = '22%';

/** Tonal lift: gamma < 1 raises the mark's near-black body; saturation is
 *  nudged up so the lifted darks keep their violet/magenta identity. */
const LIFT_GAMMA = Number(process.env.GAYZE_LIFT_GAMMA ?? 0.95);
const LIFT_SATURATION = Number(process.env.GAYZE_LIFT_SAT ?? 104);
/** Floor lift: out = slope * v + floor, applied to RGB only. It raises the
 *  near-black body above the app's obsidian (#090A0F, luma 9) without
 *  touching the alpha channel. */
const LIFT_SLOPE = Number(process.env.GAYZE_LIFT_SLOPE ?? 0.87);
const LIFT_FLOOR = Number(process.env.GAYZE_LIFT_FLOOR ?? 0.11);

/** Brand plate: deep obsidian lifted by a violet core, so the mark's dark
 *  strokes read against light rather than dissolving into black. */
const PLATE_BASE = '#0B0810';
const PLATE_CORE = '#3B1E66';

/** Mark width as a fraction of the canvas. */
const SCALE_ANY = 0.86;
/** Maskable icons are cropped to a circle of 80% diameter: a 2.05:1 mark must
 *  stay within 0.69 of the canvas for its corners to survive that crop. */
const SCALE_MASKABLE = 0.68;

const TARGETS = [
  { file: 'icons/gayze-180.png', size: 180, scale: SCALE_ANY, opaque: true, desc: 'iOS / notification icon' },
  { file: 'icons/gayze-192.png', size: 192, scale: SCALE_ANY, opaque: true, desc: 'Android launcher + push icon' },
  { file: 'icons/gayze-512.png', size: 512, scale: SCALE_ANY, opaque: true, desc: 'PWA splash / store icon' },
  { file: 'icons/gayze-512-maskable.png', size: 512, scale: SCALE_MASKABLE, opaque: true, maskable: true, desc: 'Android adaptive icon' },
  { file: 'apple-touch-icon.png', size: 180, scale: SCALE_ANY, opaque: true, desc: 'iOS home screen' },
];

const IM = (() => {
  for (const bin of ['magick', 'convert']) {
    try {
      execFileSync(bin, ['-version'], { stdio: 'ignore' });
      return bin;
    } catch { /* try next */ }
  }
  throw new Error('ImageMagick not found (need `magick` or `convert` on PATH)');
})();

/** Run ImageMagick with an argument list — no shell, no quoting surprises. */
const im = (args) => execFileSync(IM, args, { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });

const CROP_TMP = join(ROOT, '.brand-build-crop.png');
const MASTER_TMP = join(ROOT, '.brand-build-master.png');

/** 1. Crop the mark out of the source canvas. */
function cropSource() {
  const size = im([SOURCE, '-format', '%wx%h', 'info:']).trim();
  if (size !== SOURCE_SIZE) {
    throw new Error(`${SOURCE} is ${size}, expected ${SOURCE_SIZE} — refusing to build from a derived logo`);
  }
  im([SOURCE, '-crop', SOURCE_CROP, '+repage', CROP_TMP]);
}

/** 2. Remove the backdrop and lift the mark's darks. */
function buildMaster() {
  im([
    CROP_TMP,
    '-alpha', 'set',
    '-fuzz', BACKGROUND_FUZZ, '-fill', 'none', '-floodfill', '+0+0', BACKGROUND_KEY,
    '-gamma', String(LIFT_GAMMA),
    '-modulate', `100,${LIFT_SATURATION},100`,
    '-channel', 'RGB', '-function', 'Polynomial', `${LIFT_SLOPE},${LIFT_FLOOR}`, '+channel',
    '-define', 'webp:lossless=true',
    MASTER_TMP,
  ]);
}

/** 3. Publish the transparent master the app renders. */
function publishMaster() {
  // Quality 95 measures RMSE 0.0066 against lossless — invisible, 4x smaller.
  // The master keeps its native 942px width so it stays crisp on 3x displays.
  for (const name of ['gayze-mark.webp', 'gayze-official-logo.webp', 'gayze-logo.webp']) {
    im([MASTER_TMP, '-define', 'webp:lossless=false', '-quality', '95', join(PUBLIC, name)]);
  }
}

/** Compose one icon: lit plate → soft colour halo → the mark itself. */
function buildIcon({ file, size, scale, maskable }) {
  const out = join(PUBLIC, file);
  const markW = Math.round(size * scale);
  const halo = Math.max(2, Math.round(size * 0.045)); // blur radius for the halo
  const coreY = Math.round(size * (maskable ? 0.5 : 0.47));

  im([
    '-size', `${size}x${size}`,
    '-define', `gradient:center=${Math.round(size / 2)},${coreY}`,
    '-define', `gradient:radii=${Math.round(size * 0.62)},${Math.round(size * 0.66)}`,
    `radial-gradient:${PLATE_CORE}-${PLATE_BASE}`,
    // Soft halo: the mark's own colour, blurred, so it reads as light in air.
    '(', MASTER_TMP, '-resize', `${markW}x`, '-channel', 'A', '-evaluate', 'multiply', '0.45',
    '+channel', '-blur', `0x${halo}`, ')',
    '-gravity', 'center', '-compose', 'Over', '-composite',
    '(', MASTER_TMP, '-resize', `${markW}x`, ')',
    '-gravity', 'center', '-compose', 'Over', '-composite',
    '-alpha', 'off',
    '-colors', '256', '-dither', 'FloydSteinberg', '-depth', '8',
    '-define', 'png:compression-level=9', '-define', 'png:compression-filter=5',
    '-strip',
    // PNG8 forces a real 8-bit palette: without it ImageMagick emits 16-bit
    // truecolor and the icons land at twice the size for no visible gain.
    `PNG8:${out}`,
  ]);
}

/** Favicon: at 16px the mark's internal gradient is noise, so the tile is
 *  built from the almond silhouette filled with the brand gradient, with the
 *  full-colour mark laid over it for sizes that can resolve detail. */
function buildFavicon() {
  im([
    '-size', '64x64',
    '-define', 'gradient:center=32,30', '-define', 'gradient:radii=40,42',
    `radial-gradient:${PLATE_CORE}-${PLATE_BASE}`,
    // Flat almond: silhouette filled violet -> magenta -> amber.
    '(',
    '-size', '57x28', 'gradient:#8B5CF6-#C9A24D',
    '(', MASTER_TMP, '-resize', '57x', '-alpha', 'extract', '-threshold', '35%', ')',
    '-alpha', 'off', '-compose', 'CopyOpacity', '-composite',
    ')', '-gravity', 'center', '-compose', 'Over', '-composite',
    // Real mark over it, so 32px and up keep the artwork.
    '(', MASTER_TMP, '-resize', '57x', '-channel', 'A', '-evaluate', 'multiply', '0.7', '+channel', ')',
    '-gravity', 'center', '-compose', 'Over', '-composite',
    '-alpha', 'off',
    '-define', 'icon:auto-resize=48,32,16',
    join(PUBLIC, 'favicon.ico'),
  ]);
}

/* ------------------------------------------------------------------ checks */

/** Luma statistics over the solid body of an RGBA image. */
function bodyStats(file) {
  const txt = im([file, '-resize', '300x146!', '-depth', '8', 'txt:-']);
  let n = 0, dark = 0, bright = 0, clipped = 0, sum = 0;
  for (const line of txt.split('\n')) {
    const m = line.match(/\((\d+),(\d+),(\d+),?(\d*)\)/);
    if (!m) continue;
    const [r, g, b] = [+m[1], +m[2], +m[3]];
    const a = m[4] === '' ? 255 : +m[4];
    if (a < 200) continue;
    const luma = 0.299 * r + 0.587 * g + 0.114 * b;
    n++; sum += luma;
    if (luma < 20) dark++;      // indistinguishable from the #090A0F app canvas
    if (luma > 150) bright++;
    if (r >= 250 || g >= 250 || b >= 250) clipped++;
  }
  return {
    px: n,
    darkPct: n ? (100 * dark) / n : 0,
    brightPct: n ? (100 * bright) / n : 0,
    clippedPct: n ? (100 * clipped) / n : 0,
    meanLuma: n ? sum / n : 0,
  };
}

/** An icon is "filled" when the mark's ink covers a healthy share of the tile. */
function inkCoverage(file) {
  const txt = im([file, '-colorspace', 'gray', '-resize', '120x120!', '-depth', '8', 'txt:-']);
  let n = 0, ink = 0, minX = 120, maxX = -1, minY = 120, maxY = -1;
  let y = -1, x = 0;
  for (const line of txt.split('\n')) {
    const m = line.match(/^(\d+),(\d+):/);
    const v = line.match(/\((\d+)/);
    if (!m || !v) continue;
    if (+m[2] !== y) { y = +m[2]; x = 0; }
    const luma = +v[1];
    n++;
    if (luma > 26) { // anything the eye separates from the obsidian plate
      ink++;
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
    }
    x++;
  }
  return {
    inkPct: n ? (100 * ink) / n : 0,
    bbox: `${maxX - minX + 1}x${maxY - minY + 1}+${minX}+${minY}`,
    widthPct: n ? (100 * (maxX - minX + 1)) / 120 : 0,
  };
}

/** A PNG is truly complete only if it ends with an IEND chunk. */
function pngIsComplete(file) {
  const buf = readFileSync(file);
  const iend = buf.indexOf(Buffer.from('IEND'));
  // IEND must be present and effectively at the end (4-byte length + type + CRC).
  return iend !== -1 && buf.length - iend <= 12;
}

function verify() {
  console.log('\n=== Master mark ===');
  const s = bodyStats(MASTER_TMP);
  console.log(`  opaque body      ${s.px} px (of 300x146 sample)`);
  console.log(`  mean luma        ${s.meanLuma.toFixed(1)}`);
  console.log(`  invisible on app bg (luma<20)  ${s.darkPct.toFixed(1)}%`);
  console.log(`  bright body      ${s.brightPct.toFixed(1)}%`);
  console.log(`  clipped channels ${s.clippedPct.toFixed(1)}%`);

  console.log('\n=== Icons ===');
  for (const t of [...TARGETS]) {
    const file = join(PUBLIC, t.file);
    if (!existsSync(file)) { console.log(`  ${t.file}  MISSING`); continue; }
    let cov;
    try {
      cov = inkCoverage(file);
    } catch {
      console.log(`  ${t.file.padEnd(28)}      UNREADABLE — not a decodable PNG`);
      continue;
    }
    const done = pngIsComplete(file);
    console.log(
      `  ${t.file.padEnd(28)} ${String(t.size).padStart(3)}px  ` +
      `ink ${cov.inkPct.toFixed(1).padStart(4)}%  mark width ${cov.widthPct.toFixed(0)}%  ` +
      `bbox ${cov.bbox.padEnd(16)} IEND ${done ? 'ok' : 'MISSING'}  ${(statSync(file).size / 1024).toFixed(0)}KB`,
    );
  }
  const fav = join(PUBLIC, 'favicon.ico');
  if (existsSync(fav)) console.log(`  favicon.ico                  ${(statSync(fav).size / 1024).toFixed(0)}KB`);
}

/* -------------------------------------------------------------------- main */

/** Scratch files live beside the repo root; never leave them behind. */
function cleanup() {
  for (const f of [CROP_TMP, MASTER_TMP]) rmSync(f, { force: true });
}

const checkOnly = process.argv.includes('--check');

try {
if (checkOnly) {
  cropSource();
  buildMaster();
  verify();
} else {
  mkdirSync(ICONS, { recursive: true });
  cropSource();
  buildMaster();
  publishMaster();
  for (const t of TARGETS) buildIcon({ ...t, scale: t.scale ?? (t.maskable ? SCALE_MASKABLE : SCALE_ANY) });
  buildFavicon();
  verify();
  console.log('\nBrand assets rebuilt.');
}
} finally {
  cleanup();
}
