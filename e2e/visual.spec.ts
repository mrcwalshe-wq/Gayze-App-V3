import { test, expect } from '@playwright/test';
import { openApp } from './support/harness';
import { SCREENS } from './support/screens';

for (const screen of SCREENS) {
  test(`screen: ${screen.name}`, async ({ page }, info) => {
    test.skip(Boolean(screen.desktopOnly) && !info.project.name.startsWith('desktop'), 'No mobile entry point for this screen (report F9)');
    await openApp(page);
    await screen.setup(page);
    // Behind the blurred Set Intent sheet the emblem's glow keeps moving (it is not a CSS animation, so it cannot be frozen).
    // Navigation chrome is covered unmasked by the 'navigation' test below.
    const behindSheet = screen.name.startsWith('set-intent');
    await expect(page).toHaveScreenshot(`${screen.name}.png`, behindSheet ? { mask: [page.locator('.g-tabbar, header')] } : {});
  });
}

test('tab bar / navigation chrome', async ({ page }) => {
  await openApp(page);
  await expect(page.locator('.g-tabbar:visible, header:visible').first()).toHaveScreenshot('navigation.png');
});
