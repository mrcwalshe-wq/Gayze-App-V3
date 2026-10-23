/**
 * iOS Home Screen icon regression test (no image libraries: a small PNG decoder).
 *   node --test scripts/icon-tests/icons.test.mjs
 *
 * iOS needs an OPAQUE, square PNG (180x180 for current iPhones) linked with
 * rel="apple-touch-icon". A transparent 64px nav mark, a corrupt PNG, or an icon
 * where headless-browser clipping cut the logo in half all produced a wrong or
 * blank Home Screen icon, so each is asserted here.
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync, existsSync } from 'node:fs';
import { inflateSync } from 'node:zlib';

const root = new URL('../../', import.meta.url);
const read = (p) => readFileSync(new URL(p, root));

function decodePng(buffer) {
  assert.deepEqual([...buffer.subarray(0, 8)], [137, 80, 78, 71, 13, 10, 26, 10], 'PNG signature');
  let off = 8; let ihdr; const idat = [];
  while (off < buffer.length) {
    const len = buffer.readUInt32BE(off); const type = buffer.toString('ascii', off + 4, off + 8);
    const data = buffer.subarray(off + 8, off + 8 + len);
    if (type === 'IHDR') ihdr = { w: data.readUInt32BE(0), h: data.readUInt32BE(4), depth: data[8], color: data[9], interlace: data[12] };
    if (type === 'IDAT') idat.push(data);
    off += 12 + len;
  }
  assert.ok(ihdr, 'IHDR present'); assert.equal(ihdr.depth, 8); assert.equal(ihdr.interlace, 0);
  const channels = { 2: 3, 6: 4 }[ihdr.color];
  assert.ok(channels, `unsupported colour type ${ihdr.color} (need RGB or RGBA)`);
  const raw = inflateSync(Buffer.concat(idat)); // throws on a corrupt stream
  const stride = ihdr.w * channels; const px = Buffer.alloc(ihdr.h * stride);
  for (let y = 0; y < ihdr.h; y++) {
    const f = raw[y * (stride + 1)]; const line = raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1));
    for (let x = 0; x < stride; x++) {
      const a = x >= channels ? px[y * stride + x - channels] : 0;
      const b = y ? px[(y - 1) * stride + x] : 0;
      const c = x >= channels && y ? px[(y - 1) * stride + x - channels] : 0;
      let v = line[x];
      if (f === 1) v += a; else if (f === 2) v += b; else if (f === 3) v += (a + b) >> 1;
      else if (f === 4) { const p = a + b - c; const pa = Math.abs(p - a); const pb = Math.abs(p - b); const pc = Math.abs(p - c); v += pa <= pb && pa <= pc ? a : pb <= pc ? b : c; }
      px[y * stride + x] = v & 255;
    }
  }
  return { ...ihdr, channels, px };
}

function glyphBox({ w, h, channels, px }) {
  let x0 = w, x1 = 0, y0 = h, y1 = 0, count = 0;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const i = (y * w + x) * channels; const r = px[i] / 255, g = px[i + 1] / 255, b = px[i + 2] / 255;
    const max = Math.max(r, g, b); const min = Math.min(r, g, b);
    if (max > 0.45 && (max - min) / max > 0.45) { count++; x0 = Math.min(x0, x); x1 = Math.max(x1, x); y0 = Math.min(y0, y); y1 = Math.max(y1, y); }
  }
  return { count, left: x0 / w, right: x1 / w, top: y0 / h, bottom: y1 / h };
}

const ICONS = { 180: 'public/icons/gayze-apple-touch-180.png', 167: 'public/icons/gayze-apple-touch-167.png', 152: 'public/icons/gayze-apple-touch-152.png', 120: 'public/icons/gayze-apple-touch-120.png' };

for (const [size, path] of Object.entries(ICONS)) {
  test(`${path}: valid, ${size}x${size}, fully opaque, complete centred Gayze eye-G mark`, () => {
    const img = decodePng(read(path));
    assert.equal(img.w, Number(size)); assert.equal(img.h, Number(size));
    if (img.channels === 4) for (let i = 3; i < img.px.length; i += 4) assert.equal(img.px[i], 255, 'no transparent pixels');
    const box = glyphBox(img);
    assert.ok(box.count > 200, `logo pixels present (${box.count})`);
    // The reference 512px app icon spans x 0.09-0.91, y 0.30-0.70: the mark must be complete and centred.
    assert.ok(box.left > 0.05 && box.left < 0.14 && box.right > 0.86 && box.right < 0.95, `horizontal extent ${box.left.toFixed(2)}-${box.right.toFixed(2)}`);
    assert.ok(box.top > 0.25 && box.top < 0.35 && box.bottom > 0.65 && box.bottom < 0.75, `vertical extent ${box.top.toFixed(2)}-${box.bottom.toFixed(2)} (a clipped render ends near 0.5)`);
  });
}

test('public/apple-touch-icon.png (iOS default request) is a valid opaque 180x180 identical to the linked icon', () => {
  const img = decodePng(read('public/apple-touch-icon.png'));
  assert.equal(img.w, 180); assert.equal(img.h, 180);
  assert.ok(read('public/apple-touch-icon.png').equals(read(ICONS[180])));
});

test('index.html links sized apple-touch-icons that exist; manifest icons exist; versions agree with the service worker', () => {
  const html = read('index.html').toString();
  const links = [...html.matchAll(/<link rel="apple-touch-icon" sizes="(\d+)x\1" href="([^"]+)"/g)];
  assert.deepEqual(links.map((m) => m[1]).sort(), ['120', '152', '167', '180']);
  for (const [, size, href] of links) {
    const file = `public${href.split('?')[0]}`;
    assert.ok(existsSync(new URL(file, root)), `${file} exists`);
    assert.equal(decodePng(read(file)).w, Number(size));
  }
  assert.ok(!/rel="apple-touch-icon"[^>]*gayze-nav-mark/.test(html), 'must not point at the 64px transparent nav mark');
  const version = /\?v=(\d{8}-\d+)/.exec(links[0][2])[1];
  const manifest = JSON.parse(read('public/manifest.webmanifest').toString());
  for (const icon of manifest.icons) {
    assert.ok(existsSync(new URL(`public${icon.src.split('?')[0]}`, root)), `${icon.src} exists`);
    assert.ok(icon.src.includes(`v=${version}`), `${icon.src} uses icon version ${version}`);
  }
  const sw = read('public/service-worker.js').toString();
  assert.ok(sw.includes(`ICON_VERSION = '?v=${version}'`), 'service worker icon version matches');
  for (const size of Object.keys(ICONS)) assert.ok(sw.includes(`gayze-apple-touch-${size}.png`), `service worker precaches ${size}`);
});
