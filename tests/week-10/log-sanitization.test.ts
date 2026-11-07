/** @jest-environment node */
import { IncidentClient, type AttemptRecord } from '../../src/api/incident-client';
import { SessionManager } from '../../src/auth/session-manager';
import { createMemorySessionStorage } from '../../src/auth/session-storage';
import { redactForTelemetry } from '../../src/observability/redact';
import { createTelemetry } from '../../src/observability/telemetry';
import { createFakeFetch, jsonResponse, LOGIN_RESPONSE, VALID_INCIDENT, type FakeHandler } from '../support/fake-fetch';

const BASE = 'http://backend.test';

/** Records telemetry and waits without using a real backend or sleeping. */
async function clientWithTelemetry(handler: FakeHandler, withRetry = false) {
  const fetch = createFakeFetch((call) =>
    call.url.endsWith('/v1/session/login') ? jsonResponse(200, LOGIN_RESPONSE) : handler(call),
  );
  const session = new SessionManager({ baseUrl: BASE, storage: createMemorySessionStorage(), fetch, now: () => 0 });
  await session.login('technician-1');
  const records: Readonly<Record<string, unknown>>[] = [];
  const attempts: AttemptRecord[] = [];
  const waits: number[] = [];
  const client = new IncidentClient({
    baseUrl: BASE,
    session,
    fetch,
    timeoutMs: 50,
    telemetrySink: (record) => records.push(record),
    ...(withRetry ? {
      retry: {
        sleep: async (ms: number) => { waits.push(ms); },
        onAttempt: (record: AttemptRecord) => attempts.push(record),
      },
    } : {}),
  });
  const calls = () => fetch.calls.filter((call) => call.url.includes('/v1/incidents'));
  return { client, records, attempts, waits, calls };
}

test('sanitization redacts nested sensitive keys and arrays while preserving technical context', () => {
  expect(redactForTelemetry({
    outcome: 'timeout',
    attempt: 2,
    Authorization: 'Bearer secret',
    nested: { access_token: 'access-secret', 'Refresh-Token': 'refresh-secret', location: 'Private building' },
    entries: [{ actorId: 'private-actor', diagnosis: 'Private diagnosis', status: 503 }],
    idempotencyKey: 'private-key',
  })).toEqual({
    outcome: 'timeout',
    attempt: 2,
    Authorization: '[REDACTED]',
    nested: { access_token: '[REDACTED]', 'Refresh-Token': '[REDACTED]', location: '[REDACTED]' },
    entries: [{ actorId: '[REDACTED]', diagnosis: '[REDACTED]', status: 503 }],
    idempotencyKey: '[REDACTED]',
  });
});

test('sanitization leaves the original object and nested arrays unchanged', () => {
  const nested = Object.freeze({ accessToken: 'original-token', status: 503 });
  const entries = Object.freeze([nested, null]);
  const input = Object.freeze({ entries, attempt: 1 });
  const snapshot = JSON.stringify(input);
  const sanitized = redactForTelemetry(input);
  expect(sanitized).toEqual({ entries: [{ accessToken: '[REDACTED]', status: 503 }, null], attempt: 1 });
  expect(JSON.stringify(input)).toBe(snapshot);
  expect(sanitized).not.toBe(input);
  expect(sanitized).toHaveProperty('entries', expect.not.arrayContaining([expect.objectContaining({ accessToken: 'original-token' })]));
});

test('the telemetry sink receives a sanitized copy without mutating the event', () => {
  const records: Readonly<Record<string, unknown>>[] = [];
  const event = Object.freeze({
    event: 'incident.request.attempt', correlationId: 'corr-test', route: '/v1/incidents',
    attempt: 1, outcome: 'http_200', durationMs: 0, accessToken: 'private-token',
  });
  createTelemetry((record) => records.push(record)).logEvent(event);
  expect(records).toEqual([{ ...event, accessToken: '[REDACTED]' }]);
  expect(records[0]).not.toBe(event);
  expect(event.accessToken).toBe('private-token');
});

test.each([false, true])('request telemetry excludes sensitive request data (retry: %s)', async (withRetry) => {
  const { client, records, calls } = await clientWithTelemetry(() => jsonResponse(503, { code: 'unavailable' }), withRetry);
  const payload = Object.freeze({ diagnosis: 'Private diagnosis', location: 'Private building' });
  await expect(client.act('campus-inc-001', 'resolve', 2, payload, 'op-week10-private')).resolves.toMatchObject({ ok: false });
  expect(records).toHaveLength(withRetry ? 4 : 1);
  for (const record of records) {
    expect(record).toEqual({
      event: 'incident.request.attempt', correlationId: expect.any(String),
      route: '/v1/incidents/:id/actions', attempt: expect.any(Number),
      outcome: 'http_503', durationMs: expect.any(Number),
    });
    expect(record.durationMs).toBeGreaterThanOrEqual(0);
  }
  const serialized = JSON.stringify(records);
  for (const secret of ['course-valid-token', 'technician-1', 'campus-inc-001', 'op-week10-private', 'Private diagnosis', 'Private building']) {
    expect(serialized).not.toContain(secret);
  }
  expect(payload).toEqual({ diagnosis: 'Private diagnosis', location: 'Private building' });
  for (const call of calls()) {
    expect(call.headers).toMatchObject({ Authorization: 'Bearer course-valid-token', 'Idempotency-Key': 'op-week10-private' });
    expect(call.body).toEqual({ ...payload, action: 'resolve', baseVersion: 2 });
  }
});

test('all retries share one correlation id and preserve onAttempt and delays', async () => {
  let failures = 2;
  const { client, records, attempts, waits } = await clientWithTelemetry(() =>
    failures-- > 0 ? jsonResponse(500, { code: 'controlled_failure' }) : jsonResponse(200, VALID_INCIDENT), true,
  );
  await expect(client.detail('campus-inc-001')).resolves.toMatchObject({ ok: true });
  expect(records.map((record) => [record.attempt, record.outcome])).toEqual([
    [1, 'http_500'], [2, 'http_500'], [3, 'http_200'],
  ]);
  expect(records[0]?.correlationId).toEqual(expect.stringMatching(/^corr-.+/));
  expect(new Set(records.map((record) => record.correlationId)).size).toBe(1);
  expect(attempts.map((record) => [record.attempt, record.outcome, record.retry])).toEqual([
    [1, 'http_500', true], [2, 'http_500', true], [3, 'http_200', false],
  ]);
  expect(waits).toEqual([250, 500]);
});

test.each([false, true])('separate concurrent operations receive different correlation ids (retry: %s)', async (withRetry) => {
  const { client, records } = await clientWithTelemetry(() => jsonResponse(200, VALID_INCIDENT), withRetry);
  const results = await Promise.all([client.detail('campus-inc-001'), client.detail('campus-inc-001')]);
  expect(results.every((result) => result.ok)).toBe(true);
  expect(records).toHaveLength(2);
  expect(records.map((record) => record.attempt)).toEqual([1, 1]);
  for (const record of records) expect(record.correlationId).toEqual(expect.stringMatching(/^corr-.+/));
  expect(new Set(records.map((record) => record.correlationId)).size).toBe(2);
});
