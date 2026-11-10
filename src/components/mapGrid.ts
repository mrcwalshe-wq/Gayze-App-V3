import L from 'leaflet';

/**
 * The map's HEAT view. The map is divided into square cells measured in metres. A cell where people are live glows,
 * from violet (one person) through magenta and orange to amber (five or more), and carries its head-count; nobody's exact spot is ever drawn. The cell size never goes below 500 m (the precision members'
 * positions are fogged to), so zooming in cannot suggest more accuracy than exists.
 *
 * Coordinates read like a chart: letters across the top, numbers down the side, and every occupied cell carries its
 * own reference (e.g. "C4") and head-count. A slow radar sweep crosses the grid while it is on.
 */
export interface GridPoint { lat: number; lng: number }
export interface GridOptions {
  getPoints: () => GridPoint[];
  getSelf: () => GridPoint | null;
  onCellTap?: (info: { ref: string; count: number; bounds: L.LatLngBounds }) => void;
}

const NICE = [500, 1000, 2000, 5000, 10000, 20000];
/** Colour by head-count: 1 violet, 2 magenta, 3-4 orange, 5+ amber. Cooler means quieter. */
export const HEAT_TIERS = [
  { core: '#a78bfa', mid: '#7c4ddb', line: '#b9a2ff' },
  { core: '#e879f9', mid: '#c026d3', line: '#f0abfc' },
  { core: '#fb923c', mid: '#ea580c', line: '#fdba74' },
  { core: '#fde68a', mid: '#f59e0b', line: '#fde68a' },
];
export const heatTier = (n: number) => (n >= 5 ? 4 : n >= 3 ? 3 : n >= 2 ? 2 : 1);
const colLetters = (n: number) => String.fromCharCode(65 + ((n % 26) + 26) % 26);
const rowNumber = (n: number) => String(((n % 99) + 99) % 99 + 1);

