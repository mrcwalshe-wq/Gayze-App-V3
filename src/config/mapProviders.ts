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
 * GAYZE V3 map providers.
 *
 * Keep the provider chain open/free and deterministic. No API key or
 * commercial service is required for the current implementation.
 */
export const MAP_PROVIDERS: MapTileProvider[] = [
  {
    id: 'osm-obsidian-dark',
    name: 'OpenStreetMap (Obsidian Dark)',
    url: 'https://tile.openstreetmap.org/{z}/{x}/{y}.png',
    attribution:
      '&copy; <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener noreferrer">OpenStreetMap</a> contributors',
    maxZoom: 19,
    minZoom: 10,
    className: 'gayze-osm-dark-tiles',
    crossOrigin: true,
  },
  {
    id: 'osm-hot-fallback',
    name: 'OpenStreetMap HOT (Fallback)',
    url: 'https://{s}.tile.openstreetmap.fr/hot/{z}/{x}/{y}.png',
    subdomains: 'abc',
    attribution:
      '&copy; <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener noreferrer">OpenStreetMap</a> contributors',
    maxZoom: 19,
    minZoom: 10,
    className: 'gayze-osm-dark-tiles',
    crossOrigin: true,
  },
];
