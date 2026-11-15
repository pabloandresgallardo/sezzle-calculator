import { useCallback, useEffect, useState } from 'react';
import { DEFAULT_THEME, isTheme, storeTheme, type Theme } from './theme';

export interface UseTheme {
  theme: Theme;
  toggle: () => void;
}

/** The inline script in `index.html` has already resolved the stored theme onto `<html>`. */
function initialTheme(): Theme {
  const applied = document.documentElement.dataset.theme;
  return isTheme(applied) ? applied : DEFAULT_THEME;
}

export function useTheme(): UseTheme {
  const [theme, setTheme] = useState<Theme>(initialTheme);

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
  }, [theme]);

  // Only an explicit choice is persisted: no stored value already means dark.
  const toggle = useCallback(() => {
    const next: Theme = theme === 'dark' ? 'light' : 'dark';
    storeTheme(next);
    setTheme(next);
  }, [theme]);

  return { theme, toggle };
}
