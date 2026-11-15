import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { THEME_STORAGE_KEY } from './theme';
import { ThemeToggle } from './ThemeToggle';

const root = document.documentElement;

afterEach(() => {
  vi.restoreAllMocks();
  localStorage.clear();
  delete root.dataset.theme;
});

function toggle(): HTMLElement {
  return screen.getByRole('button', { name: /^Switch to (light|dark) mode$/ });
}

describe('ThemeToggle', () => {
  it('starts dark when the page has no theme attribute', () => {
    render(<ThemeToggle />);
    expect(root.dataset.theme).toBe('dark');
    expect(toggle()).toHaveAccessibleName('Switch to light mode');
    expect(toggle()).toHaveTextContent('☀');
  });

  it('starts from the theme applied by the inline script', () => {
    root.dataset.theme = 'light';
    render(<ThemeToggle />);
    expect(root.dataset.theme).toBe('light');
    expect(toggle()).toHaveAccessibleName('Switch to dark mode');
    expect(toggle()).toHaveTextContent('☾');
  });

  it('falls back to dark when the attribute holds an unknown value', () => {
    root.dataset.theme = 'sepia';
    render(<ThemeToggle />);
    expect(root.dataset.theme).toBe('dark');
    expect(toggle()).toHaveAccessibleName('Switch to light mode');
  });

  it('does not persist anything until the user chooses', () => {
    render(<ThemeToggle />);
    expect(localStorage.getItem(THEME_STORAGE_KEY)).toBeNull();
  });

  it('click toggles the html attribute, the label and persists the choice', async () => {
    const user = userEvent.setup();
    render(<ThemeToggle />);

    await user.click(toggle());
    expect(root.dataset.theme).toBe('light');
    expect(toggle()).toHaveAccessibleName('Switch to dark mode');
    expect(localStorage.getItem(THEME_STORAGE_KEY)).toBe('light');

    await user.click(toggle());
    expect(root.dataset.theme).toBe('dark');
    expect(toggle()).toHaveAccessibleName('Switch to light mode');
    expect(localStorage.getItem(THEME_STORAGE_KEY)).toBe('dark');
  });

  it('a mouse click does not move focus onto the toggle', async () => {
    const user = userEvent.setup();
    render(<ThemeToggle />);
    await user.click(toggle());
    expect(toggle()).not.toHaveFocus();
  });

  it.each([
    ['Enter', '{Enter}'],
    ['Space', ' '],
  ])('%s toggles exactly once when focused', async (_name, key) => {
    const user = userEvent.setup();
    render(<ThemeToggle />);
    toggle().focus();
    await user.keyboard(key);
    expect(root.dataset.theme).toBe('light');
    expect(toggle()).toHaveFocus();
  });

  it('keeps working when storage is blocked', async () => {
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new DOMException('blocked', 'SecurityError');
    });
    const user = userEvent.setup();
    render(<ThemeToggle />);
    await user.click(toggle());
    expect(root.dataset.theme).toBe('light');
  });
});
