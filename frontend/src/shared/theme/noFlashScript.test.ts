import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { THEME_STORAGE_KEY } from './theme';

const html = readFileSync(resolve(process.cwd(), 'index.html'), 'utf8');
const root = document.documentElement;

/** The inline (no `src`) script that must run before the bundle. */
function inlineScript(): string {
  const match = /<script>([\s\S]*?)<\/script>/.exec(html);
  if (match?.[1] === undefined) {
    throw new Error('index.html has no inline theme script');
  }
  return match[1];
}

function runInlineScript(): void {
  // Executing the real index.html snippet is the point of this test.
  // eslint-disable-next-line @typescript-eslint/no-implied-eval
  const run = new Function(inlineScript()) as () => void;
  run();
}

afterEach(() => {
  vi.restoreAllMocks();
  localStorage.clear();
  delete root.dataset.theme;
});

describe('index.html no-flash theme script', () => {
  it('runs before the module bundle and reads the agreed storage key', () => {
    expect(html.indexOf('<script>')).toBeGreaterThan(-1);
    expect(html.indexOf('<script>')).toBeLessThan(html.indexOf('<script type="module"'));
    expect(inlineScript()).toContain(`'${THEME_STORAGE_KEY}'`);
  });

  it('declares dark on <html> even before any script runs', () => {
    expect(html).toMatch(/<html[^>]*\sdata-theme="dark"/);
  });

  it('applies dark when nothing is stored', () => {
    runInlineScript();
    expect(root.dataset.theme).toBe('dark');
  });

  it.each(['dark', 'light'])('applies the stored %s theme', (theme) => {
    localStorage.setItem(THEME_STORAGE_KEY, theme);
    runInlineScript();
    expect(root.dataset.theme).toBe(theme);
  });

  it('treats an invalid stored value as dark', () => {
    localStorage.setItem(THEME_STORAGE_KEY, 'sepia');
    root.dataset.theme = 'light';
    runInlineScript();
    expect(root.dataset.theme).toBe('dark');
  });

  it('falls back to dark without throwing when storage is blocked', () => {
    vi.spyOn(window, 'localStorage', 'get').mockImplementation(() => {
      throw new DOMException('The operation is insecure.', 'SecurityError');
    });
    expect(runInlineScript).not.toThrow();
    expect(root.dataset.theme).toBe('dark');
  });
});
