import { DEFAULT_TIMEOUT_MS, sendRequest, type FetchLike, type RawResponse } from '../api/http';
import { DEFAULT_RETRY_POLICY, planRetry, type RetryPolicyConfig } from '../api/retry-policy';
import type { AccessGrant } from '../auth/session-manager';
import type { ApiResult } from '../domain/result';
import { selectIncidentLocation } from './select-incident-location';

/** Why the provider could not be used. The UI only needs to know that it is "not available". */
export type GeocodingUnavailableReason =
  | 'timeout'
  | 'network'
  | 'rate_limited'
  | 'server'
  | 'unauthorized'
  | 'rejected'
  | 'contract'
  | 'empty_query';

/**
 * Port between the application and any geocoding provider. Failures are data, never exceptions:
 * a timeout, a 429 or a dropped connection becomes `{ kind: 'unavailable' }`.
 * `data` is still unknown: `selectIncidentLocation` decides whether it is usable.
 */
export type GeocodingLookup =
  | Readonly<{ kind: 'result'; data: unknown }>
  | Readonly<{ kind: 'unavailable'; reason: GeocodingUnavailableReason; status?: number }>;

export interface GeocodingPort {
  geocode(query: string): Promise<GeocodingLookup>;
}

/** Same normalization for the cache key and for deciding that a query is empty. */
export function normalizeQuery(query: string): string {
  return query.trim().toLowerCase();
}

type SessionLike = Readonly<{ accessToken(): Promise<AccessGrant | null> }>;

export type CourseGeocodingOptions = Readonly<{
  baseUrl: string;
  session: SessionLike;
  fetch?: FetchLike;
  timeoutMs?: number;
  /** Test-only header to select a controlled variant (slow, rate_limited, incomplete...). */
  scenario?: string;
  /** Bounded GET retries with `planRetry` (Retry-After, attempt limit). Omitted: one request. */
  retry?: Readonly<{ policy?: RetryPolicyConfig; sleep?: (ms: number) => Promise<void> }>;
}>;

function unavailableFrom(result: ApiResult<RawResponse>): GeocodingLookup {
  if (!result.ok) {
    const kind = result.error.kind;
    return { kind: 'unavailable', reason: kind === 'timeout' || kind === 'network' ? kind : 'contract' };
  }
  const { status, body } = result.value;
  if (status === 200) {
    return body === undefined ? { kind: 'unavailable', reason: 'contract', status } : { kind: 'result', data: body };
  }
  if (status === 429) return { kind: 'unavailable', reason: 'rate_limited', status };
  if (status >= 500) return { kind: 'unavailable', reason: 'server', status };
  if (status === 401 || status === 403) return { kind: 'unavailable', reason: 'unauthorized', status };
  return { kind: 'unavailable', reason: 'rejected', status };
}

/**
 * Adapter for the course's controlled provider double: `GET {baseUrl}/v1/geocoding?q=...` with the
 * session headers. It reuses the HTTP transport of `IncidentClient` (`sendRequest`, own timeout) and,
 * when `retry` is given, the same `planRetry` policy for the GET.
 */
export class CourseGeocodingAdapter implements GeocodingPort {
  private readonly fetchFn: FetchLike;

  constructor(private readonly options: CourseGeocodingOptions) {
    this.fetchFn = options.fetch ?? ((url, init) => fetch(url, init));
  }

  async geocode(query: string): Promise<GeocodingLookup> {
    if (normalizeQuery(query) === '') return { kind: 'unavailable', reason: 'empty_query' };
    const grant = await this.options.session.accessToken();
    if (!grant) return { kind: 'unavailable', reason: 'unauthorized' };

    const retry = this.options.retry;
    const sleep = retry?.sleep ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
    for (let attempt = 1; ; attempt += 1) {
      const result = await this.send(grant, query);
      const lookup = unavailableFrom(result);
      if (lookup.kind === 'result' || !retry) return lookup;
      const status = lookup.reason === 'timeout' || lookup.reason === 'network' ? 'timeout' : lookup.status;
      if (status === undefined) return lookup;
      const decision = planRetry(
        {
          method: 'GET',
          status,
          attempt,
          ...(result.ok && result.value.retryAfterMs !== null ? { retryAfterMs: result.value.retryAfterMs } : {}),
        },
        retry.policy ?? DEFAULT_RETRY_POLICY,
      );
      if (!decision.retry) return lookup;
      await sleep(decision.delayMs);
    }
  }

  private send(grant: AccessGrant, query: string): Promise<ApiResult<RawResponse>> {
    const headers: Record<string, string> = {
      Authorization: `Bearer ${grant.token}`,
      'X-Course-Actor': grant.actorId,
    };
    if (this.options.scenario !== undefined) headers['X-Course-Scenario'] = this.options.scenario;
    const url = `${this.options.baseUrl}/v1/geocoding?q=${encodeURIComponent(query.trim())}`;
    return sendRequest(this.fetchFn, url, { method: 'GET', headers }, this.options.timeoutMs ?? DEFAULT_TIMEOUT_MS);
  }
}

export type GeocodingCacheOptions = Readonly<{
  /** How long a valid result is reused. */
  ttlMs?: number;
  /** Small bound: the oldest entry is evicted first. */
  maxEntries?: number;
  /** Injectable clock so tests control expiry. */
  now?: () => number;
}>;

export const DEFAULT_GEOCODING_CACHE = { ttlMs: 10 * 60 * 1000, maxEntries: 20 } as const;

type CacheEntry = Readonly<{ value: Readonly<{ label: string; latitude: number; longitude: number }>; expiresAt: number }>;

/**
 * Cache in front of any GeocodingPort. Key: normalized query (`trim().toLowerCase()`).
 * Only results that `selectIncidentLocation` accepts are stored, and only `{ label, latitude,
 * longitude }`: never failures, invalid coordinates, tokens or actor data.
 */
export class CachedGeocoder implements GeocodingPort {
  private readonly entries = new Map<string, CacheEntry>();
  private readonly ttlMs: number;
  private readonly maxEntries: number;
  private readonly now: () => number;

  constructor(
    private readonly inner: GeocodingPort,
    options: GeocodingCacheOptions = {},
  ) {
    this.ttlMs = options.ttlMs ?? DEFAULT_GEOCODING_CACHE.ttlMs;
    this.maxEntries = Math.max(1, options.maxEntries ?? DEFAULT_GEOCODING_CACHE.maxEntries);
    this.now = options.now ?? (() => Date.now());
  }

  get size(): number {
    return this.entries.size;
  }

  async geocode(query: string): Promise<GeocodingLookup> {
    const key = normalizeQuery(query);
    const cached = this.entries.get(key);
    if (cached && cached.expiresAt > this.now()) return { kind: 'result', data: { ...cached.value } };
    if (cached) this.entries.delete(key);

    const lookup = await this.inner.geocode(query);
    if (lookup.kind === 'result' && key !== '') {
      const accepted = selectIncidentLocation(lookup.data, '');
      if (accepted.source === 'provider' && accepted.latitude !== undefined && accepted.longitude !== undefined) {
        if (this.entries.size >= this.maxEntries) {
          const oldest = this.entries.keys().next().value;
          if (oldest !== undefined) this.entries.delete(oldest);
        }
        this.entries.set(key, {
          value: { label: accepted.label, latitude: accepted.latitude, longitude: accepted.longitude },
          expiresAt: this.now() + this.ttlMs,
        });
      }
    }
    return lookup;
  }
}
