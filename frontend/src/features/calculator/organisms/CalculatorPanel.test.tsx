import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { beforeEach, describe, expect, it } from 'vitest';
import { server } from '../../../test/msw/server';
import type { Operation } from '../model/types';
import { CalculatorPanel } from './CalculatorPanel';

const URL_PATH = '/api/v1/calculate';

interface CalculateBody {
  operation: Operation;
  operands: [number, number];
}

let requests: CalculateBody[];

/** Fake backend: plain JS arithmetic is exact for the small values used here. */
const calculatorHandler = http.post(URL_PATH, async ({ request }) => {
  const body = (await request.json()) as CalculateBody;
  requests.push(body);
  const [a, b] = body.operands;
  if (body.operation === 'divide' && b === 0) {
    return HttpResponse.json({ title: 'Division by zero', status: 400 }, { status: 400 });
  }
  const results: Record<Operation, number> = {
    add: a + b,
    subtract: a - b,
    multiply: a * b,
    divide: a / b,
  };
  return HttpResponse.json({ operation: body.operation, result: String(results[body.operation]) });
});

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
  server.use(calculatorHandler);
});

describe('CalculatorPanel', () => {
  it('starts at 0', () => {
    render(<CalculatorPanel />);
    expect(mainLine()).toHaveTextContent(/^0$/);
    expect(topLine()).toHaveTextContent(/^$/);
  });

  it('computes 6 ÷ 3 = 2', async () => {
    const user = userEvent.setup();
    render(<CalculatorPanel />);
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
    render(<CalculatorPanel />);
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
    render(<CalculatorPanel />);
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
    render(<CalculatorPanel />);
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
    render(<CalculatorPanel />);
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
    render(<CalculatorPanel />);
    await press(user, '4');
    fireEvent.paste(document.body, { clipboardData: { getData: () => '1..2' } });
    expect(await screen.findByText('Invalid number')).toBeInTheDocument();
    expect(mainLine()).toHaveTextContent(/^4$/);
  });

  it('accepts a valid paste', () => {
    render(<CalculatorPanel />);
    fireEvent.paste(document.body, { clipboardData: { getData: () => ' 3,25 ' } });
    expect(mainLine()).toHaveTextContent(/^3\.25$/);
  });

  it('sends one request on double equals', async () => {
    const user = userEvent.setup();
    render(<CalculatorPanel />);
    await press(user, '8', 'add', '1', 'equals', 'equals');
    await waitFor(() => {
      expect(mainLine()).toHaveTextContent(/^9$/);
    });
    await press(user, 'equals');
    expect(requests).toHaveLength(1);
  });

  it('does not double-act when Enter follows a clicked button', async () => {
    const user = userEvent.setup();
    render(<CalculatorPanel />);
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
    render(<CalculatorPanel />);
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
    render(<CalculatorPanel />);
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
    render(<CalculatorPanel />);
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
});
