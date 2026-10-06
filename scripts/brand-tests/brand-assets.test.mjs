/**
 * Brand asset guard rails.
 *
 * Two real defects shipped before this suite existed:
 *   1. icons/gayze-180.png (and its twin apple-touch-icon.png) was a truncated
 *      PNG — no IEND chunk, garbage trailing bytes. iOS could reject it and
 *      the service worker was pointing push notifications at it.
 *   2. Every icon carried the mark painted for a *light* background on a
 *      near-black tile, so a quarter of the mark's body was invisible and the
 *      artwork covered only ~15% of the tile.
 *
 * These checks fail loudly if either comes back.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import assert from 'node:assert/strict';
import { inkStats, isComplete } from './png.mjs';

const REPO = fileURLToPath(new URL('../..', import.meta.url)).replace(/\/$/, '');
const PUBLIC = join(REPO, 'public');

const ICONS = [
  { file: 'icons/gayze-180.png', size: 180, minInk: 20, minWidthPct: 70 },
  { file: 'icons/gayze-192.png', size: 192, minInk: 20, minWidthPct: 70 },
  { file: 'icons/gayze-512.png', size: 512, minInk: 20, minWidthPct: 70 },
  // Maskable: the mark must stay inside Android's 80%-diameter safe circle,
  // so it is deliberately smaller than the "any" icons but still substantial.
  { file: 'icons/gayze-512-maskable.png', size: 512, minInk: 15, minWidthPct: 55, maxWidthPct: 80 },
  { file: 'apple-touch-icon.png', size: 180, minInk: 20, minWidthPct: 70 },
];

test('every shipped icon is a complete, decodable PNG', () => {
  for (const { file } of ICONS) {
    const path = join(PUBLIC, file);
    assert.ok(isComplete(path), `${file} is truncated or missing its IEND chunk`);
    const { width, height } = inkStats(path);
    assert.equal(width, height, `${file} must be square`);
  }
});

test('icons are declared size and carry the mark at a usable weight', () => {
  for (const { file, size, minInk, minWidthPct, maxWidthPct } of ICONS) {
    const stats = inkStats(join(PUBLIC, file));
    assert.equal(stats.width, size, `${file} should be ${size}px`);
    assert.ok(
      stats.inkPct >= minInk,
      `${file} is too faint: ${stats.inkPct.toFixed(1)}% ink (min ${minInk}%)`,
    );
    assert.ok(
      stats.widthPct >= minWidthPct,
      `${file} mark is too small: ${stats.widthPct.toFixed(0)}% of the tile (min ${minWidthPct}%)`,
    );
    if (maxWidthPct) {
      assert.ok(
        stats.widthPct <= maxWidthPct,
        `${file} mark overflows the maskable safe zone: ${stats.widthPct.toFixed(0)}% (max ${maxWidthPct}%)`,
      );
    }
  }
});

test('the manifest and document head point at assets that exist', () => {
  const manifest = JSON.parse(readFileSync(join(PUBLIC, 'manifest.webmanifest'), 'utf8'));
  for (const icon of manifest.icons) {
    assert.ok(isComplete(join(PUBLIC, icon.src)), `manifest icon ${icon.src} is missing or truncated`);
  }
  const html = readFileSync(join(REPO, 'index.html'), 'utf8');
  for (const href of html.match(/(?:href|content)="(\/(?:icons|favicon)[^"]*)"/g) ?? []) {
    const path = href.replace(/^[^"]*"/, '').replace(/"$/, '');
    assert.ok(
      readFileSync(join(PUBLIC, path)).length > 0,
      `index.html references ${path}, which is missing from public/`,
    );
  }
  assert.match(html, /rel="icon"[^>]*favicon\.ico/, 'index.html should link the favicon');
});

test('the service worker notifies with an icon that exists', () => {
  const sw = readFileSync(join(PUBLIC, 'service-worker.js'), 'utf8');
  const icons = [...sw.matchAll(/const NOTIFICATION_(?:ICON|BADGE) = '([^']+)'/g)].map((m) => m[1]);
  assert.ok(icons.length >= 1, 'service worker should define notification artwork');
  for (const icon of icons) {
    assert.ok(
      isComplete(join(PUBLIC, icon)),
      `service worker notification artwork ${icon} is missing or truncated`,
    );
  }
  // Push icons are advertised to Android; 192px is the size the push tests pin.
  assert.match(sw, /const NOTIFICATION_ICON = '\/icons\/gayze-192\.png'/);
});

test('the app renders one master mark, and it is the rebuilt one', () => {
  const logo = readFileSync(join(REPO, 'src/components/GayzeLogo.tsx'), 'utf8');
  assert.match(logo, /gayze-mark\.webp/, 'the mark should be served from the optimised master');
  assert.match(logo, /GAYZE_MARK_RATIO = 942 \/ 459/, 'the mark ratio must match the master asset');
  assert.ok(
    readFileSync(join(PUBLIC, 'gayze-mark.webp')).length > 10_000,
    'the master mark is missing or suspiciously small',
  );
  assert.ok(
    readFileSync(join(PUBLIC, 'brand/gayze-logo-source.webp')).length > 10_000,
    'the pristine source logo is missing (scripts/build-brand-assets.mjs needs it)',
  );
});

test('watermarks are decorative only', () => {
  const watermark = readFileSync(join(REPO, 'src/components/GayzeWatermark.tsx'), 'utf8');
  assert.match(watermark, /aria-hidden="true"/, 'the watermark must be hidden from assistive tech');
  assert.match(watermark, /alt=""/, 'a decorative mark needs an empty alt');
  const chrome = readFileSync(join(REPO, 'src/brand-chrome.css'), 'utf8');
  assert.ok(
    /\.g-watermark\s*\{[^}]*pointer-events:\s*none/s.test(chrome),
    'the watermark must never capture pointer events',
  );
});
