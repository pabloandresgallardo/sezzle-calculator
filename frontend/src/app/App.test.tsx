import { act, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { Backend } from '../shared/backend/backend';
import { THEME_STORAGE_KEY } from '../shared/theme/theme';
import { server } from '../test/msw/server';
import { App } from './App';

const root = document.documentElement;

/** Health answered by the fake `/api/{backend}/health` endpoints. */
let healthy: Record<Backend, boolean>;
let healthChecks: Backend[];

beforeEach(() => {
  healthy = { java: true, go: true };
  healthChecks = [];
  server.use(
    http.get('/api/:backend/health', ({ params }) => {
      const backend = params.backend as Backend;
      healthChecks.push(backend);
      return healthy[backend]
        ? HttpResponse.json({ groups: ['liveness', 'readiness'], status: 'UP' })
        : HttpResponse.json({ status: 'DOWN' }, { status: 503 });
    }),
  );
});

afterEach(() => {
  localStorage.clear();
  delete root.dataset.theme;
});

function calculator(): HTMLElement {
  return screen.getByRole('region', { name: 'Calculator' });
}

function mainLine(): HTMLElement | null {
  return screen.getByRole('status').querySelector('[data-size="large"]');
}

/** Both mount-time health checks have been answered and applied. */
async function healthChecked() {
  await waitFor(() => {
    expect(healthChecks).toHaveLength(2);
  });
  // One more turn for React to apply the results.
  await act(() => Promise.resolve());
}

describe('App', () => {
  it('shows selector and theme toggle top-right', async () => {
    render(<App />);
    const selector = await screen.findByRole('radiogroup', { name: 'Backend' });
    const toggle = screen.getByRole('button', { name: 'Switch to light mode' });
    const header = screen.getByRole('banner');
    expect(header).toHaveClass('header');
    expect(header).toContainElement(selector);
    expect(header).toContainElement(toggle);
    expect(calculator()).not.toContainElement(selector);
    // Selector first, then the toggle: `[Backend: Java | Go] [☀]`.
    expect(
      selector.compareDocumentPosition(toggle) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    expect(screen.getByRole('radio', { name: 'Java' })).toBeChecked();
  });

  it.each(['go', 'java'] as const)(
    'hides the selector when one backend is down (%s)',
    async (down) => {
      healthy[down] = false;
      render(<App />);
      await healthChecked();
      expect(screen.queryByRole('radiogroup', { name: 'Backend' })).not.toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'Switch to light mode' })).toBeInTheDocument();
    },
  );

  it('calculates on go when java is down', async () => {
    healthy.java = false;
    const served: string[] = [];
    server.use(
      http.post('/api/:backend/v1/calculate', ({ params }) => {
        served.push(String(params.backend));
        return HttpResponse.json({ operation: 'add', result: '5' });
      }),
    );
    const user = userEvent.setup();
    render(<App />);
    await healthChecked();
    await user.keyboard('2+3=');
    await waitFor(() => {
      expect(mainLine()).toHaveTextContent(/^5$/);
    });
    expect(served).toEqual(['go']);
  });

  it('retries on go when java fails after a late health result already switched to go', async () => {
    let finishJavaHealth: () => void = () => undefined;
    let failJava: () => void = () => undefined;
    const served: string[] = [];
    server.use(
      http.get(
        '/api/java/health',
        () =>
          new Promise<Response>((resolve) => {
            healthChecks.push('java');
            finishJavaHealth = () => {
              resolve(HttpResponse.json({ status: 'DOWN' }, { status: 503 }));
            };
          }),
      ),
      http.post(
        '/api/java/v1/calculate',
        () =>
          new Promise<Response>((resolve) => {
            served.push('java');
            failJava = () => {
              resolve(new HttpResponse('Bad Gateway', { status: 502 }));
            };
          }),
      ),
      http.post('/api/go/v1/calculate', () => {
        served.push('go');
        return HttpResponse.json({ operation: 'add', result: '5' });
      }),
    );
    const user = userEvent.setup();
    render(<App />);
    await user.keyboard('2+3=');
    await waitFor(() => {
      expect(served).toEqual(['java']);
    });
    await act(async () => {
      finishJavaHealth();
      await Promise.resolve();
    });
    failJava();
    await waitFor(() => {
      expect(mainLine()).toHaveTextContent(/^5$/);
    });
    expect(screen.queryByText('Service unavailable')).not.toBeInTheDocument();
    expect(served).toEqual(['java', 'go']);
  });

  it('Enter on a focused backend option does not press =', async () => {
    const requests: unknown[] = [];
    server.use(
      http.post('/api/:backend/v1/calculate', async ({ request }) => {
        requests.push(await request.json());
        return HttpResponse.json({ operation: 'add', result: '5' });
      }),
    );
    const user = userEvent.setup();
    render(<App />);
    const java = await screen.findByRole('radio', { name: 'Java' });
    await user.keyboard('2+3');
    java.focus();
    await user.keyboard('{Enter}');
    expect(mainLine()).toHaveTextContent(/^3$/);
    expect(requests).toEqual([]);
  });

  it('renders calculator', () => {
    render(<App />);
    expect(calculator()).toBeInTheDocument();
    expect(screen.getByRole('status')).toHaveTextContent('0');
    expect(within(calculator()).getAllByRole('button')).toHaveLength(22);
  });

  it('starts in dark mode without stored preference, toggle outside the calculator', () => {
    render(<App />);
    expect(localStorage.getItem(THEME_STORAGE_KEY)).toBeNull();
    expect(root.dataset.theme).toBe('dark');
    const toggle = screen.getByRole('button', { name: 'Switch to light mode' });
    expect(calculator()).not.toContainElement(toggle);
  });

  it('Enter on the focused theme toggle switches theme and does not press =', async () => {
    const requests: unknown[] = [];
    server.use(
      http.post('/api/java/v1/calculate', async ({ request }) => {
        requests.push(await request.json());
        return HttpResponse.json({ operation: 'add', result: '5' });
      }),
    );
    const user = userEvent.setup();
    render(<App />);
    await user.keyboard('2+3');
    expect(mainLine()).toHaveTextContent(/^3$/);

    screen.getByRole('button', { name: 'Switch to light mode' }).focus();
    await user.keyboard('{Enter}');

    expect(root.dataset.theme).toBe('light');
    expect(mainLine()).toHaveTextContent(/^3$/);
    expect(requests).toEqual([]);

    // Other keys still reach the calculator while the toggle has focus.
    await user.keyboard('4');
    expect(mainLine()).toHaveTextContent(/^34$/);
  });
});
