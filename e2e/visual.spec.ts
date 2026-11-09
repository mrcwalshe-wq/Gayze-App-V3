import { test, expect } from '@playwright/test';
import { openApp } from './support/harness';
import { SCREENS } from './support/screens';

// Baselines are only valid when rendered by the pinned Playwright image (scripts/e2e-docker.sh).
// Set E2E_ALLOW_HOST=1 to debug locally, but never commit images made that way.
if (!process.env.E2E_IN_DOCKER && !process.env.E2E_ALLOW_HOST) {
  throw new Error('Visual tests must run in the pinned Docker image: npm run test:visual (or set E2E_ALLOW_HOST=1 to debug locally).');
}

for (const screen of SCREENS) {
  test(`screen: ${screen.name}`, async ({ page }, info) => {
    test.skip(Boolean(screen.desktopOnly) && !info.project.name.startsWith('desktop'), 'No mobile entry point for this screen (report F9)');
    await openApp(page);
    await screen.setup(page);
    await expect(page).toHaveScreenshot(`${screen.name}.png`);
  });
}

test('tab bar / navigation chrome', async ({ page }) => {
  await openApp(page);
  await expect(page.locator('.g-tabbar:visible, header:visible').first()).toHaveScreenshot('navigation.png');
});
