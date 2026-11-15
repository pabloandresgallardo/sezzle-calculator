export const MAX_SIGNIFICANT_DIGITS = 15;
export const MAX_DECIMALS = 10;

const NUMBER_PATTERN = /^-?(\d+\.?\d*|\.\d+)$/;

function splitNumber(value: string): { integer: string; fraction: string } {
  const [integer = '', fraction = ''] = value.replace('-', '').split('.');
  return { integer, fraction };
}

/** Whether one more digit fits, counting decimals exactly as typed. */
export function canAppendDigit(current: string): boolean {
  const { integer, fraction } = splitNumber(current);
  const significant = (integer + fraction).replace(/^0+/, '');
  return significant.length < MAX_SIGNIFICANT_DIGITS && fraction.length < MAX_DECIMALS;
}

/** Backend semantics: after stripping trailing zeros, precision ≤ 15, scale ≤ 10 and |x| < 10^15. */
export function isWithinLimits(value: string): boolean {
  if (!NUMBER_PATTERN.test(value)) {
    return false;
  }
  const { integer: rawInteger, fraction: rawFraction } = splitNumber(value);
  const integer = rawInteger.replace(/^0+/, '');
  const fraction = rawFraction.replace(/0+$/, '');
  const precision =
    fraction === ''
      ? integer.replace(/0+$/, '').length
      : (integer + fraction).replace(/^0+/, '').length;
  return (
    integer.length <= MAX_SIGNIFICANT_DIGITS &&
    precision <= MAX_SIGNIFICANT_DIGITS &&
    fraction.length <= MAX_DECIMALS
  );
}

export type PasteResult =
  { ok: true; value: string } | { ok: false; reason: 'invalid' | 'tooLong' };

export function parsePastedNumber(text: string): PasteResult {
  const value = text.trim().replace(',', '.');
  if (!NUMBER_PATTERN.test(value)) {
    return { ok: false, reason: 'invalid' };
  }
  if (!isWithinLimits(value)) {
    return { ok: false, reason: 'tooLong' };
  }
  return { ok: true, value: normalizePasted(value) };
}

/** Canonical form of a valid pasted number: `007`→`7`, `.5`→`0.5`, `5.`→`5`, `-0.0`→`0`. */
function normalizePasted(value: string): string {
  const negative = value.startsWith('-');
  const { integer, fraction } = splitNumber(value);
  if (/^0*$/.test(integer + fraction)) {
    return '0';
  }
  const normalizedInteger = integer.replace(/^0+/, '') || '0';
  const body = fraction === '' ? normalizedInteger : `${normalizedInteger}.${fraction}`;
  return negative ? `-${body}` : body;
}
