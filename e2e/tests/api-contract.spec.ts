import { expect, test, type APIRequestContext } from '@playwright/test';

test.beforeEach(({}, testInfo) => {
  test.skip(testInfo.project.name !== 'chromium', 'API contract runs once, on chromium');
});

const ENDPOINT = '/api/v1/calculate';

async function postJson(request: APIRequestContext, body: unknown) {
  return request.post(ENDPOINT, { data: body });
}

async function postRaw(request: APIRequestContext, raw: string) {
  return request.post(ENDPOINT, { data: raw, headers: { 'content-type': 'application/json' } });
}

async function expectProblem(
  response: Awaited<ReturnType<typeof postJson>>,
  title: string,
): Promise<void> {
  expect(response.status()).toBe(400);
  expect(response.headers()['content-type']).toContain('application/problem+json');
  const body = await response.json();
  expect(body.title).toBe(title);
}

test('add [1e999999999, 0.1] -> Operand out of range', async ({ request }) => {
  const res = await postRaw(request, '{"operation":"add","operands":[1e999999999,0.1]}');
  await expectProblem(res, 'Operand out of range');
});

test('add ["1", 2] -> Malformed request', async ({ request }) => {
  await expectProblem(
    await postJson(request, { operation: 'add', operands: ['1', 2] }),
    'Malformed request',
  );
});

test('add [1, 2, 3] -> Invalid operand count', async ({ request }) => {
  await expectProblem(
    await postJson(request, { operation: 'add', operands: [1, 2, 3] }),
    'Invalid operand count',
  );
});

test('foo [2, 3] -> Unsupported operation', async ({ request }) => {
  await expectProblem(
    await postJson(request, { operation: 'foo', operands: [2, 3] }),
    'Unsupported operation',
  );
});

test('sqrt [-4] -> Invalid operand', async ({ request }) => {
  await expectProblem(await postJson(request, { operation: 'sqrt', operands: [-4] }), 'Invalid operand');
});

test('power [2, 0.5] -> Invalid operand', async ({ request }) => {
  await expectProblem(
    await postJson(request, { operation: 'power', operands: [2, 0.5] }),
    'Invalid operand',
  );
});

test('power [2, 1001] -> Operand out of range', async ({ request }) => {
  await expectProblem(
    await postJson(request, { operation: 'power', operands: [2, 1001] }),
    'Operand out of range',
  );
});

test('power [10, 100] -> Result out of range', async ({ request }) => {
  await expectProblem(
    await postJson(request, { operation: 'power', operands: [10, 100] }),
    'Result out of range',
  );
});

test('power [0, -1] -> Division by zero', async ({ request }) => {
  await expectProblem(
    await postJson(request, { operation: 'power', operands: [0, -1] }),
    'Division by zero',
  );
});

test('sqrt [1, 2] -> Invalid operand count', async ({ request }) => {
  await expectProblem(
    await postJson(request, { operation: 'sqrt', operands: [1, 2] }),
    'Invalid operand count',
  );
});

test('sqrt [1e999999999] -> Operand out of range', async ({ request }) => {
  const res = await postRaw(request, '{"operation":"sqrt","operands":[1e999999999]}');
  await expectProblem(res, 'Operand out of range');
});

for (const [operation, operands, result] of [
  ['power', [2, 10], '1024'],
  ['sqrt', [2], '1.4142135624'],
  ['percentage', [20, 150], '30'],
] as const) {
  test(`${operation} [${operands.join(', ')}] -> 200 "${result}"`, async ({ request }) => {
    const res = await postJson(request, { operation, operands });
    expect(res.status()).toBe(200);
    expect(await res.json()).toEqual({ operation, result });
  });
}

test('ADD [1, 2] -> Unsupported operation (case sensitive)', async ({ request }) => {
  await expectProblem(
    await postJson(request, { operation: 'ADD', operands: [1, 2] }),
    'Unsupported operation',
  );
});

test('extra field -> Malformed request', async ({ request }) => {
  await expectProblem(
    await postJson(request, { operation: 'add', operands: [1, 2], extra: true }),
    'Malformed request',
  );
});

test('broken JSON -> Malformed request', async ({ request }) => {
  await expectProblem(await postRaw(request, '{"operation":"add","operands":[1,'), 'Malformed request');
});

test('divide [1e999999999, 0] -> Operand out of range', async ({ request }) => {
  const res = await postRaw(request, '{"operation":"divide","operands":[1e999999999,0]}');
  await expectProblem(res, 'Operand out of range');
});

test('add [0.1, 0.2] -> 200 "0.3"', async ({ request }) => {
  const res = await postRaw(request, '{"operation":"add","operands":[0.1,0.2]}');
  expect(res.status()).toBe(200);
  expect(await res.json()).toEqual({ operation: 'add', result: '0.3' });
});

test('add [0e-999999999, 1] -> 200 "1" (zero exponent normalized)', async ({ request }) => {
  const res = await postRaw(request, '{"operation":"add","operands":[0e-999999999,1]}');
  expect(res.status()).toBe(200);
  expect(await res.json()).toEqual({ operation: 'add', result: '1' });
});
