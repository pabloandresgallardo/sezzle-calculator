import { readdirSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const SRC = resolve(process.cwd(), 'src');
const globalCss = readFileSync(join(SRC, 'app', 'global.css'), 'utf8');

type Tokens = Map<string, string>;

/** Custom properties declared in the `:root[data-theme="<theme>"]` block. */
function tokensFor(theme: 'dark' | 'light'): Tokens {
  const block = new RegExp(`:root\\[data-theme=['"]${theme}['"]\\]\\s*\\{([^}]*)\\}`).exec(
    globalCss,
  );
  if (block?.[1] === undefined) {
    throw new Error(`global.css has no :root[data-theme="${theme}"] block`);
  }
  return new Map(
    Array.from(block[1].matchAll(/(--[\w-]+)\s*:\s*([^;]+);/g), (m) => [
      m[1] ?? '',
      (m[2] ?? '').trim(),
    ]),
  );
}

function hex(tokens: Tokens, name: string): string {
  const value = tokens.get(name);
  if (value === undefined || !/^#[0-9a-f]{6}$/i.test(value)) {
    throw new Error(`${name} must be a 6-digit hex colour, got ${String(value)}`);
  }
  return value;
}

/** WCAG 2.x relative luminance / contrast ratio. */
function luminance(color: string): number {
  const channels = [1, 3, 5].map((i) => parseInt(color.slice(i, i + 2), 16) / 255);
  const [r = 0, g = 0, b = 0] = channels.map((c) =>
    c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4,
  );
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function contrast(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return ((hi ?? 0) + 0.05) / ((lo ?? 0) + 0.05);
}

/** Every foreground/background pair the UI actually renders, foreground first. */
const TEXT_PAIRS: readonly [string, string][] = [
  ['--color-text', '--color-bg'],
  ['--color-text', '--color-surface'],
  ['--color-text', '--color-screen'],
  ['--color-text', '--color-key'],
  ['--color-text', '--color-action'],
  ['--color-muted', '--color-screen'],
  ['--color-muted', '--color-bg'],
  ['--color-error', '--color-screen'],
  ['--color-operator-text', '--color-operator'],
  ['--color-accent-text', '--color-accent'],
];

/** Non-text UI (focus ring, toggle outline) needs 3:1 against what surrounds it. */
const UI_PAIRS: readonly [string, string][] = [
  ['--color-focus', '--color-bg'],
  ['--color-focus', '--color-surface'],
  ['--color-border', '--color-bg'],
];

function cssModules(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return cssModules(path);
    return entry.name.endsWith('.module.css') ? [path] : [];
  });
}

describe.each(['dark', 'light'] as const)('%s theme tokens', (theme) => {
  const tokens = tokensFor(theme);

  it.each(TEXT_PAIRS)('%s on %s meets WCAG AA (4.5:1)', (fg, bg) => {
    expect(contrast(hex(tokens, fg), hex(tokens, bg))).toBeGreaterThanOrEqual(4.5);
  });

  it.each(UI_PAIRS)('%s against %s meets 3:1', (fg, bg) => {
    expect(contrast(hex(tokens, fg), hex(tokens, bg))).toBeGreaterThanOrEqual(3);
  });

  it('keeps the four keypad styles visually distinct', () => {
    const keys = ['--color-key', '--color-action', '--color-operator', '--color-accent'];
    expect(new Set(keys.map((k) => hex(tokens, k))).size).toBe(keys.length);
  });

  it(`sets color-scheme: ${theme}`, () => {
    expect(tokens.size).toBeGreaterThan(0);
    expect(globalCss).toMatch(
      new RegExp(`:root\\[data-theme=['"]${theme}['"]\\]\\s*\\{[^}]*color-scheme:\\s*${theme};`),
    );
  });
});

describe('theme stylesheet', () => {
  it('defines the same tokens in both themes', () => {
    expect([...tokensFor('light').keys()].sort()).toEqual([...tokensFor('dark').keys()].sort());
  });

  it('ignores the operating system preference', () => {
    expect(globalCss).not.toContain('prefers-color-scheme');
  });

  it('declares colours only inside the two theme blocks', () => {
    const outside = globalCss.replace(/:root\[data-theme=['"](dark|light)['"]\]\s*\{[^}]*\}/g, '');
    expect(outside).not.toMatch(/#[0-9a-f]{3,8}\b|rgba?\(|hsla?\(/i);
  });

  it.each(cssModules(SRC).map((path) => [path.slice(SRC.length + 1), path]))(
    '%s uses theme variables, not colour literals',
    (_name, path) => {
      expect(readFileSync(path, 'utf8')).not.toMatch(/#[0-9a-f]{3,8}\b|rgba?\(|hsla?\(/i);
    },
  );

  it('every var() used by a module is defined by the themes', () => {
    const defined = new Set(tokensFor('dark').keys());
    const used = cssModules(SRC).flatMap((path) =>
      Array.from(readFileSync(path, 'utf8').matchAll(/var\((--[\w-]+)/g), (m) => m[1] ?? ''),
    );
    expect(used.filter((name) => !defined.has(name))).toEqual([]);
  });
});
