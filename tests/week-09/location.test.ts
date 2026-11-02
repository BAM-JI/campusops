/** @jest-environment node */
import type { FetchLike } from '../../src/api/http';
import { ResolveIncidentLocationUseCase } from '../../src/application/location-usecases';
import { SessionManager } from '../../src/auth/session-manager';
import { createMemorySessionStorage } from '../../src/auth/session-storage';
import {
  CachedGeocoder,
  CourseGeocodingAdapter,
  type CourseGeocodingOptions,
  type GeocodingLookup,
  type GeocodingPort,
} from '../../src/location/geocoding-adapter';
import { mapNominatimResult, NominatimGeocodingAdapter } from '../../src/location/nominatim-adapter';
import { selectIncidentLocation } from '../../src/location/select-incident-location';
import { nodeFetch, startCourseBackend, type RunningBackend } from '../support/course-backend';

// Fictitious data only: the course double never queries real places.
const TYPED = 'Edificio de prueba A, Laboratorio ficticio';

let backend: RunningBackend;

beforeAll(async () => {
  backend = await startCourseBackend();
});

afterAll(async () => {
  await backend.stop();
});

/** Counts the requests that reach the provider, without logging queries or tokens. */
function countingFetch(inner: FetchLike = nodeFetch): { fetch: FetchLike; calls: () => number } {
  let calls = 0;
  return {
    fetch: (url, init) => {
      calls += 1;
      return inner(url, init);
    },
    calls: () => calls,
  };
}

async function adapter(options: Partial<CourseGeocodingOptions> = {}): Promise<CourseGeocodingAdapter> {
  const session = new SessionManager({ baseUrl: backend.baseUrl, storage: createMemorySessionStorage(), fetch: nodeFetch });
  const login = await session.login('reporter-1');
  if (!login.ok) throw new Error('login failed');
  return new CourseGeocodingAdapter({ baseUrl: backend.baseUrl, session, fetch: nodeFetch, ...options });
}

test('valid geocoding is accepted from the provider', async () => {
  const useCase = new ResolveIncidentLocationUseCase(await adapter({ scenario: 'success' }));
  await expect(useCase.execute(TYPED)).resolves.toEqual({
    location: { source: 'provider', label: 'Edificio de prueba A', latitude: 0, longitude: 0 },
    notice: 'provider',
  });

  // Range limits are inclusive.
  expect(selectIncidentLocation({ label: 'Borde', latitude: -90, longitude: 180 }, 'Manual')).toEqual({
    source: 'provider', label: 'Borde', latitude: -90, longitude: 180,
  });
});

test('incomplete or invalid coordinates fall back to the manual label', async () => {
  for (const scenario of ['incomplete', 'nullable', 'invalid_coordinates', 'malformed']) {
    const useCase = new ResolveIncidentLocationUseCase(await adapter({ scenario }));
    const resolved = await useCase.execute(TYPED);
    // toEqual with no latitude/longitude keys: no invented coordinates.
    expect(resolved.location).toEqual({ source: 'manual', label: TYPED });
  }

  const invalid: unknown[] = [
    null,
    undefined,
    'Edificio',
    [],
    { status: 429 },
    { label: 'Incompleta' },
    { label: '', latitude: 0, longitude: 0 },
    { label: '   ', latitude: 0, longitude: 0 },
    { label: 'Fuera', latitude: 91, longitude: 0 },
    { label: 'Fuera', latitude: 0, longitude: -180.5 },
    { label: 'Texto', latitude: '0', longitude: '0' },
    { label: 'NaN', latitude: Number.NaN, longitude: 0 },
    { label: 'Inf', latitude: 0, longitude: Number.POSITIVE_INFINITY },
    { label: 42, latitude: 0, longitude: 0 },
  ];
  for (const value of invalid) {
    expect(selectIncidentLocation(value, 'Edificio manual')).toEqual({ source: 'manual', label: 'Edificio manual' });
  }
});

test('timeout falls back to manual without inventing coordinates', async () => {
  // The double answers after 1200 ms; the client gives up at 300 ms.
  const useCase = new ResolveIncidentLocationUseCase(await adapter({ scenario: 'slow', timeoutMs: 300 }));
  await expect(useCase.execute(TYPED)).resolves.toEqual({
    location: { source: 'manual', label: TYPED },
    notice: 'provider_unavailable',
  });
});

test('429 honors Retry-After and then falls back to manual', async () => {
  const counter = countingFetch();
  const waits: number[] = [];
  const geocoder = await adapter({
    scenario: 'rate_limited',
    fetch: counter.fetch,
    retry: { sleep: async (ms) => void waits.push(ms) },
  });

  await expect(geocoder.geocode(TYPED)).resolves.toEqual({ kind: 'unavailable', reason: 'rate_limited', status: 429 });
  // Retry-After: 1 s from the double; no retry from attempt 4, so at most 4 requests.
  expect(waits).toEqual([1000, 1000, 1000]);
  expect(counter.calls()).toBe(4);

  const resolved = await new ResolveIncidentLocationUseCase(geocoder).execute(TYPED);
  expect(resolved).toEqual({ location: { source: 'manual', label: TYPED }, notice: 'provider_unavailable' });
});

