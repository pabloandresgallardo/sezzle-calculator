import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { useState } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Backend } from '../../../shared/backend/backend';
import { BackendSelector } from '../../../shared/backend/BackendSelector';
import { server } from '../../../test/msw/server';
import type { Operation } from '../model/types';
import { CalculatorPanel } from './CalculatorPanel';

const URL_PATH = '/api/java/v1/calculate';

const noFailover = (): Promise<Backend | null> => Promise.resolve(null);

interface CalculateBody {
  operation: Operation;
  operands: number[];
}

let requests: CalculateBody[];
/** Backend that served each entry of `requests`. */
let backends: Backend[];

function problem(title: string) {
  return HttpResponse.json({ title, status: 400 }, { status: 400 });
}

/** Fake backend: plain JS arithmetic is exact for the small values used here. */
function fakeCalculate({ operation, operands }: CalculateBody) {
  const [a = NaN, b = NaN] = operands;
  if ((operation === 'divide' && b === 0) || (operation === 'power' && a === 0 && b < 0)) {
    return problem('Division by zero');
  }
  if (operation === 'sqrt' && a < 0) {
    return problem('Invalid operand');
  }
  const results: Record<Operation, number> = {
    add: a + b,
    subtract: a - b,
    multiply: a * b,
    divide: a / b,
    power: a ** b,
    sqrt: Math.sqrt(a),
    percentage: (a * b) / 100,
  };
  const result = results[operation];
  // The real backend rejects results with more than 100 integer digits.
  if (Math.abs(result) >= 1e100) {
    return problem('Result out of range');
  }
  return HttpResponse.json({ operation, result: String(result) });
}

function calculatorHandler(backend: Backend) {
  return http.post(`/api/${backend}/v1/calculate`, async ({ request }) => {
    const body = (await request.json()) as CalculateBody;
    requests.push(body);
    backends.push(backend);
    return fakeCalculate(body);
  });
}

/** What `App` wires together: the selector and the panel sharing the active backend. */
function Harness({ failover = noFailover }: { failover?: () => Promise<Backend | null> }) {
  const [backend, setBackend] = useState<Backend>('java');
  const [busy, setBusy] = useState(false);
  return (
    <>
      <BackendSelector value={backend} onChange={setBackend} disabled={busy} />
      <CalculatorPanel backend={backend} failover={failover} onBusyChange={setBusy} />
    </>
  );
}

function status(): HTMLElement {
  return screen.getByRole('status');
}

function mainLine(): HTMLElement | null {
  return status().querySelector('[data-size="large"]');
}

function topLine(): HTMLElement | null {
  return status().querySelector('[data-size="small"]');
}

async function press(user: ReturnType<typeof userEvent.setup>, ...names: string[]) {
  for (const name of names) {
    await user.click(screen.getByRole('button', { name }));
  }
}

beforeEach(() => {
  requests = [];
  backends = [];
  server.use(calculatorHandler('java'), calculatorHandler('go'));
});

