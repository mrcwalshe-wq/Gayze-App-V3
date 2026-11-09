import { defineConfig } from '@playwright/test';

/**
 * Visual-regression + accessibility harness. It drives the production build in the
 * app's own signed-in path using a locally-fabricated session and intercepted network,
 * so it never touches the live Supabase project and no app code is changed.
 */
const VIEWPORTS = {
  'iphone-440x956': { width: 440, height: 956 },
  'iphone-402x874': { width: 402, height: 874 },
  'iphone-375x667': { width: 375, height: 667 },
  'desktop-1280x800': { width: 1280, height: 800 },
} as const;

export default defineConfig({
  testDir: './e2e',
  testMatch: /.*\.spec\.ts/,
  snapshotPathTemplate: '{testDir}/baseline/{projectName}/{arg}{ext}',
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: [['list']],
  timeout: 60_000,
  expect: { timeout: 20_000, toHaveScreenshot: { maxDiffPixelRatio: 0.001, animations: 'disabled', caret: 'hide' } },
  use: {
    baseURL: 'http://localhost:4173',
    deviceScaleFactor: 1,
    locale: 'en-GB',
    timezoneId: 'Europe/London',
    geolocation: { latitude: 51.4975, longitude: -0.0889 },
    permissions: ['geolocation'],
    colorScheme: 'dark',
    serviceWorkers: 'block',
    contextOptions: { reducedMotion: 'reduce' },
    trace: 'off',
  },
  projects: Object.entries(VIEWPORTS).map(([name, viewport]) => ({ name, use: { viewport, isMobile: false, hasTouch: name.startsWith('iphone') } })),
  webServer: {
    command: 'npm run build && npx vite preview --port 4173 --strictPort',
    url: 'http://localhost:4173',
    reuseExistingServer: true,
    timeout: 180_000,
  },
});
