export const CLIENT_ERRORS = {
  invalidNumber: 'Invalid number',
  tooManyDigits: 'Too many digits',
  resultTooLong: 'Result too long to continue',
} as const;

const SERVICE_UNAVAILABLE = 'Service unavailable';
const INVALID_REQUEST = 'Invalid request';

const MESSAGES_BY_TITLE = new Map<string, string>([
  ['Division by zero', 'Cannot divide by zero'],
  ['Operand out of range', 'Number out of range'],
  ['Invalid operand', 'Invalid input'],
  ['Result out of range', 'Result too large'],
  ['Unsupported operation', INVALID_REQUEST],
  ['Invalid operand count', INVALID_REQUEST],
  ['Malformed request', INVALID_REQUEST],
  ['Internal error', SERVICE_UNAVAILABLE],
]);

/** Maps a ProblemDetail `title` (or `null` for network/5xx failures) to a user message. */
export function messageForApiTitle(title: string | null): string {
  if (title === null) {
    return SERVICE_UNAVAILABLE;
  }
  return MESSAGES_BY_TITLE.get(title) ?? INVALID_REQUEST;
}
