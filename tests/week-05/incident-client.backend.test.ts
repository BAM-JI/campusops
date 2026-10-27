/** @jest-environment node */
import { IncidentClient } from '../../src/api/incident-client';
import { SessionManager } from '../../src/auth/session-manager';
import { createMemorySessionStorage } from '../../src/auth/session-storage';
import { nodeFetch, startCourseBackend, type RunningBackend } from '../support/course-backend';

let backend: RunningBackend;

beforeAll(async () => {
  backend = await startCourseBackend();
});

afterAll(async () => {
  await backend.stop();
});

async function clientAs(actorId: string, extra: { scenario?: string; timeoutMs?: number } = {}) {
  const session = new SessionManager({ baseUrl: backend.baseUrl, storage: createMemorySessionStorage(), fetch: nodeFetch });
  const login = await session.login(actorId);
  expect(login.ok).toBe(true);
  return new IncidentClient({ baseUrl: backend.baseUrl, session, fetch: nodeFetch, ...extra });
}

test('list and detail go through the client against the real backend', async () => {
  const client = await clientAs('reporter-1');
  const list = await client.list();
  expect(list).toMatchObject({ ok: true, value: [{ id: 'campus-inc-001', reporterId: 'reporter-1' }] });
  await expect(client.detail('campus-inc-001')).resolves.toMatchObject({ ok: true, value: { version: 1 } });
  await expect(client.detail('campus-inc-999')).resolves.toEqual({ ok: false, error: { kind: 'not_found' } });
});

test('create is idempotent: retrying with the same key does not create a second incident', async () => {
  const client = await clientAs('reporter-1');
  const input = { category: 'water', description: 'Fuga ficticia', location: 'Edificio de prueba B' } as const;
  const first = await client.create(input, 'op-week05-create-1');
  const retry = await client.create(input, 'op-week05-create-1');
  expect(first).toMatchObject({ ok: true, value: { duplicate: false, incident: { status: 'open', version: 1 } } });
  expect(retry).toMatchObject({ ok: true, value: { duplicate: true } });
  if (!first.ok || !retry.ok) throw new Error('unreachable');
  expect(retry.value.incident.id).toBe(first.value.incident.id);
  await expect(client.create({ ...input, description: 'Otro texto' }, 'op-week05-create-1')).resolves.toEqual({
    ok: false,
    error: { kind: 'conflict', code: 'idempotency_key_reused' },
  });
});

test.each([
  ['server_error', { kind: 'server', status: 500 }],
  ['malformed', { kind: 'contract' }],
  ['rate_limited', { kind: 'rate_limited', retryAfterMs: 1000 }],
] as const)('backend variant %s becomes a typed error', async (scenario, error) => {
  const client = await clientAs('coordinator-1', { scenario });
  await expect(client.list()).resolves.toEqual({ ok: false, error });
});

test('slow variant ends in a client timeout instead of hanging the screen', async () => {
  const client = await clientAs('coordinator-1', { scenario: 'slow', timeoutMs: 300 });
  await expect(client.list()).resolves.toEqual({ ok: false, error: { kind: 'timeout' } });
});

test('nullable variant: valid envelope but no data, so nothing is invented', async () => {
  const client = await clientAs('coordinator-1', { scenario: 'nullable' });
  await expect(client.detail('campus-inc-001')).resolves.toEqual({ ok: false, error: { kind: 'contract' } });
  await expect(client.list()).resolves.toEqual({ ok: true, value: [] });
});
