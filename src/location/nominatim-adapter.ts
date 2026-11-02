import type { GeocodingLookup, GeocodingPort } from './geocoding-adapter';

/**
 * Adapter for a real public provider: OpenStreetMap Nominatim
 * (`https://nominatim.openstreetmap.org/search?format=json&limit=1&q=...`).
 * Its usage policy asks for an identifying User-Agent and at most 1 request per second, and
 * forbids heavy or bulk use. CampusOps only sends fictitious or generic queries, and automated
 * tests never call it: they use the course double (`CourseGeocodingAdapter`).
 *
 * Self-contained on purpose (type-only imports), so `scripts/geocode-real-once.mjs` can run it
 * once with Node for the evidence of a real execution.
 */
export type NominatimOptions = Readonly<{
  userAgent: string;
  fetch?: (url: string, init: RequestInit) => Promise<Response>;
  baseUrl?: string;
  timeoutMs?: number;
  /** Minimum time between two requests (provider policy: 1 per second). */
  minIntervalMs?: number;
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
}>;

export const NOMINATIM_BASE_URL = 'https://nominatim.openstreetmap.org';

/** Maps the first Nominatim hit (`display_name`, `lat`, `lon` as strings) to `{ label, latitude, longitude }`. */
export function mapNominatimResult(body: unknown): unknown {
  if (!Array.isArray(body) || body.length === 0) return null;
  const first: unknown = body[0];
  if (typeof first !== 'object' || first === null) return null;
  const { display_name: label, lat, lon } = first as Record<string, unknown>;
  return {
    label,
    latitude: typeof lat === 'string' ? Number(lat) : lat,
    longitude: typeof lon === 'string' ? Number(lon) : lon,
  };
}

export class NominatimGeocodingAdapter implements GeocodingPort {
  private lastRequestAt: number | null = null;
  private readonly options: NominatimOptions;

  constructor(options: NominatimOptions) {
    this.options = options;
  }

  async geocode(query: string): Promise<GeocodingLookup> {
    const text = query.trim();
    if (text === '') return { kind: 'unavailable', reason: 'empty_query' };
    await this.respectRateLimit();

    const fetchFn = this.options.fetch ?? ((url: string, init: RequestInit) => fetch(url, init));
    const controller = new AbortController();
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      controller.abort();
    }, this.options.timeoutMs ?? 5000);
    try {
      const url = `${this.options.baseUrl ?? NOMINATIM_BASE_URL}/search?format=json&limit=1&q=${encodeURIComponent(text)}`;
      const response = await fetchFn(url, {
        method: 'GET',
        headers: { 'User-Agent': this.options.userAgent, Accept: 'application/json' },
        signal: controller.signal,
      });
      if (response.status === 429) return { kind: 'unavailable', reason: 'rate_limited', status: 429 };
      if (response.status >= 500) return { kind: 'unavailable', reason: 'server', status: response.status };
      if (response.status !== 200) return { kind: 'unavailable', reason: 'rejected', status: response.status };
      let body: unknown;
      try {
        body = await response.json();
      } catch {
        return { kind: 'unavailable', reason: 'contract', status: 200 };
      }
      return { kind: 'result', data: mapNominatimResult(body) };
    } catch {
      return { kind: 'unavailable', reason: timedOut ? 'timeout' : 'network' };
    } finally {
      clearTimeout(timer);
    }
  }

  private async respectRateLimit(): Promise<void> {
    const now = this.options.now ?? (() => Date.now());
    const sleep = this.options.sleep ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
    const minInterval = this.options.minIntervalMs ?? 1000;
    if (this.lastRequestAt !== null) {
      const wait = this.lastRequestAt + minInterval - now();
      if (wait > 0) await sleep(wait);
    }
    this.lastRequestAt = now();
  }
}
