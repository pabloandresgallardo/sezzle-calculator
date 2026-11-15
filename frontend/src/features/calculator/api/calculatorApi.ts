import type { Operation } from '../model/types';

export class CalculatorApiError extends Error {
  readonly title: string | null;

  constructor(title: string | null) {
    super(title ?? 'Calculator API error');
    this.name = 'CalculatorApiError';
    this.title = title;
  }
}

function isAbortError(error: unknown): boolean {
  return error instanceof Error && error.name === 'AbortError';
}

async function readJson(response: Response): Promise<unknown> {
  try {
    return await response.json();
  } catch {
    return null;
  }
}

function stringField(body: unknown, field: string): string | null {
  if (typeof body !== 'object' || body === null) return null;
  const value = (body as Record<string, unknown>)[field];
  return typeof value === 'string' ? value : null;
}

export async function calculate(
  operation: Operation,
  operands: [string, string],
  signal?: AbortSignal,
): Promise<string> {
  let response: Response;
  try {
    response = await fetch('/api/v1/calculate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ operation, operands: operands.map(Number) }),
      signal,
    });
  } catch (error) {
    if (isAbortError(error)) throw error;
    throw new CalculatorApiError(null);
  }

  let body: unknown;
  try {
    body = await readJson(response);
  } catch (error) {
    if (isAbortError(error)) throw error;
    throw new CalculatorApiError(null);
  }

  if (response.ok) {
    const result = stringField(body, 'result');
    if (result === null) throw new CalculatorApiError(null);
    return result;
  }
  const isClientError = response.status >= 400 && response.status < 500;
  throw new CalculatorApiError(isClientError ? stringField(body, 'title') : null);
}
