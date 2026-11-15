import { readFileSync } from 'node:fs';
import http from 'node:http';
import { expect, test } from '@playwright/test';

/**
 * Java/Go parity through nginx: every `viaProxy` case of `contract/parity-cases.json` goes to
 * `/api/java…` and `/api/go…`, and both answers must equal each other and the expected one
 * (status, exact Content-Type, `Allow` when expected, raw body bytes). Node's `http` module is used
 * instead of Playwright's request API so the headers sent are exactly the case's (no implicit
 * Content-Type).
 */

interface ParityCase {
  name: string;
  viaProxy: boolean;
  request: { method: string; path: string; headers: Record<string, string>; body?: string };
  expected: { status: number; contentType: string; rawBody: string; allow?: string };
}

interface RawResponse {
  status: number;
  contentType: string | undefined;
  allow: string | undefined;
  body: Buffer;
}

type Backend = 'java' | 'go';

const BACKENDS: readonly Backend[] = ['java', 'go'];

const cases: ParityCase[] = JSON.parse(
  readFileSync(new URL('../../contract/parity-cases.json', import.meta.url), 'utf8'),
) as ParityCase[];
const proxied = cases.filter((c) => c.viaProxy);

/** `/api/v1/...` → `/api/{backend}/v1/...`; the actuator health → `/api/{backend}/health`. */
function proxiedPath(path: string, backend: Backend): string {
  if (path === '/actuator/health') return `/api/${backend}/health`;
  if (path.startsWith('/api/')) return `/api/${backend}/${path.slice('/api/'.length)}`;
  throw new Error(`No proxy mapping for ${path}`);
}

function send(baseURL: string, c: ParityCase, backend: Backend): Promise<RawResponse> {
  const url = new URL(proxiedPath(c.request.path, backend), baseURL);
  const body = c.request.body === undefined ? undefined : Buffer.from(c.request.body, 'utf8');
  const headers: Record<string, string | number> = { ...c.request.headers };
  if (body !== undefined) headers['Content-Length'] = body.length;
  return new Promise((resolve, reject) => {
    const req = http.request(url, { method: c.request.method, headers, agent: false }, (res) => {
      const chunks: Buffer[] = [];
      res.on('data', (chunk: Buffer) => chunks.push(chunk));
      res.on('end', () => {
        const allow = res.headers['allow'];
        resolve({
          status: res.statusCode ?? 0,
          contentType: res.headers['content-type'],
          allow: Array.isArray(allow) ? allow.join(', ') : allow,
          body: Buffer.concat(chunks),
        });
      });
      res.on('error', reject);
    });
    req.setTimeout(10_000, () => req.destroy(new Error(`timeout: ${c.name} on ${backend}`)));
    req.on('error', reject);
    req.end(body);
  });
}

/** Comparable view; the body stays as bytes (shown as UTF-8 only in failure diffs). */
function view(res: RawResponse, withAllow: boolean) {
  return {
    status: res.status,
    contentType: res.contentType,
    ...(withAllow ? { allow: res.allow } : {}),
    body: res.body.toString('utf8'),
  };
}

test.beforeEach(({}, testInfo) => {
  test.skip(testInfo.project.name !== 'chromium', 'Parity runs once, on chromium');
});

test('the contract has 78 proxied cases', () => {
  expect(cases).toHaveLength(80);
  expect(proxied).toHaveLength(78);
  expect(cases.filter((c) => !c.viaProxy).map((c) => c.name)).toEqual([
    '404 trailing slash',
    'query string ignored',
  ]);
});

for (const c of proxied) {
  test(`parity: ${c.name}`, async ({ baseURL }) => {
    expect(baseURL).toBeTruthy();
    const withAllow = c.expected.allow !== undefined;
    const expected = {
      status: c.expected.status,
      contentType: c.expected.contentType,
      ...(withAllow ? { allow: c.expected.allow } : {}),
      body: c.expected.rawBody,
    };
    const expectedBytes = Buffer.from(c.expected.rawBody, 'utf8');

    const [java, go] = await Promise.all(BACKENDS.map((b) => send(baseURL!, c, b)));

    for (const [backend, res] of [
      ['java', java],
      ['go', go],
    ] as const) {
      expect(view(res, withAllow), `${backend} == expected`).toEqual(expected);
      expect(res.body.equals(expectedBytes), `${backend} raw body bytes == expected`).toBe(true);
    }
    expect(view(go, withAllow), 'go == java').toEqual(view(java, withAllow));
    expect(go.body.equals(java.body), 'go raw body bytes == java').toBe(true);
  });
}