describe('CalculatorPanel backend routing', () => {
  it('computes on java by default', async () => {
    const user = userEvent.setup();
    render(<Harness />);
    await press(user, '6', 'divide', '3', 'equals');
    await waitFor(() => {
      expect(mainLine()).toHaveTextContent(/^2$/);
    });
    expect(backends).toEqual(['java']);
  });

  it('switching to go sends the next calculation to go without reload', async () => {
    const user = userEvent.setup();
    render(<Harness />);
    await press(user, '2', 'add', '3', 'equals');
    await waitFor(() => {
      expect(mainLine()).toHaveTextContent(/^5$/);
    });
    await user.click(screen.getByRole('radio', { name: 'Go' }));
    await press(user, 'multiply', '4', 'equals');
    await waitFor(() => {
      expect(mainLine()).toHaveTextContent(/^20$/);
    });
    await user.click(screen.getByRole('radio', { name: 'Java' }));
    await press(user, 'add', '1', 'equals');
    await waitFor(() => {
      expect(mainLine()).toHaveTextContent(/^21$/);
    });
    expect(backends).toEqual(['java', 'go', 'java']);
  });

  it('fails over to go and retries once on 502 from java', async () => {
    server.use(http.post(URL_PATH, () => new HttpResponse('Bad Gateway', { status: 502 })));
    const failover = vi.fn((): Promise<Backend | null> => Promise.resolve('go'));
    const user = userEvent.setup();
    render(<Harness failover={failover} />);
    await press(user, '6', 'divide', '3', 'equals');
    await waitFor(() => {
      expect(mainLine()).toHaveTextContent(/^2$/);
    });
    expect(screen.queryByText('Service unavailable')).not.toBeInTheDocument();
    expect(failover).toHaveBeenCalledTimes(1);
    expect(backends).toEqual(['go']);
    expect(requests).toEqual([{ operation: 'divide', operands: [6, 3] }]);
  });

  it('does not fail over on contract errors', async () => {
    const failover = vi.fn((): Promise<Backend | null> => Promise.resolve('go'));
    const user = userEvent.setup();
    render(<Harness failover={failover} />);
    await press(user, '5', 'divide', '0', 'equals');
    expect(await screen.findByText('Cannot divide by zero')).toBeInTheDocument();
    expect(failover).not.toHaveBeenCalled();
    expect(backends).toEqual(['java']);
  });

  it('retries at most once', async () => {
    let attempts = 0;
    server.use(
      http.post('/api/:backend/v1/calculate', () => {
        attempts += 1;
        return HttpResponse.error();
      }),
    );
    const failover = vi.fn((): Promise<Backend | null> => Promise.resolve('go'));
    const user = userEvent.setup();
    render(<Harness failover={failover} />);
    await press(user, '7', 'subtract', '9', 'equals');
    expect(await screen.findByText('Service unavailable')).toBeInTheDocument();
    expect(failover).toHaveBeenCalledTimes(1);
    expect(attempts).toBe(2);
  });

  it('selector is disabled while a calculation is pending', async () => {
    let release: () => void = () => undefined;
    server.use(
      http.post(
        URL_PATH,
        () =>
          new Promise<Response>((resolve) => {
            release = () => {
              resolve(HttpResponse.json({ operation: 'add', result: '3' }));
            };
          }),
        { once: true },
      ),
    );
    const user = userEvent.setup();
    render(<Harness />);
    expect(screen.getByRole('radio', { name: 'Go' })).toBeEnabled();
    await press(user, '1', 'add', '2', 'equals');
    await waitFor(() => {
      expect(screen.getByRole('radio', { name: 'Go' })).toBeDisabled();
    });
    expect(screen.getByRole('radio', { name: 'Java' })).toBeDisabled();
    release();
    await waitFor(() => {
      expect(mainLine()).toHaveTextContent(/^3$/);
    });
    // `onBusyChange` runs in a passive effect, one render after the result.
    await waitFor(() => {
      expect(screen.getByRole('radio', { name: 'Go' })).toBeEnabled();
    });
  });
});

