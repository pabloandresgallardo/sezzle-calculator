import { test } from '@playwright/test';
import { expectValue, press } from './helpers';

test.beforeEach(async ({ page }) => {
  await page.goto('/');
});

test('7 + 5 = 12', async ({ page }) => {
  await press(page, '7', 'add', '5', 'equals');
  await expectValue(page, '12');
});

test('9 - 12 = -3', async ({ page }) => {
  await press(page, '9', 'subtract', '1', '2', 'equals');
  await expectValue(page, '-3');
});

test('2.5 x 4 = 10', async ({ page }) => {
  await press(page, '2', 'decimal point', '5', 'multiply', '4', 'equals');
  await expectValue(page, '10');
});

test('6 / 3 = 2', async ({ page }) => {
  await press(page, '6', 'divide', '3', 'equals');
  await expectValue(page, '2');
});

test('0.1 + 0.2 = 0.3', async ({ page }) => {
  await press(page, '0', 'decimal point', '1', 'add', '0', 'decimal point', '2', 'equals');
  await expectValue(page, '0.3');
});

test('2 + 3 x 4 = 20 (immediate execution)', async ({ page }) => {
  await press(page, '2', 'add', '3', 'multiply', '4', 'equals');
  await expectValue(page, '20');
});

test('plus/minus via button: 5 +/- x 2 = -10', async ({ page }) => {
  await press(page, '5', 'plus/minus', 'multiply', '2', 'equals');
  await expectValue(page, '-10');
});

test('plus/minus via F9: 5 F9 x 2 = -10', async ({ page }) => {
  await press(page, '5');
  await page.keyboard.press('F9');
  await press(page, 'multiply', '2', 'equals');
  await expectValue(page, '-10');
});

test('physical keyboard: 8*7 Enter = 56', async ({ page }) => {
  await page.keyboard.type('8*7');
  await page.keyboard.press('Enter');
  await expectValue(page, '56');
});

test('2 xʸ 10 = 1024', async ({ page }) => {
  await press(page, '2', 'power', '1', '0', 'equals');
  await expectValue(page, '1024');
});

test('9 √ = 3 (immediate)', async ({ page }) => {
  await press(page, '9', 'square root');
  await expectValue(page, '3');
});

test('2 + 9 √ = 5', async ({ page }) => {
  await press(page, '2', 'add', '9', 'square root', 'equals');
  await expectValue(page, '5');
});

test('20 % 150 = 30', async ({ page }) => {
  await press(page, '2', '0', 'percent', '1', '5', '0', 'equals');
  await expectValue(page, '30');
});

test('keyboard: 2^8 Enter = 256', async ({ page }) => {
  await page.keyboard.type('2^8');
  await page.keyboard.press('Enter');
  await expectValue(page, '256');
});

test('keyboard: 16@ = 4', async ({ page }) => {
  await page.keyboard.type('16@');
  await expectValue(page, '4');
});

test('2 √ = 1.4142135624', async ({ page }) => {
  await press(page, '2', 'square root');
  await expectValue(page, '1.4142135624');
});
