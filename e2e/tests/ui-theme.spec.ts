import { expect, test, type Page } from '@playwright/test';
import { displayExpression, expectValue } from './helpers';

const STORAGE_KEY = 'sezzle-calculator-theme';
const html = (page: Page) => page.locator('html');
const toLight = (page: Page) =>
  page.getByRole('button', { name: 'Switch to light mode', exact: true });
const toDark = (page: Page) =>
  page.getByRole('button', { name: 'Switch to dark mode', exact: true });

async function bodyBackground(page: Page): Promise<string> {
  return page.evaluate(() => getComputedStyle(document.body).backgroundColor);
}

async function storedTheme(page: Page): Promise<string | null> {
  return page.evaluate((key) => localStorage.getItem(key), STORAGE_KEY);
}

test.beforeEach(async ({ page }) => {
  await page.goto('/');
});

test('opens in dark mode with no stored preference', async ({ page }) => {
  await expect(html(page)).toHaveAttribute('data-theme', 'dark');
  await expect(toLight(page)).toBeVisible();
  await expect(toLight(page)).toHaveText('☀');
  expect(await bodyBackground(page)).toBe('rgb(15, 18, 24)');
  expect(await storedTheme(page)).toBeNull();
});

test('ignores a light operating-system preference', async ({ page }) => {
  await page.emulateMedia({ colorScheme: 'light' });
  await page.reload();
  await expect(html(page)).toHaveAttribute('data-theme', 'dark');
});

test('click switches to light, persists it and survives a reload', async ({ page }) => {
  await toLight(page).click();
  await expect(html(page)).toHaveAttribute('data-theme', 'light');
  await expect(toDark(page)).toHaveText('☾');
  expect(await bodyBackground(page)).toBe('rgb(241, 243, 246)');
  expect(await storedTheme(page)).toBe('light');

  await page.reload();
  await expect(html(page)).toHaveAttribute('data-theme', 'light');
  await expect(toDark(page)).toBeVisible();

  await toDark(page).click();
  await expect(html(page)).toHaveAttribute('data-theme', 'dark');
  expect(await storedTheme(page)).toBe('dark');
});

test('the inline script applies the stored theme before the bundle runs (no flash)', async ({
  page,
}) => {
  await toLight(page).click();
  // With every module script blocked, only the inline script in index.html can set the theme.
  await page.route('**/*.js', (route) => route.abort());
  await page.reload();
  await expect(html(page)).toHaveAttribute('data-theme', 'light');
  await expect(page.getByRole('region', { name: 'Calculator' })).toHaveCount(0);
});

test('an invalid stored value falls back to dark', async ({ page }) => {
  await page.evaluate((key) => localStorage.setItem(key, 'sepia'), STORAGE_KEY);
  await page.reload();
  await expect(html(page)).toHaveAttribute('data-theme', 'dark');
});

test('Enter on the focused toggle switches theme and does not press =', async ({ page }) => {
  await page.keyboard.type('2+3');
  await expectValue(page, '3');
  await toLight(page).focus();
  await page.keyboard.press('Enter');
  await expect(html(page)).toHaveAttribute('data-theme', 'light');
  await expectValue(page, '3');
  await expect(displayExpression(page)).toHaveText('2 +');

  await toDark(page).focus();
  await page.keyboard.press(' ');
  await expect(html(page)).toHaveAttribute('data-theme', 'dark');
  await expectValue(page, '3');
});

for (const theme of ['dark', 'light'] as const) {
  test(`keypad colour groups hold in ${theme} mode`, async ({ page }) => {
    if (theme === 'light') await toLight(page).click();
    await expect(html(page)).toHaveAttribute('data-theme', theme);
    // Keys animate background-color (120 ms): sample the settled colours, not mid-transition.
    await page.evaluate(() => Promise.all(document.getAnimations().map((a) => a.finished)));
    const groups = {
      operator: ['divide', 'multiply', 'subtract', 'add', 'power', 'percent', 'square root'],
      action: ['clear', 'backspace', 'plus/minus'],
      digit: ['0', '1', '2', '3', '4', '5', '6', '7', '8', '9', 'decimal point'],
      equals: ['equals'],
    };
    const colours: string[] = [];
    for (const labels of Object.values(groups)) {
      const backgrounds = new Set<string>();
      for (const label of labels) {
        const button = page.getByRole('button', { name: label, exact: true });
        backgrounds.add(await button.evaluate((el) => getComputedStyle(el).backgroundColor));
      }
      expect(backgrounds.size, `one background for ${labels.join(', ')}`).toBe(1);
      colours.push(...backgrounds);
    }
    expect(new Set(colours).size).toBe(4);
  });
}

test('at 360 px the toggle is inside the viewport, clear of the calculator, no horizontal scroll', async ({
  page,
}) => {
  await page.setViewportSize({ width: 360, height: 740 });
  await page.reload();
  const box = await toLight(page).boundingBox();
  const panel = await page.getByRole('region', { name: 'Calculator' }).boundingBox();
  expect(box).not.toBeNull();
  expect(panel).not.toBeNull();
  expect(box!.x).toBeGreaterThanOrEqual(0);
  expect(box!.y).toBeGreaterThanOrEqual(0);
  expect(box!.x + box!.width).toBeLessThanOrEqual(360);
  expect(box!.y + box!.height).toBeLessThanOrEqual(panel!.y);
  // Top right: its right edge lines up with the page gutter, not the left side.
  expect(box!.x).toBeGreaterThan(360 / 2);

  await toLight(page).click();
  await expect(html(page)).toHaveAttribute('data-theme', 'light');
  const fits = await page.evaluate(
    () =>
      document.documentElement.scrollWidth <= window.innerWidth &&
      document.body.scrollWidth <= window.innerWidth,
  );
  expect(fits).toBe(true);
});
