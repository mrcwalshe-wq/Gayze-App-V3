import type { Page } from '@playwright/test';

export interface Screen {
  name: string;
  /** Only meaningful on desktop widths (navigation differs: the mobile tab bar has no entry for it). */
  desktopOnly?: boolean;
  setup: (page: Page) => Promise<void>;
}

const settle = (page: Page, ms = 900) => page.waitForTimeout(ms);
/** The visible navigation entry, on the mobile tab bar or the desktop pill. */
export const nav = (page: Page, label: string | RegExp) => page.locator('.g-tab:visible, .g-navpill__btn:visible').filter({ hasText: label }).first();

/** Mobile: the centre tab opens the sheet. Desktop: the header "Set intent" button does. */
export async function openSetIntent(page: Page) {
  const tab = page.locator('.g-tab:visible').nth(2);
  if (await tab.count()) await tab.click();
  else await page.getByRole('button', { name: /^Set an intent/ }).first().click();
  await page.locator('.ss-go').waitFor({ timeout: 10_000 });
  await settle(page, 600);
}

export const SCREENS: Screen[] = [
  { name: 'right-now-map', setup: async () => undefined },
  { name: 'later', setup: async (page) => { await nav(page, 'Events').click(); await settle(page, 1200); } },
  { name: 'messages-chats', setup: async (page) => { await nav(page, 'Messages').click(); await settle(page, 1200); } },
  { name: 'profile', setup: async (page) => { await nav(page, 'Profile').click(); await settle(page, 1500); } },
  { name: 'discover-interests', desktopOnly: true, setup: async (page) => { await nav(page, /^GAYZE$/).click(); await settle(page, 1500); } },
  {
    name: 'set-intent-1-availability',
    setup: async (page) => { await openSetIntent(page); },
  },
  {
    name: 'set-intent-2-activity',
    setup: async (page) => {
      await openSetIntent(page);
      await page.getByRole('button', { name: /^Right now/ }).click(); await page.getByRole('button', { name: '2 hrs' }).click();
      await page.locator('.ss-go').click(); await settle(page, 1500);
    },
  },
  {
    name: 'set-intent-3-connection',
    setup: async (page) => {
      await openSetIntent(page);
      await page.getByRole('button', { name: /^Right now/ }).click(); await page.getByRole('button', { name: '2 hrs' }).click();
      await page.locator('.ss-go').click(); await settle(page, 500);
      await page.getByRole('button', { name: /^Coffee/ }).last().click(); await page.locator('.ss-go').click(); await settle(page, 1500);
    },
  },
  { name: 'dialog-privacy', setup: async (page) => { await nav(page, 'Profile').click(); await settle(page, 1200); await page.getByRole('button', { name: /Privacy & visibility/ }).click(); await settle(page, 900); } },
  { name: 'dialog-edit-profile', setup: async (page) => { await nav(page, 'Profile').click(); await settle(page, 1200); await page.getByRole('button', { name: 'Edit profile' }).first().click(); await settle(page, 900); } },
  { name: 'dialog-identity', setup: async (page) => { await nav(page, 'Profile').click(); await settle(page, 1200); await page.getByRole('button', { name: /Identity & devices/ }).click(); await settle(page, 900); } },
  { name: 'dialog-safety-timer', setup: async (page) => { await nav(page, 'Profile').click(); await settle(page, 1200); await page.getByRole('button', { name: 'Safety check-in' }).click(); await settle(page, 900); } },
];
