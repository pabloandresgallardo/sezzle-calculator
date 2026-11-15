import { delay, http, HttpResponse } from 'msw';
import { describe, expect, it } from 'vitest';
import { server } from '../../../test/msw/server';
import { calculate, CalculatorApiError, REQUEST_TIMEOUT_MS } from './calculatorApi';

const URL_PATH = '/api/java/v1/calculate';
const JAVA = { backend: 'java' } as const;

describe('calculate', () => {
  it('posts operation and numeric operands', async () => {
    let body = '';
    server.use(
      http.post(URL_PATH, async ({ request }) => {
        body = await request.text();
        return HttpResponse.json({ operation: 'add', result: '0.3' });
      }),
    );
    await calculate('add', ['0.1', '0.2'], JAVA);
    expect(body).toBe('{"operation":"add","operands":[0.1,0.2]}');
  });

  it('sends single operand for sqrt', async () => {
    let body = '';
    server.use(
      http.post(URL_PATH, async ({ request }) => {
        body = await request.text();
        return HttpResponse.json({ operation: 'sqrt', result: '3' });
      }),
    );
    await expect(calculate('sqrt', ['9'], JAVA)).resolves.toBe('3');
    expect(body).toBe('{"operation":"sqrt","operands":[9]}');
  });

  it('serializes trailing-dot operands as numbers', async () => {
    let body = '';
    server.use(
      http.post(URL_PATH, async ({ request }) => {
        body = await request.text();
        return HttpResponse.json({ operation: 'add', result: '6' });
      }),
    );
    await calculate('add', ['5.', '1'], JAVA);
    expect(body).toBe('{"operation":"add","operands":[5,1]}');
  });

  it('returns result string', async () => {
    server.use(http.post(URL_PATH, () => HttpResponse.json({ operation: 'add', result: '3' })));
    await expect(calculate('add', ['1', '2'], JAVA)).resolves.toBe('3');
  });

  it('returns result exactly as sent, without numeric conversion', async () => {
    server.use(http.post(URL_PATH, () => HttpResponse.json({ result: '0.0000001' })));
    await expect(calculate('divide', ['1', '10000000'], JAVA)).resolves.toBe('0.0000001');
  });

  it('maps a 200 without string result to null title', async () => {
    server.use(http.post(URL_PATH, () => HttpResponse.json({ result: 3 })));
    const error = await calculate('add', ['1', '2'], JAVA).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(CalculatorApiError);
    expect((error as CalculatorApiError).title).toBeNull();
  });

  it('throws title from problem detail', async () => {
    server.use(
      http.post(URL_PATH, () =>
        HttpResponse.json(
          { title: 'Division by zero', status: 400 },
          { status: 400, headers: { 'Content-Type': 'application/problem+json' } },
        ),
      ),
    );
    const error = await calculate('divide', ['1', '0'], JAVA).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(CalculatorApiError);
    expect((error as CalculatorApiError).title).toBe('Division by zero');
  });

  it('maps non-JSON 502 to null title', async () => {
    server.use(http.post(URL_PATH, () => new HttpResponse('Bad Gateway', { status: 502 })));
    const error = await calculate('add', ['1', '2'], JAVA).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(CalculatorApiError);
    expect((error as CalculatorApiError).title).toBeNull();
  });

  it('maps network error to null title', async () => {
    server.use(http.post(URL_PATH, () => HttpResponse.error()));
    const error = await calculate('add', ['1', '2'], JAVA).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(CalculatorApiError);
    expect((error as CalculatorApiError).title).toBeNull();
  });

  it('posts to /api/go/v1/calculate when backend is go', async () => {
    let body = '';
    server.use(
      http.post('/api/go/v1/calculate', async ({ request }) => {
        body = await request.text();
        return HttpResponse.json({ operation: 'add', result: '3' });
      }),
    );
    await expect(calculate('add', ['1', '2'], { backend: 'go' })).resolves.toBe('3');
    expect(body).toBe('{"operation":"add","operands":[1,2]}');
  });

  describe('retryable (eligible for failover)', () => {
    async function errorFor(response: () => Response): Promise<CalculatorApiError> {
      server.use(http.post(URL_PATH, response));
      const error = await calculate('add', ['1', '2'], JAVA).catch((e: unknown) => e);
      expect(error).toBeInstanceOf(CalculatorApiError);
      return error as CalculatorApiError;
    }

    it('is retryable on a network error', async () => {
      expect((await errorFor(() => HttpResponse.error())).retryable).toBe(true);
    });

    it.each([500, 502, 503, 504])('is retryable on a non-JSON %i', async (status) => {
      const error = await errorFor(() => new HttpResponse('<html>gateway</html>', { status }));
      expect(error.retryable).toBe(true);
      expect(error.title).toBeNull();
    });

    it('is retryable on a 5xx with a JSON body', async () => {
      const error = await errorFor(() =>
        HttpResponse.json({ title: 'Internal error', status: 500 }, { status: 500 }),
      );
      expect(error.retryable).toBe(true);
    });

    it('is not retryable on a 4xx with a problem detail', async () => {
      const error = await errorFor(() =>
        HttpResponse.json({ title: 'Division by zero', status: 400 }, { status: 400 }),
      );
      expect(error.retryable).toBe(false);
      expect(error.title).toBe('Division by zero');
    });

    it('is not retryable on a 413 text/html from the proxy', async () => {
      const error = await errorFor(
        () =>
          new HttpResponse('<html>413 Request Entity Too Large</html>', {
            status: 413,
            headers: { 'Content-Type': 'text/html' },
          }),
      );
      expect(error.retryable).toBe(false);
      expect(error.title).toBeNull();
    });
  });

  describe('client timeout', () => {
    function hanging() {
      server.use(
        http.post(URL_PATH, async () => {
          await delay('infinite');
          return HttpResponse.json({ result: 'never' });
        }),
      );
    }

    it('defaults to 10 s', () => {
      expect(REQUEST_TIMEOUT_MS).toBe(10_000);
    });

    it('surfaces a timeout as a retryable unavailability error', async () => {
      hanging();
      const error = await calculate('add', ['1', '2'], { backend: 'java', timeoutMs: 30 }).catch(
        (e: unknown) => e,
      );
      expect(error).toBeInstanceOf(CalculatorApiError);
      expect((error as CalculatorApiError).title).toBeNull();
      expect((error as CalculatorApiError).retryable).toBe(true);
    });

    it('still propagates a caller abort as AbortError when a timeout is set', async () => {
      hanging();
      const controller = new AbortController();
      const promise = calculate('add', ['1', '2'], {
        backend: 'java',
        signal: controller.signal,
        timeoutMs: 5_000,
      });
      controller.abort();
      await expect(promise).rejects.toMatchObject({ name: 'AbortError' });
    });
  });

  it('propagates abort', async () => {
    server.use(
      http.post(URL_PATH, async () => {
        await new Promise((resolve) => setTimeout(resolve, 200));
        return HttpResponse.json({ result: '3' });
      }),
    );
    const controller = new AbortController();
    const promise = calculate('add', ['1', '2'], { backend: 'java', signal: controller.signal });
    controller.abort();
    await expect(promise).rejects.toMatchObject({ name: 'AbortError' });
  });
});
