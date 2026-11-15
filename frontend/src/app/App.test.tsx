import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { afterEach, describe, expect, it } from 'vitest';
import { THEME_STORAGE_KEY } from '../shared/theme/theme';
import { server } from '../test/msw/server';
import { App } from './App';

const root = document.documentElement;

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

describe('App', () => {
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
      http.post('/api/v1/calculate', async ({ request }) => {
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
