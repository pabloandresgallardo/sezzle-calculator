import { expect, test } from '@playwright/test';
import { displayValue, expectValue, pasteText, press } from './helpers';

test.beforeEach(async ({ page }) => {
  await page.goto('/');
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