describe('CalculatorPanel', () => {
  it('starts at 0', () => {
    render(<CalculatorPanel backend="java" failover={noFailover} />);
    expect(mainLine()).toHaveTextContent(/^0$/);
    expect(topLine()).toHaveTextContent(/^$/);
  });

  it('computes 6 ÷ 3 = 2', async () => {
    const user = userEvent.setup();
    render(<CalculatorPanel backend="java" failover={noFailover} />);
    await press(user, '6', 'divide');
    expect(topLine()).toHaveTextContent('6 ÷');
    await press(user, '3');
    expect(mainLine()).toHaveTextContent(/^3$/);
    await press(user, 'equals');
    await waitFor(() => {
      expect(mainLine()).toHaveTextContent(/^2$/);
    });
    expect(topLine()).toHaveTextContent(/^$/);
    expect(requests).toEqual([{ operation: 'divide', operands: [6, 3] }]);
  });

  it('chains 2 + 3 × 4 = 20', async () => {
    const user = userEvent.setup();
    render(<CalculatorPanel backend="java" failover={noFailover} />);
    await press(user, '2', 'add', '3', 'multiply');
    await waitFor(() => {
      expect(topLine()).toHaveTextContent('5 ×');
    });
    expect(mainLine()).toHaveTextContent(/^5$/);
    await press(user, '4', 'equals');
    await waitFor(() => {
      expect(mainLine()).toHaveTextContent(/^20$/);
    });
    expect(requests).toEqual([
      { operation: 'add', operands: [2, 3] },
      { operation: 'multiply', operands: [5, 4] },
    ]);
  });

  it('shows Cannot divide by zero and recovers on next digit', async () => {
    const user = userEvent.setup();
    render(<CalculatorPanel backend="java" failover={noFailover} />);
    await press(user, '5', 'divide', '0', 'equals');
    expect(await screen.findByText('Cannot divide by zero')).toBeInTheDocument();
    expect(topLine()).toHaveTextContent('5 ÷');
    await press(user, '2');
    expect(screen.queryByText('Cannot divide by zero')).not.toBeInTheDocument();
    expect(mainLine()).toHaveTextContent(/^2$/);
    await press(user, 'equals');
    await waitFor(() => {
      expect(mainLine()).toHaveTextContent(/^2\.5$/);
    });
  });

  it('shows Service unavailable on network error and retries with equals', async () => {
    server.use(http.post(URL_PATH, () => HttpResponse.error(), { once: true }));
    const user = userEvent.setup();
    render(<CalculatorPanel backend="java" failover={noFailover} />);
    await press(user, '7', 'subtract', '9', 'equals');
    expect(await screen.findByText('Service unavailable')).toBeInTheDocument();
    expect(mainLine()).toHaveTextContent(/^9$/);
    await press(user, 'equals');
    await waitFor(() => {
      expect(mainLine()).toHaveTextContent(/^-2$/);
    });
    expect(screen.queryByText('Service unavailable')).not.toBeInTheDocument();
    expect(requests).toEqual([{ operation: 'subtract', operands: [7, 9] }]);
  });

  it('supports physical keyboard', async () => {
    const user = userEvent.setup();
    render(<CalculatorPanel backend="java" failover={noFailover} />);
    await user.keyboard('6/3{Enter}');
    await waitFor(() => {
      expect(mainLine()).toHaveTextContent(/^2$/);
    });
    await user.keyboard('{Escape}');
    expect(mainLine()).toHaveTextContent(/^0$/);
    await user.keyboard('12,5{F9}');
    expect(mainLine()).toHaveTextContent(/^-12\.5$/);
    await user.keyboard('{Backspace}*2=');
    await waitFor(() => {
      expect(mainLine()).toHaveTextContent(/^-24$/);
    });
    await user.keyboard('-4+');
    await waitFor(() => {
      expect(topLine()).toHaveTextContent('-28 +');
    });
    expect(requests).toEqual([
      { operation: 'divide', operands: [6, 3] },
      { operation: 'multiply', operands: [-12, 2] },
      { operation: 'subtract', operands: [-24, 4] },
    ]);
  });

  it('rejects invalid paste with Invalid number', async () => {
    const user = userEvent.setup();
    render(<CalculatorPanel backend="java" failover={noFailover} />);
    await press(user, '4');
    fireEvent.paste(document.body, { clipboardData: { getData: () => '1..2' } });
    expect(await screen.findByText('Invalid number')).toBeInTheDocument();
    expect(mainLine()).toHaveTextContent(/^4$/);
  });

  it('accepts a valid paste', () => {
    render(<CalculatorPanel backend="java" failover={noFailover} />);
    fireEvent.paste(document.body, { clipboardData: { getData: () => ' 3,25 ' } });
    expect(mainLine()).toHaveTextContent(/^3\.25$/);
  });

  it('sends one request on double equals', async () => {
    const user = userEvent.setup();
    render(<CalculatorPanel backend="java" failover={noFailover} />);
    await press(user, '8', 'add', '1', 'equals', 'equals');
    await waitFor(() => {
      expect(mainLine()).toHaveTextContent(/^9$/);
    });
    await press(user, 'equals');
    expect(requests).toHaveLength(1);
  });

  it('does not double-act when Enter follows a clicked button', async () => {
    const user = userEvent.setup();
    render(<CalculatorPanel backend="java" failover={noFailover} />);
    await press(user, '2', 'add');
    await user.keyboard('3{Enter}');
    await waitFor(() => {
      expect(mainLine()).toHaveTextContent(/^5$/);
    });
    expect(topLine()).toHaveTextContent(/^$/);
    expect(requests).toEqual([{ operation: 'add', operands: [2, 3] }]);
  });

  it('does not re-press the last clicked button on Enter', async () => {
    const user = userEvent.setup();
    render(<CalculatorPanel backend="java" failover={noFailover} />);
    await press(user, '5');
    await user.keyboard('{Enter}');
    expect(mainLine()).toHaveTextContent(/^5$/);
    expect(requests).toHaveLength(0);
  });

  it('disables the keypad except clear while pending', async () => {
    let release: () => void = () => undefined;
    server.use(
      http.post(
        URL_PATH,
        () =>
          new Promise<Response>((resolve) => {
            release = () => {
              resolve(HttpResponse.json({ operation: 'add', result: '3' }));
            };
          }),
        { once: true },
      ),
    );
    const user = userEvent.setup();
    render(<CalculatorPanel backend="java" failover={noFailover} />);
    await press(user, '1', 'add', '2', 'equals');
    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'equals' })).toBeDisabled();
    });
    expect(status()).toHaveAttribute('aria-busy', 'true');
    expect(screen.getByRole('button', { name: 'clear' })).toBeEnabled();
    release();
    await waitFor(() => {
      expect(mainLine()).toHaveTextContent(/^3$/);
    });
    expect(screen.getByRole('button', { name: 'equals' })).toBeEnabled();
  });

  it('cancels the pending request on clear', async () => {
    let release: () => void = () => undefined;
    server.use(
      http.post(
        URL_PATH,
        () =>
          new Promise<Response>((resolve) => {
            release = () => {
              resolve(HttpResponse.json({ operation: 'add', result: '999' }));
            };
          }),
        { once: true },
      ),
    );
    const user = userEvent.setup();
    render(<CalculatorPanel backend="java" failover={noFailover} />);
    await press(user, '1', 'add', '2', 'equals');
    await waitFor(() => {
      expect(status()).toHaveAttribute('aria-busy', 'true');
    });
    await press(user, 'clear');
    release();
    await press(user, '4', 'add', '5', 'equals');
    await waitFor(() => {
      expect(mainLine()).toHaveTextContent(/^9$/);
    });
    expect(screen.queryByText('999')).not.toBeInTheDocument();
  });

  it('computes 2 ^ 10 = 1024', async () => {
    const user = userEvent.setup();
    render(<CalculatorPanel backend="java" failover={noFailover} />);
    await press(user, '2', 'power');
    expect(topLine()).toHaveTextContent('2 ^');
    await press(user, '1', '0', 'equals');
    await waitFor(() => {
      expect(mainLine()).toHaveTextContent(/^1024$/);
    });
    expect(requests).toEqual([{ operation: 'power', operands: [2, 10] }]);
  });

  it('computes 2 ^ 3 × 2 = 16', async () => {
    const user = userEvent.setup();
    render(<CalculatorPanel backend="java" failover={noFailover} />);
    await press(user, '2', 'power', '3', 'multiply');
    await waitFor(() => {
      expect(topLine()).toHaveTextContent('8 ×');
    });
    await press(user, '2', 'equals');
    await waitFor(() => {
      expect(mainLine()).toHaveTextContent(/^16$/);
    });
    expect(requests).toEqual([
      { operation: 'power', operands: [2, 3] },
      { operation: 'multiply', operands: [8, 2] },
    ]);
  });

  it('computes sqrt 9 = 3', async () => {
    const user = userEvent.setup();
    render(<CalculatorPanel backend="java" failover={noFailover} />);
    await press(user, '9', 'square root');
    await waitFor(() => {
      expect(mainLine()).toHaveTextContent(/^3$/);
    });
    expect(topLine()).toHaveTextContent(/^$/);
    expect(requests).toEqual([{ operation: 'sqrt', operands: [9] }]);
  });

  it('computes 2 + 9 sqrt = 5', async () => {
    const user = userEvent.setup();
    render(<CalculatorPanel backend="java" failover={noFailover} />);
    await press(user, '2', 'add', '9', 'square root');
    await waitFor(() => {
      expect(mainLine()).toHaveTextContent(/^3$/);
    });
    expect(topLine()).toHaveTextContent('2 +');
    await press(user, 'equals');
    await waitFor(() => {
      expect(mainLine()).toHaveTextContent(/^5$/);
    });
    expect(requests).toEqual([
      { operation: 'sqrt', operands: [9] },
      { operation: 'add', operands: [2, 3] },
    ]);
  });

  it('computes 20 % 150 = 30', async () => {
    const user = userEvent.setup();
    render(<CalculatorPanel backend="java" failover={noFailover} />);
    await press(user, '2', '0', 'percent');
    expect(topLine()).toHaveTextContent('20 %');
    await press(user, '1', '5', '0', 'equals');
    await waitFor(() => {
      expect(mainLine()).toHaveTextContent(/^30$/);
    });
    expect(requests).toEqual([{ operation: 'percentage', operands: [20, 150] }]);
  });

  it('shows Invalid input for 4 ± sqrt and resets with C', async () => {
    const user = userEvent.setup();
    render(<CalculatorPanel backend="java" failover={noFailover} />);
    await press(user, '4', 'plus/minus', 'square root');
    expect(await screen.findByText('Invalid input')).toBeInTheDocument();
    expect(mainLine()).toHaveTextContent(/^-4$/);
    await press(user, 'clear');
    expect(screen.queryByText('Invalid input')).not.toBeInTheDocument();
    expect(mainLine()).toHaveTextContent(/^0$/);
    expect(requests).toEqual([{ operation: 'sqrt', operands: [-4] }]);
  });

  it('shows Result too large for 10 ^ 100', async () => {
    const user = userEvent.setup();
    render(<CalculatorPanel backend="java" failover={noFailover} />);
    await press(user, '1', '0', 'power', '1', '0', '0', 'equals');
    expect(await screen.findByText('Result too large')).toBeInTheDocument();
    expect(requests).toEqual([{ operation: 'power', operands: [10, 100] }]);
  });

  it('shows Cannot divide by zero for 0 ^ -1', async () => {
    const user = userEvent.setup();
    render(<CalculatorPanel backend="java" failover={noFailover} />);
    await press(user, '0', 'power', '1', 'plus/minus', 'equals');
    expect(await screen.findByText('Cannot divide by zero')).toBeInTheDocument();
    expect(requests).toEqual([{ operation: 'power', operands: [0, -1] }]);
  });

  it('sends one request on sqrt then equals while pending', async () => {
    let release: () => void = () => undefined;
    server.use(
      http.post(
        URL_PATH,
        async ({ request }) => {
          const body = (await request.json()) as CalculateBody;
          requests.push(body);
          return new Promise<Response>((resolve) => {
            release = () => {
              resolve(fakeCalculate(body));
            };
          });
        },
        { once: true },
      ),
    );
    const user = userEvent.setup();
    render(<CalculatorPanel backend="java" failover={noFailover} />);
    await press(user, '9', 'square root');
    await waitFor(() => {
      expect(status()).toHaveAttribute('aria-busy', 'true');
    });
    expect(screen.getByRole('button', { name: 'equals' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'square root' })).toBeDisabled();
    await user.keyboard('={Enter}@');
    release();
    await waitFor(() => {
      expect(mainLine()).toHaveTextContent(/^3$/);
    });
    await press(user, 'equals');
    expect(requests).toEqual([{ operation: 'sqrt', operands: [9] }]);
  });

  it('keyboard 2^8 Enter = 256 and 16@ = 4', async () => {
    const user = userEvent.setup();
    render(<CalculatorPanel backend="java" failover={noFailover} />);
    await user.keyboard('2^8{Enter}');
    await waitFor(() => {
      expect(mainLine()).toHaveTextContent(/^256$/);
    });
    await user.keyboard('16@');
    await waitFor(() => {
      expect(mainLine()).toHaveTextContent(/^4$/);
    });
    await user.keyboard('{Escape}20%150=');
    await waitFor(() => {
      expect(mainLine()).toHaveTextContent(/^30$/);
    });
    expect(requests).toEqual([
      { operation: 'power', operands: [2, 8] },
      { operation: 'sqrt', operands: [16] },
      { operation: 'percentage', operands: [20, 150] },
    ]);
  });
});
