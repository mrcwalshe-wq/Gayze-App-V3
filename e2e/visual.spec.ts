import { test, expect } from '@playwright/test';
import { openApp } from './support/harness';
import { SCREENS } from './support/screens';

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
