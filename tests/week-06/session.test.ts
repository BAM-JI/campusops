/** @jest-environment node */
import { IncidentClient } from '../../src/api/incident-client';
import { summarizeAuthEvents } from '../../src/auth/refresh-coordinator';
import { SessionManager } from '../../src/auth/session-manager';
import { SESSION_KEY, createMemorySessionStorage } from '../../src/auth/session-storage';
import { createFakeFetch, jsonResponse, LOGIN_RESPONSE, VALID_INCIDENT, type FakeCall } from '../support/fake-fetch';

const BASE = 'http://backend.test';

/**
 * Fetch double of the auth backend: tokens of generation 0 are rejected with 401 once
 * `expired` is true, so several requests discover the expiration at the same time.
 */
function authBackend(options: { refreshFails?: boolean } = {}) {
  const state = { expired: false, refreshCalls: 0 };
  const fetch = createFakeFetch((call: FakeCall) => {
    if (call.url.endsWith('/v1/session/login')) return jsonResponse(200, LOGIN_RESPONSE);
    if (call.url.endsWith('/v1/session/refresh')) {
      state.refreshCalls += 1;
      if (options.refreshFails || (call.body as { refreshToken?: string }).refreshToken !== 'course-refresh-0') {
        return jsonResponse(401, { code: 'invalid_grant' });
      }
      return jsonResponse(200, { accessToken: 'course-token-1', refreshToken: 'course-refresh-1', expiresIn: 60 });
    }
    const token = call.headers.Authorization;
    if (state.expired && token === 'Bearer course-valid-token') return jsonResponse(401, { code: 'unauthorized' });
    return jsonResponse(200, call.url.endsWith('/v1/incidents') ? { items: [VALID_INCIDENT] } : VALID_INCIDENT);
  });
  return { fetch, state };
}

async function loggedIn(options: { refreshFails?: boolean; now?: () => number } = {}) {
  const backend = authBackend(options);
  const storage = createMemorySessionStorage();
  const session = new SessionManager({ baseUrl: BASE, storage, fetch: backend.fetch, now: options.now ?? (() => 0) });
  expect(await session.login('technician-1')).toEqual({ ok: true, value: { actorId: 'technician-1', role: 'technician' } });
  const client = new IncidentClient({ baseUrl: BASE, session, fetch: backend.fetch });
  return { ...backend, storage, session, client };
}

test('login persists the session only in the secure storage port', async () => {
  const { storage } = await loggedIn();
  const stored = JSON.parse(storage.snapshot().get(SESSION_KEY) ?? 'null');
  expect(stored).toMatchObject({ actorId: 'technician-1', role: 'technician', accessToken: 'course-valid-token' });
});

test('three concurrent 401s share a single refresh and each request is retried once', async () => {
  const { client, session, state, fetch } = await loggedIn();
  state.expired = true;
  const results = await Promise.all([client.list(), client.detail('campus-inc-001'), client.list()]);
  expect(results.every((result) => result.ok)).toBe(true);
  expect(state.refreshCalls).toBe(1);
  const incidentCalls = fetch.calls.filter((call) => call.url.includes('/v1/incidents'));
  expect(incidentCalls).toHaveLength(6); // 3 rejected + 3 retried with the new token, no more
  expect(incidentCalls.slice(3).every((call) => call.headers.Authorization === 'Bearer course-token-1')).toBe(true);
  // The SessionManager follows the same policy the course adapter evaluates.
  expect(summarizeAuthEvents(session.events())).toMatchObject({ status: 'authenticated', refreshCalls: 1 });
});

test('a failed refresh returns to anonymous, deletes the stored session and does not loop', async () => {
  const { client, session, state, storage } = await loggedIn({ refreshFails: true });
  state.expired = true;
  const results = await Promise.all([client.list(), client.list(), client.list()]);
  expect(results).toEqual(Array(3).fill({ ok: false, error: { kind: 'unauthorized' } }));
  expect(state.refreshCalls).toBe(1);
  expect(session.status()).toBe('anonymous');
  expect(storage.snapshot().has(SESSION_KEY)).toBe(false);
  expect(summarizeAuthEvents(session.events())).toMatchObject({ status: 'anonymous', persistedToken: null });
  // Later calls do not try to refresh again: there is no session to renew.
  await client.list();
  expect(state.refreshCalls).toBe(1);
});

test('expiration is detected with a controllable clock, without real waits', async () => {
  let now = 0;
  const { client, state } = await loggedIn({ now: () => now });
  await client.list();
  expect(state.refreshCalls).toBe(0);
  now = 60_000; // expiresIn 60 s
  const result = await client.list();
  expect(result.ok).toBe(true);
  expect(state.refreshCalls).toBe(1);
});

test('a stale refresh token (already rotated) ends the session safely', async () => {
  let now = 0;
  const { client, session, state } = await loggedIn({ now: () => now });
  now = 60_000;
  await client.list(); // rotates course-refresh-0 -> course-refresh-1
  now = 120_000;
  await expect(client.list()).resolves.toEqual({ ok: false, error: { kind: 'unauthorized' } });
  expect(state.refreshCalls).toBe(2);
  expect(session.status()).toBe('anonymous');
});

test('logout removes the persisted session and later requests are unauthorized', async () => {
  const { client, session, storage, fetch } = await loggedIn();
  await session.logout();
  expect(storage.snapshot().size).toBe(0);
  const callsBefore = fetch.calls.length;
  await expect(client.list()).resolves.toEqual({ ok: false, error: { kind: 'unauthorized' } });
  expect(fetch.calls.length).toBe(callsBefore);
});

test('restarting the app restores the session; a corrupt stored value is discarded', async () => {
  const { storage, fetch } = await loggedIn();
  const restarted = new SessionManager({ baseUrl: BASE, storage, fetch, now: () => 0 });
  await expect(restarted.restore()).resolves.toEqual({ actorId: 'technician-1', role: 'technician' });

  await storage.setItem(SESSION_KEY, '{"actorId": 42');
  const corrupt = new SessionManager({ baseUrl: BASE, storage, fetch });
  await expect(corrupt.restore()).resolves.toBeNull();
  expect(storage.snapshot().has(SESSION_KEY)).toBe(false);
});

test('tokens never reach the console', async () => {
  const spies = (['log', 'info', 'warn', 'error', 'debug'] as const).map((method) =>
    jest.spyOn(console, method).mockImplementation(() => undefined),
  );
  const { client, state, session } = await loggedIn({ refreshFails: true });
  state.expired = true;
  await client.list();
  await session.logout();
  for (const spy of spies) {
    expect(spy).not.toHaveBeenCalled();
    spy.mockRestore();
  }
  expect(JSON.stringify(session.events())).not.toContain('course-');
});
