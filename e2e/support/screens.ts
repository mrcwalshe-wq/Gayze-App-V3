import type { Locator, Page } from '@playwright/test';
import { ready } from './harness';

export interface Screen {
  name: string;
  /** Only reachable on desktop widths (the mobile tab bar has no entry for it: report F9). */
  desktopOnly?: boolean;
  setup: (page: Page) => Promise<void>;
  /** Regions that are random per run (the app generates a new device key every launch): painted over, never compared. */
  mask?: (page: Page) => Locator[];
}

const deviceKey = (page: Page) => page.getByText(/pk_[0-9a-f]/);

/** The visible navigation entry, on the mobile tab bar or the desktop pill. */
export const nav = (page: Page, label: string | RegExp) => page.locator('.g-tab:visible, .g-navpill__btn:visible').filter({ hasText: label }).first();

/** Mobile: the centre tab opens the sheet. Desktop: the header "Set an intent" button does. */
export async function openSetIntent(page: Page) {
  const tab = page.locator('.g-tab:visible').nth(2);
  if (await tab.count()) await tab.click();
  else await page.getByRole('button', { name: /^Set an intent/ }).first().click();
  await ready(page, page.getByRole('button', { name: /^Right now/ }));
}

async function step2(page: Page) {
  await openSetIntent(page);
  await page.getByRole('button', { name: /^Right now/ }).click();
  await page.getByRole('button', { name: '2 hrs' }).click();
  await page.locator('.ss-go').click();
  await ready(page, page.getByRole('button', { name: /^Coffee & conversation/ }));
}

async function step3(page: Page) {
  await step2(page);
  await page.getByRole('button', { name: /^Coffee & conversation/ }).click();
  await page.locator('.ss-go').click();
  await ready(page, page.getByRole('button', { name: 'Meeting new people' }));
}

const profile = async (page: Page) => { await nav(page, 'Profile').click(); await ready(page, page.getByText('The short version')); };

/**
 * Scope: only screens the Phase 1 P0 fixes touch. Deliberately NOT covered (they need further mock layers; see
 * docs/PHASE1_MANUAL_TEST.md): Intent Hub (needs an active intent), a chat room (photo-send notice), Later, Discover
 * (desktop-only), the people sheet (needs live people), the two call modals, and the first-run screens
 * (sign-in, consent, onboarding), which the fake signed-in user bypasses.
 */
export const SCREENS: Screen[] = [
  { name: 'right-now-map', setup: async (page) => { await ready(page, page.locator('.g-map-state')); } },
  { name: 'messages-chats', setup: async (page) => { await nav(page, 'Messages').click(); await ready(page, page.getByRole('tab', { name: /^Chats/ })); } },
  { name: 'messages-notifications', setup: async (page) => { await nav(page, 'Messages').click(); await page.getByRole('tab', { name: /^Notifications/ }).click(); await ready(page, page.getByRole('heading', { name: 'Notifications' })); } },
  { name: 'profile', setup: profile, mask: (page) => [deviceKey(page)] },
  { name: 'set-intent-1-availability', setup: openSetIntent },
  { name: 'set-intent-2-activity', setup: step2 },
  { name: 'set-intent-3-connection', setup: step3 },
  { name: 'dialog-privacy', setup: async (page) => { await profile(page); await page.getByRole('button', { name: /Privacy & visibility/ }).click(); await ready(page, page.getByRole('heading', { name: 'Who sees what' })); } },
  { name: 'dialog-edit-profile', setup: async (page) => { await profile(page); await page.getByRole('button', { name: 'Edit profile' }).first().click(); await ready(page, page.getByRole('heading', { name: 'Edit profile' })); } },
  { name: 'dialog-identity', setup: async (page) => { await profile(page); await page.getByRole('button', { name: /Identity & devices/ }).click(); await ready(page, page.getByRole('heading', { name: /Identity & Privacy Controls/ })); }, mask: (page) => [deviceKey(page)] },
  { name: 'dialog-safety-timer', setup: async (page) => { await profile(page); await page.locator('.g-row', { hasText: 'Safety check-in' }).click(); await ready(page, page.getByRole('heading', { name: /Safety Check-in Timer/ })); } },
  { name: 'dialog-swarm-qr', setup: async (page) => { await profile(page); await page.getByRole('button', { name: /QR verification/ }).click(); await ready(page, page.getByRole('heading', { name: /In-Person Safety Verification/ })); }, mask: (page) => [deviceKey(page), page.locator('img')] },
];
