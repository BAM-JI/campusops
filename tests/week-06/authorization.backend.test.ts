/** @jest-environment node */
import { IncidentClient } from '../../src/api/incident-client';
import { PerformIncidentActionUseCase, CreateIncidentUseCase } from '../../src/application/incident-usecases';
import { canPerform } from '../../src/auth/permissions';
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

async function as(actorId: string) {
  const session = new SessionManager({ baseUrl: backend.baseUrl, storage: createMemorySessionStorage(), fetch: nodeFetch });
  const login = await session.login(actorId);
  if (!login.ok) throw new Error(`login failed for ${actorId}`);
  return { identity: login.value, session, client: new IncidentClient({ baseUrl: backend.baseUrl, session, fetch: nodeFetch }) };
}

async function current(client: IncidentClient) {
  const detail = await client.detail('campus-inc-001');
  if (!detail.ok) throw new Error('detail failed');
  return detail.value;
}

test('the server rejects actions outside the profile even if the UI check is bypassed', async () => {
  const technician = await as('technician-1');
  const incident = await current(technician.client);
  // Hiding the button is not authorization: the raw client call is still rejected by the server.
  expect(canPerform('technician', 'technician-1', 'assign', incident)).toBe(false);
  await expect(
    technician.client.act(incident.id, 'assign', incident.version, { technicianId: 'technician-2' }, 'op-week06-assign-tech'),
  ).resolves.toEqual({ ok: false, error: { kind: 'forbidden' } });
  // The use case avoids the request entirely.
  await expect(
    new PerformIncidentActionUseCase(technician.client).execute(technician.identity, incident, 'close', {}),
  ).resolves.toEqual({ ok: false, error: { kind: 'forbidden' } });
});

test('only a reporter creates incidents', async () => {
  const technician = await as('technician-1');
  const input = { category: 'safety', description: 'Riesgo ficticio', location: 'Patio de prueba' } as const;
  await expect(technician.client.create(input, 'op-week06-create-tech')).resolves.toEqual({
    ok: false,
    error: { kind: 'forbidden' },
  });
  await expect(new CreateIncidentUseCase(technician.client).execute('technician', input)).resolves.toEqual({
    ok: false,
    error: { kind: 'forbidden' },
  });
  const reporter = await as('reporter-1');
  await expect(new CreateIncidentUseCase(reporter.client).execute('reporter', input)).resolves.toMatchObject({ ok: true });
});

test('assigned technician starts and resolves; coordinator closes; a reassigned technician loses access', async () => {
  const technician = await as('technician-1');
  const coordinator = await as('coordinator-1');
  const actions = (client: IncidentClient) => new PerformIncidentActionUseCase(client);

  let incident = await current(technician.client);
  const started = await actions(technician.client).execute(technician.identity, incident, 'start', {}, 'op-week06-start');
  expect(started).toMatchObject({ ok: true, value: { incident: { status: 'in_progress', version: 2 } } });

  incident = await current(technician.client);
  const resolved = await actions(technician.client).execute(technician.identity, incident, 'resolve', { diagnosis: 'Cable ficticio' }, 'op-week06-resolve');
  expect(resolved).toMatchObject({ ok: true, value: { incident: { status: 'resolved' } } });

  incident = await current(coordinator.client);
  await expect(actions(coordinator.client).execute(coordinator.identity, incident, 'close', {}, 'op-week06-close')).resolves.toMatchObject({
    ok: true,
    value: { incident: { status: 'closed' } },
  });

  incident = await current(coordinator.client);
  await actions(coordinator.client).execute(coordinator.identity, incident, 'reopen', {}, 'op-week06-reopen');
  incident = await current(coordinator.client);
  await actions(coordinator.client).execute(coordinator.identity, incident, 'assign', { technicianId: 'technician-2' }, 'op-week06-reassign');
  await expect(technician.client.detail('campus-inc-001')).resolves.toEqual({ ok: false, error: { kind: 'forbidden' } });
});

test('the real backend rotates the refresh token: one renewal works, a reused one ends the session', async () => {
  let now = 0;
  const session = new SessionManager({ baseUrl: backend.baseUrl, storage: createMemorySessionStorage(), fetch: nodeFetch, now: () => now });
  await session.login('coordinator-1');
  const client = new IncidentClient({ baseUrl: backend.baseUrl, session, fetch: nodeFetch });
  now = 60_000;
  await expect(client.list()).resolves.toMatchObject({ ok: true });
  now = 120_000;
  await expect(client.list()).resolves.toEqual({ ok: false, error: { kind: 'unauthorized' } });
  expect(session.status()).toBe('anonymous');
});
