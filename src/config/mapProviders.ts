import type { TileLayerOptions } from 'leaflet';

export interface MapTileProvider {
  id: string;
  name: string;
  url: string;
  subdomains?: string | string[];
  attribution: string;
  maxZoom: number;
  minZoom: number;
  className?: string;
  crossOrigin?: boolean | '' | 'anonymous' | 'use-credentials';
  /** Required for OSM.org tile policy compliance (Referer must be sent). */
  referrerPolicy?: false | ReferrerPolicy;
}

/**
 * GAYZE V3 map providers.
 *
 * 1. OpenStreetMap primary (Obsidian Dark)
 * 2. OpenStreetMap HOT fallback
 *
 * Open/free chain. OSM requires a valid Referer — set referrerPolicy on
 * every OSM layer.
 */
export const MAP_PROVIDERS: MapTileProvider[] = [
  {
    id: 'osm-obsidian-dark',
    name: 'OpenStreetMap (Obsidian Dark)',
    url: 'https://tile.openstreetmap.org/{z}/{x}/{y}.png',
    attribution:
      '&copy; <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener noreferrer">OpenStreetMap</a> contributors',
    maxZoom: 19,
    minZoom: 1,
    className: 'gayze-osm-dark-tiles',
    crossOrigin: true,
    referrerPolicy: 'strict-origin-when-cross-origin',
  },
  {
    id: 'osm-hot-fallback',
    name: 'OpenStreetMap HOT (Fallback)',
    url: 'https://{s}.tile.openstreetmap.fr/hot/{z}/{x}/{y}.png',
    subdomains: 'abc',
    attribution:
      '&copy; <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener noreferrer">OpenStreetMap</a> contributors',
    maxZoom: 19,
    minZoom: 1,
    className: 'gayze-osm-dark-tiles',
    crossOrigin: true,
    referrerPolicy: 'strict-origin-when-cross-origin',
  },
];

export function tileLayerOptions(provider: MapTileProvider): TileLayerOptions {
  return {
    attribution: provider.attribution,
    subdomains: provider.subdomains || 'abcd',
    maxZoom: provider.maxZoom,
    minZoom: provider.minZoom,
    className: provider.className,
    crossOrigin: provider.crossOrigin,
    referrerPolicy: (provider.referrerPolicy ?? 'strict-origin-when-cross-origin') as TileLayerOptions['referrerPolicy'],
    updateWhenIdle: false,
    keepBuffer: 6,
  };
}
