import type { Backend } from '../../../shared/backend/backend';
import type { Operation } from '../model/types';

/** Client-side cap per request: a real calculation takes milliseconds. */
export const REQUEST_TIMEOUT_MS = 10_000;

export interface CalculatorApiErrorOptions {
  /**
   * The backend is unavailable (network error, client timeout, 5xx or a 2xx without a result):
   * worth retrying on the other backend. A 4xx, with or without JSON, never is.
   */
  retryable: boolean;
}

export class CalculatorApiError extends Error {
  readonly title: string | null;
  readonly retryable: boolean;

  constructor(title: string | null, { retryable }: CalculatorApiErrorOptions) {
    super(title ?? 'Calculator API error');
    this.name = 'CalculatorApiError';
    this.title = title;
    this.retryable = retryable;
  }
}

function hasName(error: unknown, name: string): boolean {
  return error instanceof Error && error.name === name;
}

/**
 * Maps a failure while fetching or reading the body. A caller abort (`AbortError`) propagates
 * unchanged; the client timeout (`TimeoutError`) and network errors mean "unavailable".
 */
function failure(error: unknown, signal: AbortSignal | undefined): unknown {
  if (signal?.aborted === true || hasName(error, 'AbortError')) {
    return error;
  }
  return new CalculatorApiError(null, { retryable: true });
}

async function readJson(response: Response): Promise<unknown> {
  try {
    return await response.json();
  } catch (error) {
    // Aborted or timed out while reading: not a body problem.
    if (hasName(error, 'AbortError') || hasName(error, 'TimeoutError')) throw error;
    return null;
  }
}

function stringField(body: unknown, field: string): string | null {
  if (typeof body !== 'object' || body === null) return null;
  const value = (body as Record<string, unknown>)[field];
  return typeof value === 'string' ? value : null;
}

export interface CalculateOptions {
  backend: Backend;
  signal?: AbortSignal;
  /** Client timeout in ms (default {@link REQUEST_TIMEOUT_MS}); tests inject a short one. */
  timeoutMs?: number;
}

/** The only place that knows the URL: `/api/{backend}/v1/calculate` (the proxy strips `/{backend}`). */
export async function calculate(
  operation: Operation,
  operands: readonly string[],
  { backend, signal, timeoutMs = REQUEST_TIMEOUT_MS }: CalculateOptions,
): Promise<string> {
  const timeout = AbortSignal.timeout(timeoutMs);
  const combined = signal === undefined ? timeout : AbortSignal.any([signal, timeout]);

  let body: unknown;
  let response: Response;
  try {
    response = await fetch(`/api/${backend}/v1/calculate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ operation, operands: operands.map(Number) }),
      signal: combined,
    });
    body = await readJson(response);
  } catch (error) {
    throw failure(error, signal);
  }

  if (response.ok) {
    const result = stringField(body, 'result');
    if (result === null) throw new CalculatorApiError(null, { retryable: true });
    return result;
  }
  const isClientError = response.status >= 400 && response.status < 500;
  if (isClientError) {
    throw new CalculatorApiError(stringField(body, 'title'), { retryable: false });
  }
  throw new CalculatorApiError(null, { retryable: true });
}
