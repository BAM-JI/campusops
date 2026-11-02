/** @jest-environment node */
import { IncidentClient, type AttemptRecord } from '../../src/api/incident-client';
import { SessionManager } from '../../src/auth/session-manager';
import { createMemorySessionStorage } from '../../src/auth/session-storage';
import { createFakeFetch, jsonResponse, LOGIN_RESPONSE, VALID_INCIDENT, type FakeHandler } from '../support/fake-fetch';

const BASE = 'http://backend.test';

/** Client with retries; the wait is recorded instead of slept, so the test checks the real delays instantly. */
async function retryingClient(handler: FakeHandler) {
  const fetch = createFakeFetch((call) =>
    call.url.endsWith('/v1/session/login') ? jsonResponse(200, LOGIN_RESPONSE) : handler(call),
  );
  const session = new SessionManager({ baseUrl: BASE, storage: createMemorySessionStorage(), fetch, now: () => 0 });
  await session.login('technician-1');
  const waits: number[] = [];
  const attempts: AttemptRecord[] = [];
  const client = new IncidentClient({
    baseUrl: BASE,
    session,
    fetch,
    timeoutMs: 50,
    retry: {
      sleep: async (ms) => {
        waits.push(ms);
      },
      onAttempt: (record) => attempts.push(record),
    },
  });
  const calls = () => fetch.calls.filter((call) => call.url.includes('/v1/incidents'));
  return { client, waits, attempts, calls };
}

test('GET retries a 500 and then succeeds within the limit', async () => {
  let failures = 2;
  const { client, attempts, waits } = await retryingClient(() =>
    failures-- > 0 ? jsonResponse(500, { code: 'controlled_failure' }) : jsonResponse(200, VALID_INCIDENT),
  );
  await expect(client.detail('campus-inc-001')).resolves.toMatchObject({ ok: true, value: { id: 'campus-inc-001' } });
  expect(attempts.map((record) => [record.attempt, record.outcome, record.retry])).toEqual([
    [1, 'http_500', true],
    [2, 'http_500', true],
    [3, 'http_200', false],
  ]);
  expect(waits).toEqual([250, 500]);
});

test('a server that keeps failing receives at most 4 requests', async () => {
  const { client, calls, waits } = await retryingClient(() => jsonResponse(503, { code: 'unavailable' }));
  await expect(client.list()).resolves.toEqual({ ok: false, error: { kind: 'server', status: 503 } });
  expect(calls()).toHaveLength(4);
  expect(waits).toEqual([250, 500, 1000]);
});

test('429 waits exactly Retry-After before the next attempt', async () => {
  let limited = true;
  const { client, waits } = await retryingClient(() => {
    if (!limited) return jsonResponse(200, { items: [VALID_INCIDENT] });
    limited = false;
    return jsonResponse(429, { code: 'rate_limited' }, { 'retry-after': '1' });
  });
  await expect(client.list()).resolves.toMatchObject({ ok: true });
  expect(waits).toEqual([1000]);
});

test('timeouts and dropped connections are retried, then reported', async () => {
  const hanging = await retryingClient(() => 'hang');
  await expect(hanging.client.list()).resolves.toEqual({ ok: false, error: { kind: 'timeout' } });
  expect(hanging.calls()).toHaveLength(4);
  const offline = await retryingClient(() => 'network-error');
  await expect(offline.client.list()).resolves.toEqual({ ok: false, error: { kind: 'network' } });
  expect(offline.calls()).toHaveLength(4);
});

test('a POST retry repeats the same Idempotency-Key and the same body', async () => {
  let first = true;
  const { client, calls } = await retryingClient(() => {
    if (first) {
      first = false;
      return 'hang';
    }
    return jsonResponse(200, { incident: { ...VALID_INCIDENT, version: 2, status: 'in_progress' }, operationId: 'op-week09-start-1', duplicate: true });
  });
  await expect(client.act('campus-inc-001', 'start', 1, {}, 'op-week09-start-1')).resolves.toMatchObject({
    ok: true,
    value: { duplicate: true },
  });
  const [a, b] = calls();
  expect(a?.headers['Idempotency-Key']).toBe('op-week09-start-1');
  expect(b?.headers['Idempotency-Key']).toBe('op-week09-start-1');
  expect(b?.body).toEqual(a?.body);
});

test('business errors are answered once, without retries', async () => {
  for (const [status, code] of [[403, 'forbidden'], [409, 'version_conflict'], [422, 'invalid_incident']] as const) {
    const { client, calls, waits } = await retryingClient(() => jsonResponse(status, { code }));
    await client.act('campus-inc-001', 'start', 1, {}, `op-week09-${status}`);
    expect(calls()).toHaveLength(1);
    expect(waits).toEqual([]);
  }
});

test('attempt records are sanitized: no token, actor, key or incident id', async () => {
  const { client, attempts } = await retryingClient(() => jsonResponse(500, { code: 'controlled_failure' }));
  await client.act('campus-inc-001', 'resolve', 2, { diagnosis: 'Cable ficticio' }, 'op-week09-resolve-x');
  expect(attempts).toHaveLength(4);
  expect(attempts[0]?.route).toBe('/v1/incidents/:id/actions');
  const serialized = JSON.stringify(attempts);
  for (const secret of ['course-valid-token', 'technician-1', 'campus-inc-001', 'op-week09-resolve-x', 'Cable ficticio']) {
    expect(serialized).not.toContain(secret);
  }
});
