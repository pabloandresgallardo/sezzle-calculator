import { expect, type Locator, type Page } from '@playwright/test';

/** Click calculator buttons by aria-label, in order. */
export async function press(page: Page, ...labels: string[]): Promise<void> {
  for (const label of labels) {
    await page.getByRole('button', { name: label, exact: true }).click();
  }
}

/** Main (large) value line inside the role="status" panel. */
export function displayValue(page: Page): Locator {
  return page.getByRole('status').locator('[data-size="large"]');
}

/** Expression (small) line inside the role="status" panel. */
export function displayExpression(page: Page): Locator {
  return page.getByRole('status').locator('[data-size="small"]');
}

export async function expectValue(page: Page, text: string): Promise<void> {
  await expect(displayValue(page)).toHaveText(text);
}

/** Dispatch a synthetic paste event on window carrying the given text. */
export async function pasteText(page: Page, text: string): Promise<void> {
  await page.evaluate((value) => {
    const data = new DataTransfer();
    data.setData('text/plain', value);
    const event = new ClipboardEvent('paste', {
      clipboardData: data,
      bubbles: true,
      cancelable: true,
    });
    window.dispatchEvent(event);
  }, text);
}

