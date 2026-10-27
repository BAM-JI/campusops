import { failure, success, type ApiError, type ApiResult } from '../domain/result';

export type FetchLike = (url: string, init: RequestInit) => Promise<Response>;

export type RawResponse = Readonly<{
  status: number;
  /** `undefined` when the body was not valid JSON. */
  body: unknown;
  retryAfterMs: number | null;
}>;

export const DEFAULT_TIMEOUT_MS = 5000;

function parseRetryAfter(value: string | null): number | null {
  if (value === null) return null;
  const seconds = Number(value);
  return Number.isFinite(seconds) && seconds >= 0 ? seconds * 1000 : null;
}

/**
 * Sends one request with its own timeout (AbortController). It never throws:
 * a timeout or a dropped connection is returned as a typed error.
 */
export async function sendRequest(
  fetchFn: FetchLike,
  url: string,
  init: RequestInit,
  timeoutMs: number = DEFAULT_TIMEOUT_MS,
): Promise<ApiResult<RawResponse>> {
  const controller = new AbortController();
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, timeoutMs);
  try {
    const response = await fetchFn(url, { ...init, signal: controller.signal });
    const text = await response.text();
    let body: unknown;
    try {
      body = text.length === 0 ? null : JSON.parse(text);
    } catch {
      body = undefined;
    }
    return success({ status: response.status, body, retryAfterMs: parseRetryAfter(response.headers.get('retry-after')) });
  } catch {
    return failure(timedOut ? { kind: 'timeout' } : { kind: 'network' });
  } finally {
    clearTimeout(timer);
  }
}

function codeOf(body: unknown): string {
  return typeof body === 'object' && body !== null && 'code' in body && typeof body.code === 'string'
    ? body.code
    : 'unknown';
}

/** Maps a non-2xx status to the error taxonomy. */
export function errorFromStatus(response: RawResponse): ApiError {
  const { status, body } = response;
  if (status === 401) return { kind: 'unauthorized' };
  if (status === 403) return { kind: 'forbidden' };
  if (status === 404) return { kind: 'not_found' };
  if (status === 409) return { kind: 'conflict', code: codeOf(body) };
  if (status === 429) return { kind: 'rate_limited', retryAfterMs: response.retryAfterMs };
  if (status >= 500) return { kind: 'server', status };
  return { kind: 'rejected', status, code: codeOf(body) };
}