test('disconnection falls back to manual', async () => {
  const dropped: FetchLike = () => Promise.reject(new TypeError('fetch failed'));
  const waits: number[] = [];
  const geocoder = await adapter({ fetch: dropped, retry: { sleep: async (ms) => void waits.push(ms) } });

  await expect(geocoder.geocode(TYPED)).resolves.toEqual({ kind: 'unavailable', reason: 'network' });
  expect(waits).toEqual([250, 500, 1000]);
  await expect(new ResolveIncidentLocationUseCase(geocoder).execute(TYPED)).resolves.toEqual({
    location: { source: 'manual', label: TYPED },
    notice: 'provider_unavailable',
  });

  // A provider error (500) is also "not available", never an exception for the screen.
  const failing = await adapter({ scenario: 'server_error' });
  await expect(failing.geocode(TYPED)).resolves.toEqual({ kind: 'unavailable', reason: 'server', status: 500 });
});

test('cache returns a valid result without calling the provider again', async () => {
  const counter = countingFetch();
  let clock = 1_000;
  const cached = new CachedGeocoder(await adapter({ scenario: 'success', fetch: counter.fetch }), {
    ttlMs: 60_000,
    now: () => clock,
  });

  const first = await cached.geocode('  Edificio de prueba A ');
  const second = await cached.geocode('edificio de prueba a');
  expect(counter.calls()).toBe(1);
  expect(second).toEqual(first);
  expect(second).toEqual({ kind: 'result', data: { label: 'Edificio de prueba A', latitude: 0, longitude: 0 } });

  clock += 60_001; // TTL expired: the provider is asked again.
  await cached.geocode('Edificio de prueba A');
  expect(counter.calls()).toBe(2);
});

test('cache never stores failures or invalid results', async () => {
  const answers: GeocodingLookup[] = [
    { kind: 'unavailable', reason: 'timeout' },
    { kind: 'unavailable', reason: 'rate_limited', status: 429 },
    { kind: 'result', data: { label: 'Zona ficticia', latitude: 999, longitude: null } },
    { kind: 'result', data: { label: 'Zona ficticia' } },
    { kind: 'result', data: null },
  ];
  let calls = 0;
  const provider: GeocodingPort = {
    geocode: async () => answers[calls++] ?? { kind: 'unavailable', reason: 'server', status: 500 },
  };
  const cached = new CachedGeocoder(provider);
  for (let index = 0; index < answers.length; index += 1) {
    await expect(cached.geocode('Zona ficticia')).resolves.toEqual(answers[index]);
  }
  expect(calls).toBe(answers.length);
  expect(cached.size).toBe(0);

  // Only label and coordinates are kept, and the cache is small (oldest entry evicted).
  const extra: GeocodingPort = {
    geocode: async (query) => ({
      kind: 'result',
      data: { label: query, latitude: 1, longitude: 2, accessToken: 'never-cached', actorId: 'reporter-1' },
    }),
  };
  const small = new CachedGeocoder(extra, { maxEntries: 2 });
  await small.geocode('Zona A');
  await small.geocode('Zona B');
  await small.geocode('Zona C');
  expect(small.size).toBe(2);
  await expect(small.geocode('zona c')).resolves.toEqual({ kind: 'result', data: { label: 'Zona C', latitude: 1, longitude: 2 } });
});

test('the real provider adapter maps Nominatim answers through the same rules', () => {
  // Shape documented by Nominatim (lat/lon as strings). Fictitious values; no network.
  const mapped = mapNominatimResult([{ display_name: 'Biblioteca ficticia', lat: '19.5', lon: '-99.1' }]);
  expect(selectIncidentLocation(mapped, 'Manual')).toEqual({
    source: 'provider', label: 'Biblioteca ficticia', latitude: 19.5, longitude: -99.1,
  });
  expect(selectIncidentLocation(mapNominatimResult([]), 'Manual')).toEqual({ source: 'manual', label: 'Manual' });
  expect(selectIncidentLocation(mapNominatimResult([{ display_name: 'X', lat: 'abc', lon: '0' }]), 'Manual')).toEqual({
    source: 'manual', label: 'Manual',
  });
});

test('the real provider adapter keeps 1 request per second and sends an identifying User-Agent', async () => {
  let clock = 0;
  const waits: number[] = [];
  const agents: string[] = [];
  const nominatim = new NominatimGeocodingAdapter({
    userAgent: 'CampusOps-DMI-course/1.0 (proyecto escolar)',
    fetch: async (_url, init) => {
      agents.push(new Headers(init.headers).get('User-Agent') ?? '');
      return new Response(JSON.stringify([{ display_name: 'Biblioteca ficticia', lat: '1', lon: '2' }]), { status: 200 });
    },
    now: () => clock,
    sleep: async (ms) => {
      waits.push(ms);
      clock += ms;
    },
  });
  await nominatim.geocode('Biblioteca Central Universidad');
  clock += 200;
  await nominatim.geocode('Biblioteca Central Universidad');
  expect(waits).toEqual([800]);
  expect(agents).toEqual(['CampusOps-DMI-course/1.0 (proyecto escolar)', 'CampusOps-DMI-course/1.0 (proyecto escolar)']);
});
