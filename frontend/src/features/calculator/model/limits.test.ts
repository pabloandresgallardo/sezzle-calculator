import { describe, expect, it } from 'vitest';
import {
  MAX_DECIMALS,
  MAX_SIGNIFICANT_DIGITS,
  canAppendDigit,
  isWithinLimits,
  parsePastedNumber,
} from './limits';

describe('limits constants', () => {
  it('match the backend contract', () => {
    expect(MAX_SIGNIFICANT_DIGITS).toBe(15);
    expect(MAX_DECIMALS).toBe(10);
  });
});

describe('canAppendDigit', () => {
  it('rejects a 16th significant digit', () => {
    expect(canAppendDigit('999999999999999')).toBe(false);
  });

  it('counts typed decimals including trailing zeros', () => {
    expect(canAppendDigit('1.0000000000')).toBe(false);
  });

  it('ignores sign and leading zeros', () => {
    expect(canAppendDigit('-0.5')).toBe(true);
    expect(canAppendDigit('-00000000000000012345678901234')).toBe(true);
  });

  it('allows appending below the limits', () => {
    expect(canAppendDigit('')).toBe(true);
    expect(canAppendDigit('99999999999999')).toBe(true);
    expect(canAppendDigit('1.000000000')).toBe(true);
  });
});

describe('isWithinLimits', () => {
  it('rejects more than 15 significant digits', () => {
    expect(isWithinLimits('17636684.1428571429')).toBe(false);
  });

  it('rejects absolute values of 10^15 or more', () => {
    expect(isWithinLimits('1000000000000000')).toBe(false);
    expect(isWithinLimits('-1000000000000000')).toBe(false);
    expect(isWithinLimits('999999999999999')).toBe(true);
  });

  it('normalizes trailing zeros', () => {
    expect(isWithinLimits('1.50')).toBe(true);
    expect(isWithinLimits('1.10000000000')).toBe(true);
    expect(isWithinLimits('100000000000000')).toBe(true);
  });

  it('rejects more than 10 decimals', () => {
    expect(isWithinLimits('0.12345678901')).toBe(false);
    expect(isWithinLimits('0.1234567890')).toBe(true);
  });

  it('accepts zero and negative values', () => {
    expect(isWithinLimits('0')).toBe(true);
    expect(isWithinLimits('-3')).toBe(true);
  });

  it('rejects non-numeric text', () => {
    expect(isWithinLimits('abc')).toBe(false);
    expect(isWithinLimits('1e5')).toBe(false);
  });
});

describe('parsePastedNumber', () => {
  it('rejects repeated decimal points', () => {
    expect(parsePastedNumber('1..2')).toEqual({ ok: false, reason: 'invalid' });
  });

  it('trims and converts comma to point', () => {
    expect(parsePastedNumber(' 3,5 ')).toEqual({ ok: true, value: '3.5' });
  });

  it('rejects scientific notation', () => {
    expect(parsePastedNumber('1e5')).toEqual({ ok: false, reason: 'invalid' });
  });

  it('rejects numbers beyond the limits', () => {
    expect(parsePastedNumber('1234567890123456')).toEqual({ ok: false, reason: 'tooLong' });
  });

  it('accepts negative and leading-point numbers', () => {
    expect(parsePastedNumber('-12.5')).toEqual({ ok: true, value: '-12.5' });
    expect(parsePastedNumber('.5')).toEqual({ ok: true, value: '0.5' });
  });

  it.each([
    ['007', '7'],
    ['000', '0'],
    ['-007.50', '-7.50'],
    ['.5', '0.5'],
    ['-.5', '-0.5'],
    ['-0', '0'],
    ['-0.0', '0'],
    ['0.00', '0'],
    ['5.', '5'],
    ['-5.', '-5'],
    ['00.25', '0.25'],
    ['000000000000000001', '1'],
  ])('normalizes pasted %s to %s', (text, value) => {
    expect(parsePastedNumber(text)).toEqual({ ok: true, value });
  });

  it('rejects empty text', () => {
    expect(parsePastedNumber('   ')).toEqual({ ok: false, reason: 'invalid' });
  });
});
