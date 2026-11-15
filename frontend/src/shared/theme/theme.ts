export type Theme = 'dark' | 'light';

/** Kept in sync with the inline no-flash script in `index.html`. */
export const THEME_STORAGE_KEY = 'sezzle-calculator-theme';

/** Dark is the default on purpose: `prefers-color-scheme` is ignored. */
export const DEFAULT_THEME: Theme = 'dark';

export function isTheme(value: unknown): value is Theme {
  return value === 'dark' || value === 'light';
}

/** The stored preference, or `null` when there is none, it is invalid or storage is blocked. */
export function readStoredTheme(): Theme | null {
  try {
    const value = window.localStorage.getItem(THEME_STORAGE_KEY);
    return isTheme(value) ? value : null;
  } catch {
    return null;
  }
}

/** Best effort: private mode or blocked storage just means the choice is not remembered. */
export function storeTheme(theme: Theme): void {
  try {
    window.localStorage.setItem(THEME_STORAGE_KEY, theme);
  } catch {
    // Ignored on purpose, see above.
  }
}
