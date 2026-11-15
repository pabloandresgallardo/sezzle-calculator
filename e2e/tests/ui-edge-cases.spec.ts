import { expect, test } from '@playwright/test';
import { displayValue, expectValue, press } from './helpers';

test.beforeEach(async ({ page }) => {
  await page.goto('/');
});

test('1 / 3 = 0.3333333333', async ({ page }) => {
  await press(page, '1', 'divide', '3', 'equals');
  await expectValue(page, '0.3333333333');
});

test('typing 16 digits keeps only 15', async ({ page }) => {
  await page.keyboard.type('1234567890123456');
  await expectValue(page, '123456789012345');
});

test('123456789 / 7 = long result, then add shows Result too long to continue', async ({ page }) => {
  await press(page, '1', '2', '3', '4', '5', '6', '7', '8', '9', 'divide', '7', 'equals');
  await expectValue(page, '17636684.1428571429');
  await press(page, 'add');
  await expect(page.getByRole('status')).toContainText('Result too long to continue');
});

test.describe('mobile layout', () => {
  test.beforeEach(({}, testInfo) => {
    test.skip(testInfo.project.name !== 'mobile', 'mobile project only');
  });

  for (const viewport of [null, { width: 360, height: 740 }]) {
    const name = viewport ? `${viewport.width}px viewport` : 'default Pixel 7 viewport';
    test(`no horizontal overflow and 19 visible buttons (${name})`, async ({ page }) => {
      if (viewport) await page.setViewportSize(viewport);
      await page.goto('/');
      const buttons = page.getByRole('button');
      await expect(buttons).toHaveCount(19);
      const innerWidth = await page.evaluate(() => window.innerWidth);
      for (const button of await buttons.all()) {
        await expect(button).toBeVisible();
        const box = await button.boundingBox();
        expect(box).not.toBeNull();
        expect(box!.x).toBeGreaterThanOrEqual(0);
        expect(box!.x + box!.width).toBeLessThanOrEqual(innerWidth);
      }
      const fits = await page.evaluate(
        () =>
          document.documentElement.scrollWidth <= window.innerWidth &&
          document.body.scrollWidth <= window.innerWidth,
      );
      expect(fits).toBe(true);
    });
  }
});
