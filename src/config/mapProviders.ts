export interface MapTileProvider {
  id: string;
  name: string;
  url: string;
  subdomains?: string | string[];
  attribution: string;
  maxZoom: number;
  minZoom: number;
  className?: string;
  crossOrigin?: boolean;
}

/**
 * GAYZE V3 Map Providers Configuration
 * Gracefully falls back between genuinely free, open providers.
 * Changing providers or adding keys requires editing this single configuration.
 */
export const MAP_PROVIDERS: MapTileProvider[] = [
  {
    id: 'osm-obsidian-dark',
    name: 'OpenStreetMap (Obsidian Dark)',
    // Openly licensed, free OSM tile layer with dark CSS filter
    url: 'https://tile.openstreetmap.org/{z}/{x}/{y}.png',
    attribution: '&copy; <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap</a> contributors',
    maxZoom: 19,
    minZoom: 10,
    className: 'gayze-osm-dark-tiles',
    crossOrigin: true,
  },
  {
    id: 'carto-dark-matter',
    name: 'CARTO Dark Matter (Raster Fallback)',
    url: 'https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}.png',
    subdomains: 'abcd',
    attribution: '&copy; <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap</a> contributors &copy; <a href="https://carto.com/attributions" target="_blank" rel="noopener">CARTO</a>',
    maxZoom: 19,
    minZoom: 10,
    className: 'gayze-carto-dark-tiles',
    crossOrigin: true,
  },
  {
    id: 'osm-hot-fallback',
    name: 'Humanitarian OSM (Fallback)',
    url: 'https://{s}.tile.openstreetmap.fr/hot/{z}/{x}/{y}.png',
    subdomains: 'abc',
    attribution: '&copy; <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap</a> contributors',
    maxZoom: 19,
    minZoom: 10,
    className: 'gayze-osm-dark-tiles',
    crossOrigin: true,
  },
];
