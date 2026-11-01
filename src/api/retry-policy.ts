export type RetryInput = Readonly<{
  method: 'GET' | 'POST';
  /** HTTP status of the failed attempt, or 'timeout' when no response arrived (timeout or dropped connection). */
  status: number | 'timeout';
  /** 1-based number of the attempt that just failed. */
  attempt: number;
  retryAfterMs?: number;
  idempotencyKey?: string;
}>;

export type RetryDecision = Readonly<{ retry: boolean; delayMs: number; requiresStableIdempotencyKey: boolean }>;

export type RetryPolicyConfig = Readonly<{
  /** No retry is planned once this attempt has failed (published limit: attempt 4). */
  maxAttempts: number;
  /** First progressive wait; doubles on each attempt. */
  baseDelayMs: number;
  /** Cap for the progressive wait. */
  maxDelayMs: number;
  /** A Retry-After longer than this is not waited for: the caller reports the failure instead. */
  maxRetryAfterMs: number;
  /** Optional jitter, injectable so tests stay deterministic. Must return a finite delay >= 0. */
  jitter?: (delayMs: number, attempt: number) => number;
}>;

export const DEFAULT_RETRY_POLICY: RetryPolicyConfig = {
  maxAttempts: 4,
  baseDelayMs: 250,
  maxDelayMs: 4000,
  maxRetryAfterMs: 30_000,
};

/** Transient failures: no answer, rate limited or the server could not process it right now. */
const RETRYABLE_STATUS: readonly number[] = [408, 429, 500, 502, 503, 504];

const NO_RETRY: RetryDecision = { retry: false, delayMs: 0, requiresStableIdempotencyKey: false };

function isRetryable(status: number | 'timeout'): boolean {
  return status === 'timeout' || RETRYABLE_STATUS.includes(status);
}

function hasStableKey(key: string | undefined): boolean {
  return typeof key === 'string' && key.trim().length > 0;
}

function finiteDelay(value: number): number {
  return Number.isFinite(value) && value > 0 ? Math.round(value) : 0;
}

/**
 * Decides whether a failed request may be repeated and how long to wait first.
 * - Business errors (400, 401, 403, 404, 409, 422...) are never retried: repeating cannot fix them.
 * - From attempt `maxAttempts` on there is no retry, so no request loops forever.
 * - A POST is only repeated with a stable Idempotency-Key, so the server applies its effect once.
 * - A valid Retry-After is honored; otherwise the wait grows exponentially up to `maxDelayMs`.
 */
export function planRetry(input: RetryInput, config: RetryPolicyConfig = DEFAULT_RETRY_POLICY): RetryDecision {
  if (!Number.isInteger(input.attempt) || input.attempt < 1 || input.attempt >= config.maxAttempts) return NO_RETRY;
  if (!isRetryable(input.status)) return NO_RETRY;
  if (input.method === 'POST' && !hasStableKey(input.idempotencyKey)) {
    return { retry: false, delayMs: 0, requiresStableIdempotencyKey: true };
  }

  const retryAfter = input.retryAfterMs;
  if (retryAfter !== undefined && Number.isFinite(retryAfter) && retryAfter >= 0 && (input.status === 429 || input.status === 503)) {
    if (retryAfter > config.maxRetryAfterMs) return NO_RETRY;
    return { retry: true, delayMs: Math.round(retryAfter), requiresStableIdempotencyKey: false };
  }

  const progressive = Math.min(config.baseDelayMs * 2 ** (input.attempt - 1), config.maxDelayMs);
  const withJitter = config.jitter ? Math.min(finiteDelay(config.jitter(progressive, input.attempt)), config.maxDelayMs) : progressive;
  return { retry: true, delayMs: finiteDelay(withJitter), requiresStableIdempotencyKey: false };
}
