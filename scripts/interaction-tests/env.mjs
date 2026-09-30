/**
 * jsdom environment for the GAYZE interaction tests.
 *
 * Installed BEFORE any React/Leaflet import so those libraries see a DOM.
 * Must be imported first, and the component under test must then be loaded
 * with a dynamic import().
 */
import { JSDOM } from 'jsdom';

// Vite's `import.meta.env` shim — see vite-env-hook.mjs. Installed here, before
// any component is imported, so real source files that read it do not throw.
// Supabase stays unconfigured: these tests exercise UI behaviour, not a backend.
globalThis.__GAYZE_VITE_ENV__ = {
  MODE: 'test',
  DEV: false,
  PROD: false,
  BASE_URL: '/',
};

const dom = new JSDOM('<!doctype html><html><body><div id="root"></div></body></html>', {
  url: 'https://gayze.app/',
  pretendToBeVisual: true,
});

const { window } = dom;

// jsdom does not implement layout; Leaflet needs these to size the map.
window.HTMLElement.prototype.getBoundingClientRect = function getBoundingClientRect() {
  return { x: 0, y: 0, top: 0, left: 0, right: 400, bottom: 800, width: 400, height: 800, toJSON() {} };
};
window.HTMLElement.prototype.scrollIntoView = function scrollIntoView() {};

globalThis.window = window;
globalThis.document = window.document;
// Node 22 exposes `navigator` as a getter-only global, so it must be redefined
// rather than assigned.
Object.defineProperty(globalThis, 'navigator', {
  value: window.navigator, configurable: true, writable: true,
});
globalThis.HTMLElement = window.HTMLElement;
globalThis.Element = window.Element;
globalThis.Node = window.Node;
globalThis.Event = window.Event;
globalThis.CustomEvent = window.CustomEvent;
globalThis.MutationObserver = window.MutationObserver;
globalThis.ResizeObserver = class ResizeObserver {
  observe() {} unobserve() {} disconnect() {}
};
globalThis.requestAnimationFrame = (cb) => setTimeout(() => cb(Date.now()), 0);
globalThis.cancelAnimationFrame = (id) => clearTimeout(id);
globalThis.getComputedStyle = window.getComputedStyle.bind(window);
globalThis.localStorage = window.localStorage;
globalThis.sessionStorage = window.sessionStorage;
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

// Leaflet queries matchMedia in some paths.
if (!window.matchMedia) {
  window.matchMedia = () => ({
    matches: false, addEventListener() {}, removeEventListener() {},
    addListener() {}, removeListener() {}, onchange: null, media: '', dispatchEvent: () => false,
  });
}

// Controllable intervals. RightNowView runs a 30 s "now" tick that drops
// expired intents off the map; tests need to fire it on demand instead of
// waiting 30 real seconds.
const realSetInterval = window.setInterval.bind(window);
const realClearInterval = window.clearInterval.bind(window);
const liveIntervals = new Map();
let nextIntervalId = 1;

window.setInterval = function setInterval(cb, ms, ...args) {
  const id = nextIntervalId++;
  liveIntervals.set(id, { cb, args, ms });
  return id;
};
window.clearInterval = function clearInterval(id) {
  if (!liveIntervals.delete(id)) realClearInterval(id);
};
globalThis.setInterval = window.setInterval;
globalThis.clearInterval = window.clearInterval;

/** Fire every currently-registered interval callback once. */
export function flushIntervals() {
  for (const { cb, args } of [...liveIntervals.values()]) cb(...args);
}

export const testWindow = window;
export const testDocument = window.document;

/** Mount point helper. */
export function mountRoot() {
  const container = testDocument.createElement('div');
  testDocument.body.appendChild(container);
  return container;
}
