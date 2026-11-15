import { http, HttpResponse } from 'msw';
import { describe, expect, it } from 'vitest';
import { server } from '../../../test/msw/server';
import { calculate, CalculatorApiError } from './calculatorApi';

const URL_PATH = '/api/v1/calculate';

describe('calculate', () => {
  it('posts operation and numeric operands', async () => {
    let body = '';
    server.use(
      http.post(URL_PATH, async ({ request }) => {
        body = await request.text();
        return HttpResponse.json({ operation: 'add', result: '0.3' });
      }),
    );
    await calculate('add', ['0.1', '0.2']);
    expect(body).toBe('{"operation":"add","operands":[0.1,0.2]}');
  });

  it('serializes trailing-dot operands as numbers', async () => {
    let body = '';
    server.use(
      http.post(URL_PATH, async ({ request }) => {
        body = await request.text();
        return HttpResponse.json({ operation: 'add', result: '6' });
      }),
    );
    await calculate('add', ['5.', '1']);
    expect(body).toBe('{"operation":"add","operands":[5,1]}');
  });

  it('returns result string', async () => {
    server.use(http.post(URL_PATH, () => HttpResponse.json({ operation: 'add', result: '3' })));
    await expect(calculate('add', ['1', '2'])).resolves.toBe('3');
  });

  it('returns result exactly as sent, without numeric conversion', async () => {
    server.use(http.post(URL_PATH, () => HttpResponse.json({ result: '0.0000001' })));
    await expect(calculate('divide', ['1', '10000000'])).resolves.toBe('0.0000001');
  });

  it('maps a 200 without string result to null title', async () => {
    server.use(http.post(URL_PATH, () => HttpResponse.json({ result: 3 })));
    const error = await calculate('add', ['1', '2']).catch((e: unknown) => e);
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
    const error = await calculate('divide', ['1', '0']).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(CalculatorApiError);
    expect((error as CalculatorApiError).title).toBe('Division by zero');
  });

  it('maps non-JSON 502 to null title', async () => {
    server.use(http.post(URL_PATH, () => new HttpResponse('Bad Gateway', { status: 502 })));
    const error = await calculate('add', ['1', '2']).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(CalculatorApiError);
    expect((error as CalculatorApiError).title).toBeNull();
  });

  it('maps network error to null title', async () => {
    server.use(http.post(URL_PATH, () => HttpResponse.error()));
    const error = await calculate('add', ['1', '2']).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(CalculatorApiError);
    expect((error as CalculatorApiError).title).toBeNull();
  });

  it('propagates abort', async () => {
    server.use(
      http.post(URL_PATH, async () => {
        await new Promise((resolve) => setTimeout(resolve, 200));
        return HttpResponse.json({ result: '3' });
      }),
    );
    const controller = new AbortController();
    const promise = calculate('add', ['1', '2'], controller.signal);
    controller.abort();
    await expect(promise).rejects.toMatchObject({ name: 'AbortError' });
  });
});
