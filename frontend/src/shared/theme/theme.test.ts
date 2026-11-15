import { afterEach, describe, expect, it, vi } from 'vitest';
import { readStoredTheme, storeTheme, THEME_STORAGE_KEY } from './theme';

function blockedStorage(): never {
  throw new DOMException('The operation is insecure.', 'SecurityError');
}

afterEach(() => {
  vi.restoreAllMocks();
  localStorage.clear();
});

describe('theme storage', () => {
  it('uses the agreed storage key', () => {
    expect(THEME_STORAGE_KEY).toBe('sezzle-calculator-theme');
  });

  it('returns null when nothing is stored', () => {
    expect(readStoredTheme()).toBeNull();
  });

  it.each(['dark', 'light'] as const)('round-trips %s through localStorage', (theme) => {
    storeTheme(theme);
    expect(localStorage.getItem(THEME_STORAGE_KEY)).toBe(theme);
    expect(readStoredTheme()).toBe(theme);
  });

  it.each(['blue', '', 'DARK', '"light"'])(
    'treats invalid stored value %j as no preference',
    (value) => {
      localStorage.setItem(THEME_STORAGE_KEY, value);
      expect(readStoredTheme()).toBeNull();
    },
  );

  it('returns null when getItem throws (blocked storage)', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(blockedStorage);
    expect(readStoredTheme()).toBeNull();
  });

  it('does not throw when setItem throws (private mode / quota)', () => {
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(blockedStorage);
    expect(() => {
      storeTheme('light');
    }).not.toThrow();
  });

  it('survives localStorage itself being inaccessible', () => {
    vi.spyOn(window, 'localStorage', 'get').mockImplementation(blockedStorage);
    expect(readStoredTheme()).toBeNull();
    expect(() => {
      storeTheme('dark');
    }).not.toThrow();
  });
});
