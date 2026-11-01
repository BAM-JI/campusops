/** @jest-environment node */
import { DEFAULT_RETRY_POLICY, planRetry } from '../../src/api/retry-policy';

const KEY = 'op-resolve-campus-inc-001';

test('stops retrying from attempt 4', () => {
  expect(planRetry({ method: 'GET', status: 503, attempt: 3 }).retry).toBe(true);
  for (const attempt of [4, 5, 100]) {
    expect(planRetry({ method: 'GET', status: 503, attempt })).toEqual({ retry: false, delayMs: 0, requiresStableIdempotencyKey: false });
    expect(planRetry({ method: 'POST', status: 'timeout', attempt, idempotencyKey: KEY }).retry).toBe(false);
  }
  for (const attempt of [0, -1, 1.5, Number.NaN]) {
    expect(planRetry({ method: 'GET', status: 503, attempt }).retry).toBe(false);
  }
});

test('honors Retry-After and keeps delays finite', () => {
  expect(planRetry({ method: 'GET', status: 429, attempt: 1, retryAfterMs: 800 })).toEqual({
    retry: true,
    delayMs: 800,
    requiresStableIdempotencyKey: false,
  });
  expect(planRetry({ method: 'GET', status: 503, attempt: 2, retryAfterMs: 1000 }).delayMs).toBe(1000);
  // A wait longer than the configured cap is not honored: the caller reports the failure instead.
  expect(planRetry({ method: 'GET', status: 429, attempt: 1, retryAfterMs: 120_000 }).retry).toBe(false);
  // An invalid Retry-After falls back to the progressive wait.
  for (const retryAfterMs of [Number.NaN, Number.POSITIVE_INFINITY, -5]) {
    const decision = planRetry({ method: 'GET', status: 429, attempt: 1, retryAfterMs });
    expect(decision).toEqual({ retry: true, delayMs: DEFAULT_RETRY_POLICY.baseDelayMs, requiresStableIdempotencyKey: false });
  }
});

test('uses progressive backoff without Retry-After', () => {
  const delays = [1, 2, 3].map((attempt) => planRetry({ method: 'GET', status: 'timeout', attempt }).delayMs);
  expect(delays).toEqual([250, 500, 1000]);
  const capped = planRetry(
    { method: 'GET', status: 500, attempt: 3 },
    { ...DEFAULT_RETRY_POLICY, baseDelayMs: 3000, maxDelayMs: 5000 },
  );
  expect(capped.delayMs).toBe(5000);
  const jittered = planRetry(
    { method: 'GET', status: 500, attempt: 1 },
    { ...DEFAULT_RETRY_POLICY, jitter: () => Number.POSITIVE_INFINITY },
  );
  expect(Number.isFinite(jittered.delayMs)).toBe(true);
});

test('never retries a POST without a stable idempotency key', () => {
  for (const idempotencyKey of [undefined, '', '   ']) {
    expect(planRetry({ method: 'POST', status: 503, attempt: 1, ...(idempotencyKey === undefined ? {} : { idempotencyKey }) })).toEqual({
      retry: false,
      delayMs: 0,
      requiresStableIdempotencyKey: true,
    });
  }
  expect(planRetry({ method: 'POST', status: 'timeout', attempt: 1, idempotencyKey: KEY })).toMatchObject({
    retry: true,
    requiresStableIdempotencyKey: false,
  });
});

test('does not retry business errors (403, 409, 422)', () => {
  for (const status of [400, 401, 403, 404, 409, 422]) {
    expect(planRetry({ method: 'GET', status, attempt: 1 }).retry).toBe(false);
    expect(planRetry({ method: 'POST', status, attempt: 1, idempotencyKey: KEY }).retry).toBe(false);
  }
});

test('limits are configurable', () => {
  const twoAttempts = { ...DEFAULT_RETRY_POLICY, maxAttempts: 2 };
  expect(planRetry({ method: 'GET', status: 503, attempt: 1 }, twoAttempts).retry).toBe(true);
  expect(planRetry({ method: 'GET', status: 503, attempt: 2 }, twoAttempts).retry).toBe(false);
});
