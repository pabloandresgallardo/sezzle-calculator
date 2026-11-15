import { expect, test } from '@playwright/test';
import { displayValue, expectValue, openApp, pasteText, press } from './helpers';

test.beforeEach(async ({ page }) => {
  await openApp(page);
});

test('6 / 0 = shows Cannot divide by zero, then recovers with 3 = 2', async ({ page }) => {
  await press(page, '6', 'divide', '0', 'equals');
  await expect(page.getByRole('status')).toContainText('Cannot divide by zero');
  await press(page, '3', 'equals');
  await expectValue(page, '2');
  await expect(page.getByRole('status')).not.toContainText('Cannot divide by zero');
});

test('pasting non-numeric text shows Invalid number', async ({ page }) => {
  await pasteText(page, 'abc');
  await expect(page.getByRole('status')).toContainText('Invalid number');
  await expect(displayValue(page)).toHaveText('0');
});

test('4 +/- √ shows Invalid input', async ({ page }) => {
  await press(page, '4', 'plus/minus', 'square root');
  await expect(page.getByRole('status')).toContainText('Invalid input');
});

test('10 xʸ 100 = shows Result too large, then C resets to 0', async ({ page }) => {
  await press(page, '1', '0', 'power', '1', '0', '0', 'equals');
  await expect(page.getByRole('status')).toContainText('Result too large');
  await press(page, 'clear');
  await expectValue(page, '0');
});
