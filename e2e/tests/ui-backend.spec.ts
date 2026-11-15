import { expect, test, type Page, type Request } from '@playwright/test';
import { expectValue, press, settle } from './helpers';

type Backend = 'java' | 'go';

const LABELS: Record<Backend, string> = { java: 'Java', go: 'Go' };
const calculatePath = (backend: Backend) => `/api/${backend}/v1/calculate`;
const healthPath = (backend: Backend) => `/api/${backend}/health`;
const pathOf = (request: Request) => new URL(request.url()).pathname;

const selector = (page: Page) => page.getByRole('radiogroup', { name: 'Backend', exact: true });
const radio = (page: Page, backend: Backend) =>
  selector(page).getByRole('radio', { name: LABELS[backend], exact: true });

function isCalculation(request: Request, backend?: Backend): boolean {
  const path = pathOf(request);
  return (
    request.method() === 'POST' &&
    (backend === undefined
      ? /^\/api\/(java|go)\/v1\/calculate$/.test(path)
      : path === calculatePath(backend))
  );
}

/** Every calculation path the page requests, in order. */
function recordCalculations(page: Page): string[] {
  const paths: string[] = [];
  page.on('request', (request) => {
    if (isCalculation(request)) paths.push(pathOf(request));
  });
  return paths;
}

/** Answers the backend's health with 503 while `down()` is true; otherwise lets nginx answer. */
async function healthDownWhile(page: Page, backend: Backend, down: () => boolean): Promise<void> {
  await page.route(`**${healthPath(backend)}`, (route) =>
    down() ? route.fulfill({ status: 503, body: '' }) : route.continue(),
  );
}

/**
 * Opens the app and waits until both start-up health checks have finished and the resulting state
 * has rendered. Needed when the outcome (a hidden selector, the active backend) looks the same
 * before and after the checks answer.
 */
async function openAfterHealthChecks(page: Page): Promise<void> {
  const finished = (backend: Backend) =>
    page.waitForEvent('requestfinished', (request) => pathOf(request) === healthPath(backend));
  const both = Promise.all([finished('java'), finished('go')]);
  await page.goto('/');
  await both;
  await settle(page);
}

/** Runs `2 xʸ 10 =` and checks it went to `backend` and showed 1024. */
async function expectPowerOn(page: Page, backend: Backend): Promise<void> {
  const request = page.waitForRequest((r) => isCalculation(r, backend));
  await press(page, '2', 'power', '1', '0', 'equals');
  await request;
  await expectValue(page, '1024');
}

async function expectChecked(page: Page, backend: Backend): Promise<void> {
  const other: Backend = backend === 'java' ? 'go' : 'java';
  await expect(radio(page, backend)).toHaveAttribute('aria-checked', 'true');
  await expect(radio(page, other)).toHaveAttribute('aria-checked', 'false');
}

test.describe('both backends healthy', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await expect(selector(page)).toBeVisible();
  });

  test('Java is selected by default', async ({ page }) => {
    await expect(radio(page, 'java')).toBeVisible();
    await expect(radio(page, 'go')).toBeVisible();
    await expectChecked(page, 'java');
  });

  test('calculations go to /api/java by default', async ({ page }) => {
    const calculations = recordCalculations(page);
    await expectPowerOn(page, 'java');
    expect(calculations).toEqual([calculatePath('java')]);
  });

  test('switching to Go routes to /api/go without reload, and back to Java', async ({ page }) => {
    const calculations = recordCalculations(page);
    let loads = 0;
    page.on('load', () => {
      loads += 1;
    });
    await page.evaluate(() => {
      (window as unknown as { __sameDocument: boolean }).__sameDocument = true;
    });

    await radio(page, 'go').click();
    await expectChecked(page, 'go');
    await expectPowerOn(page, 'go');

    await press(page, 'clear');
    await radio(page, 'java').click();
    await expectChecked(page, 'java');
    await expectPowerOn(page, 'java');

    expect(calculations).toEqual([calculatePath('go'), calculatePath('java')]);
    expect(loads).toBe(0);
    expect(
      await page.evaluate(() => (window as unknown as { __sameDocument?: boolean }).__sameDocument),
    ).toBe(true);
  });

  test('both backends compute 2 xʸ 10 = 1024 and show Cannot divide by zero for 6 ÷ 0', async ({
    page,
  }) => {
    for (const backend of ['java', 'go'] as const) {
      await press(page, 'clear');
      await radio(page, backend).click();
      await expectChecked(page, backend);
      await expectPowerOn(page, backend);

      await press(page, 'clear');
      const division = page.waitForResponse((r) => isCalculation(r.request(), backend));
      await press(page, '6', 'divide', '0', 'equals');
      expect((await division).status()).toBe(400);
      await expect(page.getByRole('status')).toContainText('Cannot divide by zero');
    }
  });

  test('java calculation aborts → retried on Go without visible error', async ({ page }) => {
    const calculations = recordCalculations(page);
    await page.route(`**${calculatePath('java')}`, (route) => route.abort());
    const javaFailed = page.waitForEvent('requestfailed', (r) => isCalculation(r, 'java'));

    await expectPowerOn(page, 'go');
    await javaFailed;

    expect(calculations).toEqual([calculatePath('java'), calculatePath('go')]);
    const status = page.getByRole('status');
    await expect(status).not.toContainText('Service unavailable');
    // Java is now known to be down: the choice disappears until it recovers.
    await expect(selector(page)).toHaveCount(0);
  });
});

test('go health down → no selector and Java is used', async ({ page }) => {
  await healthDownWhile(page, 'go', () => true);
  await openAfterHealthChecks(page);

  await expect(selector(page)).toHaveCount(0);
  await expect(page.getByRole('button', { name: /^Switch to (light|dark) mode$/ })).toBeVisible();
  const calculations = recordCalculations(page);
  await expectPowerOn(page, 'java');
  expect(calculations).toEqual([calculatePath('java')]);
});

test('java health down → no selector and Go is used silently', async ({ page }) => {
  await healthDownWhile(page, 'java', () => true);
  await openAfterHealthChecks(page);

  await expect(selector(page)).toHaveCount(0);
  const calculations = recordCalculations(page);
  await expectPowerOn(page, 'go');
  expect(calculations).toEqual([calculatePath('go')]);
  await expect(page.getByRole('status')).not.toContainText('Service unavailable');
});

test('selector reappears after recovery', async ({ page }) => {
  await page.clock.install();
  let javaDown = true;
  await healthDownWhile(page, 'java', () => javaDown);
  await openAfterHealthChecks(page);
  await expect(selector(page)).toHaveCount(0);

  javaDown = false;
  const rechecked = page.waitForEvent(
    'requestfinished',
    (request) => pathOf(request) === healthPath('java'),
  );
  await page.clock.runFor(10_000);
  await rechecked;

  await expect(selector(page)).toBeVisible();
  // Go had been chosen automatically, so recovery silently returns to Java.
  await expectChecked(page, 'java');
  await expectPowerOn(page, 'java');
});
