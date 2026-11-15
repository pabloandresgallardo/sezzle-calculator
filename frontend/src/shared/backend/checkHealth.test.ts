import { delay, http, HttpResponse } from 'msw';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { server } from '../../test/msw/server';
import { HEALTH_TIMEOUT_MS } from './backend';
import { checkHealth } from './checkHealth';

afterEach(() => {
  vi.useRealTimers();
});

describe('checkHealth', () => {
  it('ok when 200 UP', async () => {
    const paths: string[] = [];
    server.use(
      http.get('/api/:backend/health', ({ request }) => {
        paths.push(new URL(request.url).pathname);
        return HttpResponse.json({ groups: ['liveness', 'readiness'], status: 'UP' });
      }),
    );
    await expect(checkHealth('java')).resolves.toBe(true);
    await expect(checkHealth('go')).resolves.toBe(true);
    expect(paths).toEqual(['/api/java/health', '/api/go/health']);
  });

  it('down when 200 but status is not UP', async () => {
    server.use(http.get('/api/go/health', () => HttpResponse.json({ status: 'DOWN' })));
    await expect(checkHealth('go')).resolves.toBe(false);
  });

  it('down when 200 with a body that is not JSON', async () => {
    server.use(http.get('/api/go/health', () => new HttpResponse('UP', { status: 200 })));
    await expect(checkHealth('go')).resolves.toBe(false);
  });

  it('down on 5xx', async () => {
    server.use(
      http.get('/api/java/health', () => HttpResponse.json({ status: 'UP' }, { status: 503 })),
    );
    await expect(checkHealth('java')).resolves.toBe(false);
  });

  it('down on network error', async () => {
    server.use(http.get('/api/go/health', () => HttpResponse.error()));
    await expect(checkHealth('go')).resolves.toBe(false);
  });

  it('treats a hanging health check as down after 2s', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    server.use(
      http.get('/api/java/health', async () => {
        await delay('infinite');
        return HttpResponse.json({ status: 'UP' });
      }),
    );
    let settled: boolean | undefined;
    const pending = checkHealth('java').then((healthy) => {
      settled = healthy;
      return healthy;
    });
    await vi.advanceTimersByTimeAsync(HEALTH_TIMEOUT_MS - 1);
    expect(settled).toBeUndefined();
    await vi.advanceTimersByTimeAsync(1);
    await expect(pending).resolves.toBe(false);
    expect(HEALTH_TIMEOUT_MS).toBe(2000);
  });

  it('down when the caller aborts', async () => {
    server.use(
      http.get('/api/java/health', async () => {
        await delay('infinite');
        return HttpResponse.json({ status: 'UP' });
      }),
    );
    const controller = new AbortController();
    const pending = checkHealth('java', controller.signal);
    controller.abort();
    await expect(pending).resolves.toBe(false);
  });

  it('down immediately when the caller signal is already aborted', async () => {
    const controller = new AbortController();
    controller.abort();
    await expect(checkHealth('go', controller.signal)).resolves.toBe(false);
  });
});
