import type { KeyboardEvent, MouseEvent } from 'react';
import styles from './ThemeToggle.module.css';
import { useTheme } from './useTheme';

/** A mouse click leaves focus where it was, so a later Enter still means `=`. */
function keepFocus(event: MouseEvent<HTMLButtonElement>) {
  event.preventDefault();
}

/**
 * The calculator listens for keys on `window` and treats Enter as `=` (and prevents the default,
 * which would cancel this button's own activation). Enter / Space aimed at this button stop here.
 */
function keepActivationKeys(event: KeyboardEvent<HTMLButtonElement>) {
  if (event.key === 'Enter' || event.key === ' ') {
    event.stopPropagation();
  }
}

export function ThemeToggle() {
  const { theme, toggle } = useTheme();
  const dark = theme === 'dark';
  return (
    <button
      type="button"
      className={styles.toggle}
      aria-label={dark ? 'Switch to light mode' : 'Switch to dark mode'}
      title={dark ? 'Switch to light mode' : 'Switch to dark mode'}
      onMouseDown={keepFocus}
      onKeyDown={keepActivationKeys}
      onClick={toggle}
    >
      <span aria-hidden="true">{dark ? '☀' : '☾'}</span>
    </button>
  );
}
