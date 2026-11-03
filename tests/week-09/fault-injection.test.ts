/** @jest-environment node */
import { IncidentClient, type AttemptRecord } from '../../src/api/incident-client';
import { ResolveIncidentLocationUseCase } from '../../src/application/location-usecases';
import { SessionManager } from '../../src/auth/session-manager';
import { createMemorySessionStorage } from '../../src/auth/session-storage';
import { CourseGeocodingAdapter } from '../../src/location/geocoding-adapter';
import { nodeFetch, startCourseBackend, type RunningBackend } from '../support/course-backend';

jest.setTimeout(60000);

let backend: RunningBackend;

beforeAll(async () => {
  backend = await startCourseBackend();
});

afterAll(async () => {
  await backend.stop();
});

async function sessionAs(actorId: string) {
  const session = new SessionManager({ baseUrl: backend.baseUrl, storage: createMemorySessionStorage(), fetch: nodeFetch });
  const login = await session.login(actorId);
  if (!login.ok) throw new Error(`login failed for ${actorId}`);
  return session;
}

test('fault injection: provider down keeps manual location and a lost close is applied once', async () => {
  const reporter = await sessionAs('reporter-1');
  const typedLabel = 'Edificio ficticio B, laboratorio de prueba';
  const geocoder = new CourseGeocodingAdapter({
    baseUrl: backend.baseUrl, session: reporter, fetch: nodeFetch, scenario: 'server_error', retry: {},
  });
  const resolved = await new ResolveIncidentLocationUseCase(geocoder).execute(typedLabel);
  expect(resolved).toEqual({ location: { source: 'manual', label: typedLabel }, notice: 'provider_unavailable' });
  expect(resolved.location).not.toHaveProperty('latitude');
  expect(resolved.location).not.toHaveProperty('longitude');

  const reporterClient = new IncidentClient({ baseUrl: backend.baseUrl, session: reporter, fetch: nodeFetch });
  await expect(reporterClient.create({
    category: 'water', description: 'Fuga ficticia durante prueba de fallos', location: resolved.location.label,
  }, 'op-lizbeth-week09-create')).resolves.toMatchObject({
    ok: true, value: { incident: { reporterId: 'reporter-1', location: typedLabel, status: 'open' } },
  });

  const technician = new IncidentClient({
    baseUrl: backend.baseUrl, session: await sessionAs('technician-1'), fetch: nodeFetch,
  });
  await expect(technician.act('campus-inc-001', 'start', 1, {}, 'op-lizbeth-week09-start')).resolves.toMatchObject({ ok: true });
  await expect(technician.act('campus-inc-001', 'resolve', 2, {
    diagnosis: 'Cable ficticio reparado',
  }, 'op-lizbeth-week09-resolve')).resolves.toMatchObject({ ok: true });

  const coordinatorSession = await sessionAs('coordinator-1');
  const attempts: AttemptRecord[] = [];
  const coordinator = new IncidentClient({
    baseUrl: backend.baseUrl, session: coordinatorSession, fetch: nodeFetch,
    scenario: 'timeout_after_commit', timeoutMs: 500,
    retry: { onAttempt: (record) => attempts.push(record) },
  });
  await expect(coordinator.act('campus-inc-001', 'close', 3, {}, 'op-lizbeth-week09-close')).resolves.toMatchObject({
    ok: true, value: { duplicate: true, incident: { status: 'closed', version: 4 } },
  });
  expect(attempts.map(({ attempt, outcome, retry }) => [attempt, outcome, retry])).toEqual([
    [1, 'timeout', true], [2, 'http_200', false],
  ]);

  const grant = await coordinatorSession.accessToken();
  if (!grant) throw new Error('coordinator session missing');
  const response = await nodeFetch(`${backend.baseUrl}/v1/incidents/campus-inc-001`, {
    headers: { Authorization: `Bearer ${grant.token}`, 'X-Course-Actor': grant.actorId },
  });
  expect(response.status).toBe(200);
  const incident = await response.json();
  expect(incident).toMatchObject({ status: 'closed', version: 4 });
  expect(incident.payload.history.filter((event: { action: string }) => event.action === 'close')).toHaveLength(1);
});
