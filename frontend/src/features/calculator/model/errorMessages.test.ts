import { describe, expect, it } from 'vitest';
import { CLIENT_ERRORS, messageForApiTitle } from './errorMessages';

describe('messageForApiTitle', () => {
  it.each([
    ['Division by zero', 'Cannot divide by zero'],
    ['Operand out of range', 'Number out of range'],
    ['Unsupported operation', 'Invalid request'],
    ['Invalid operand count', 'Invalid request'],
    ['Malformed request', 'Invalid request'],
  ])('maps contractual title %j', (title, message) => {
    expect(messageForApiTitle(title)).toBe(message);
  });

  it('maps network failures and internal errors to Service unavailable', () => {
    expect(messageForApiTitle(null)).toBe('Service unavailable');
    expect(messageForApiTitle('Internal error')).toBe('Service unavailable');
  });

  it('maps unknown titles to Invalid request', () => {
    expect(messageForApiTitle('Something else')).toBe('Invalid request');
    expect(messageForApiTitle('toString')).toBe('Invalid request');
  });
});

describe('CLIENT_ERRORS', () => {
  it('exposes the client-side messages', () => {
    expect(CLIENT_ERRORS).toEqual({
      invalidNumber: 'Invalid number',
      tooManyDigits: 'Too many digits',
      resultTooLong: 'Result too long to continue',
    });
  });
});