export function createMapGrid(map: L.Map, opts: GridOptions) {
  const pane = map.getPane('gayzeGrid') ?? map.createPane('gayzeGrid');
  pane.style.zIndex = '350';
  pane.style.pointerEvents = 'none';
  const renderer = L.svg({ pane: 'gayzeGrid', padding: 0.5 });
  map.addLayer(renderer);
  const svg = (renderer as unknown as { _container: SVGElement })._container;
  if (svg && !svg.querySelector('#gz-hatch')) {
    const ns = 'http://www.w3.org/2000/svg';
    const defs = document.createElementNS(ns, 'defs');
    defs.innerHTML = `
      <pattern id="gz-hatch" width="9" height="9" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
        <rect width="9" height="9" fill="rgba(124,76,220,.10)"/><line x1="0" y1="0" x2="0" y2="9" stroke="rgba(190,150,255,.55)" stroke-width="2.2"/>
      </pattern>
      <pattern id="gz-hatch-hot" width="7" height="7" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
        <rect width="7" height="7" fill="rgba(150,100,235,.20)"/><line x1="0" y1="0" x2="0" y2="7" stroke="rgba(220,190,255,.85)" stroke-width="2.4"/>
      </pattern>`;
    svg.insertBefore(defs, svg.firstChild);
  }

  // The heat glow sits just under the grid lines, so it reads as a soft wash and the cells stay crisp.
  const heatPane = map.getPane('gayzeHeat') ?? map.createPane('gayzeHeat');
  heatPane.style.zIndex = '345';
  heatPane.style.pointerEvents = 'none';
  heatPane.style.mixBlendMode = 'screen';
  heatPane.style.opacity = '0.8';
  const heatRenderer = L.svg({ pane: 'gayzeHeat', padding: 0.5 });
  map.addLayer(heatRenderer);
  const heatSvg = (heatRenderer as unknown as { _container: SVGElement })._container;
  if (heatSvg && !heatSvg.querySelector('#gz-heat-1')) {
    const ns = 'http://www.w3.org/2000/svg';
    const defs = document.createElementNS(ns, 'defs');
    defs.innerHTML = HEAT_TIERS.map((t, i) => `
      <radialGradient id="gz-heat-${i + 1}">
        <stop offset="0%" stop-color="${t.core}" stop-opacity=".85"/>
        <stop offset="45%" stop-color="${t.mid}" stop-opacity=".5"/>
        <stop offset="100%" stop-color="${t.mid}" stop-opacity="0"/>
      </radialGradient>`).join('');
    heatSvg.insertBefore(defs, heatSvg.firstChild);
  }

  const group = L.layerGroup().addTo(map);
  const heatGroup = L.layerGroup().addTo(map);
  const labels = document.createElement('div');
  labels.className = 'gz-grid-labels';
  labels.setAttribute('aria-hidden', 'true');
  map.getContainer().appendChild(labels);
  const sweep = document.createElement('div');
  sweep.className = 'gz-grid-sweep';
  sweep.setAttribute('aria-hidden', 'true');
  map.getContainer().appendChild(sweep);

  let raf = 0;
  let destroyed = false;

  const cellSizeFor = () => {
    const c = map.getCenter();
    const mpp = (40075016.686 * Math.cos((c.lat * Math.PI) / 180)) / (256 * Math.pow(2, map.getZoom()));
    const target = mpp * 96; // aim for roughly 96 px cells
    return NICE.find((n) => n >= target) ?? NICE[NICE.length - 1];
  };
  const crs = map.options.crs as L.CRS;
  const toMeters = (ll: L.LatLng) => crs.project(ll);
  const fromMeters = (x: number, y: number) => crs.unproject(L.point(x, y));

  const draw = () => {
    raf = 0;
    if (destroyed) return;
    group.clearLayers();
    heatGroup.clearLayers();
    labels.innerHTML = '';
    const size = cellSizeFor();
    const b = map.getBounds().pad(0.15);
    const sw = toMeters(b.getSouthWest()), ne = toMeters(b.getNorthEast());
    const i0 = Math.floor(sw.x / size), i1 = Math.floor(ne.x / size);
    const j0 = Math.floor(sw.y / size), j1 = Math.floor(ne.y / size);
    if ((i1 - i0 + 1) * (j1 - j0 + 1) > 900) return;

    // Hairlines, with every fifth one stronger.
    const minor: L.LatLngExpression[][] = [], major: L.LatLngExpression[][] = [];
    for (let i = i0; i <= i1 + 1; i++) (i % 5 === 0 ? major : minor).push([fromMeters(i * size, j0 * size), fromMeters(i * size, (j1 + 1) * size)]);
    for (let j = j0; j <= j1 + 1; j++) (j % 5 === 0 ? major : minor).push([fromMeters(i0 * size, j * size), fromMeters((i1 + 1) * size, j * size)]);
    L.polyline(minor, { pane: 'gayzeGrid', renderer, interactive: false, className: 'gz-line', weight: 0.7, color: '#b79cff', opacity: 0.16 }).addTo(group);
    L.polyline(major, { pane: 'gayzeGrid', renderer, interactive: false, className: 'gz-line gz-line--major', weight: 1, color: '#d8c8ff', opacity: 0.28 }).addTo(group);

    // Occupied cells.
    const counts = new Map<string, { i: number; j: number; n: number }>();
    for (const p of opts.getPoints()) {
      if (!Number.isFinite(p.lat) || !Number.isFinite(p.lng)) continue;
      const m = toMeters(L.latLng(p.lat, p.lng));
      const i = Math.floor(m.x / size), j = Math.floor(m.y / size);
      const k = `${i}:${j}`;
      const c = counts.get(k) ?? { i, j, n: 0 };
      c.n += 1; counts.set(k, c);
    }
    const self = opts.getSelf();
    let selfKey = '';
    if (self) { const m = toMeters(L.latLng(self.lat, self.lng)); selfKey = `${Math.floor(m.x / size)}:${Math.floor(m.y / size)}`; }

    const place = (k: string, i: number, j: number, n: number, mine: boolean, order: number) => {
      const bounds = L.latLngBounds(fromMeters(i * size, j * size), fromMeters((i + 1) * size, (j + 1) * size));
      const ref = `${colLetters(i)}${rowNumber(j)}`;
      if (n > 0) {
        const tier = heatTier(n);
        const t = HEAT_TIERS[tier - 1];
        // A soft glow that spills a little into the neighbouring cells, and a faint cell outline on top of it.
        const glow = L.circle(bounds.getCenter(), { pane: 'gayzeHeat', renderer: heatRenderer, interactive: false, radius: size * (0.62 + 0.07 * Math.min(n, 6)), weight: 0, fill: true, fillOpacity: 1, className: 'gz-glow' }).addTo(heatGroup);
        const gel = (glow as unknown as { _path?: SVGPathElement })._path;
        if (gel) { gel.style.fill = `url(#gz-heat-${tier})`; gel.style.animationDelay = `${Math.min(order * 70, 700)}ms`; }
        L.rectangle(bounds, {
          pane: 'gayzeGrid', renderer, interactive: false, className: 'gz-cell',
          weight: 1, color: t.line, opacity: 0.5, fill: true, fillColor: t.mid, fillOpacity: 0.16,
        }).addTo(group);
      } else if (mine) {
        L.rectangle(bounds, { pane: 'gayzeGrid', renderer, interactive: false, className: 'gz-cell gz-cell--empty', weight: 1.2, color: '#e6d8ff', opacity: 0.55, fill: true, fillColor: '#b79cff', fillOpacity: 0.07 }).addTo(group);
      }
      const centre = bounds.getCenter();
      const html = `<div class="gz-tag${mine ? ' gz-tag--me' : ''}" style="animation-delay:${Math.min(order * 70, 700) + 120}ms">${n > 0 ? `<b>${n}</b>` : ''}${mine ? '<i>You</i>' : ''}</div>`;
      const icon = L.divIcon({ className: 'gz-tag-wrap', html, iconSize: [0, 0] });
      const mk = L.marker(centre, { icon, interactive: n > 0, keyboard: false, zIndexOffset: 200 }).addTo(group);
      if (n > 0 && opts.onCellTap) mk.on('click', () => opts.onCellTap!({ ref, count: n, bounds }));
    };
    let order = 0;
    counts.forEach((c, k) => place(k, c.i, c.j, c.n, k === selfKey, order++));
    if (self && !counts.has(selfKey)) { const [i, j] = selfKey.split(':').map(Number); place(selfKey, i, j, 0, true, order++); }

    labels.dataset.size = size >= 1000 ? `${size / 1000} km` : `${size} m`;
    map.getContainer().dispatchEvent(new CustomEvent('gz-grid', { detail: { size, occupied: counts.size } }));
  };

  const schedule = () => { if (!raf && !destroyed) raf = requestAnimationFrame(draw); };
  map.on('moveend zoomend resize', schedule);
  map.on('move', schedule);
  draw();

  return {
    refresh: schedule,
    cellSize: cellSizeFor,
    destroy() {
      destroyed = true;
      if (raf) cancelAnimationFrame(raf);
      map.off('moveend zoomend resize', schedule);
      map.off('move', schedule);
      map.removeLayer(group);
      map.removeLayer(heatGroup);
      map.removeLayer(renderer);
      map.removeLayer(heatRenderer);
      labels.remove();
      sweep.remove();
    },
  };
}
