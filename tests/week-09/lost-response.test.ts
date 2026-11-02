/** @jest-environment node */
import { IncidentClient, type AttemptRecord } from '../../src/api/incident-client';
import { SessionManager } from '../../src/auth/session-manager';
import { createMemorySessionStorage } from '../../src/auth/session-storage';
import { nodeFetch, startCourseBackend, type RunningBackend } from '../support/course-backend';

let backend: RunningBackend;

// A fresh backend per test: campus-inc-001 starts at version 1, assigned to technician-1.
beforeEach(async () => {
  backend = await startCourseBackend();
});

afterEach(async () => {
  await backend.stop();
});

async function as(actorId: string, options: { scenario?: string; timeoutMs?: number } = {}) {
  const session = new SessionManager({ baseUrl: backend.baseUrl, storage: createMemorySessionStorage(), fetch: nodeFetch });
  const login = await session.login(actorId);
  if (!login.ok) throw new Error(`login failed for ${actorId}`);
  const attempts: AttemptRecord[] = [];
  const client = new IncidentClient({
    baseUrl: backend.baseUrl,
    session,
    fetch: nodeFetch,
    ...options,
    retry: { onAttempt: (record) => attempts.push(record) },
  });
  return { client, attempts };
}

/** Raw read as coordinator: the domain model does not expose the server history. */
async function serverIncident(): Promise<{ version: number; status: string; payload: { history: { operationId: string; action: string }[] } }> {
  const response = await nodeFetch(`${backend.baseUrl}/v1/incidents/campus-inc-001`, {
    headers: { Authorization: 'Bearer course-valid-token', 'X-Course-Actor': 'coordinator-1' },
  });
  return response.json();
}

test('lost resolve response is retried with the same key and applies once', async () => {
  const technician = await as('technician-1');
  await expect(technician.client.act('campus-inc-001', 'start', 1, {}, 'op-week09-start-001')).resolves.toMatchObject({ ok: true });

  // The server saves the resolution but answers after 1500 ms; the client gives up at 500 ms.
  const lost = await as('technician-1', { scenario: 'timeout_after_commit', timeoutMs: 500 });
  const result = await lost.client.act('campus-inc-001', 'resolve', 2, { diagnosis: 'Router ficticio reiniciado' }, 'op-week09-resolve-001');

  expect(result).toMatchObject({ ok: true, value: { duplicate: true, incident: { status: 'resolved', version: 3 } } });
  expect(lost.attempts.map((record) => [record.attempt, record.outcome, record.retry])).toEqual([
    [1, 'timeout', true],
    [2, 'http_200', false],
  ]);
  const server = await serverIncident();
  expect(server).toMatchObject({ version: 3, status: 'resolved' });
  expect(server.payload.history.filter((event) => event.operationId === 'op-week09-resolve-001')).toHaveLength(1);
});

test('lost close response does not duplicate the event', async () => {
  const technician = await as('technician-1');
  await technician.client.act('campus-inc-001', 'start', 1, {}, 'op-week09-start-002');
  await technician.client.act('campus-inc-001', 'resolve', 2, { diagnosis: 'Cable ficticio' }, 'op-week09-resolve-002');

  const coordinator = await as('coordinator-1', { scenario: 'timeout_after_commit', timeoutMs: 500 });
  const result = await coordinator.client.act('campus-inc-001', 'close', 3, {}, 'op-week09-close-002');

  expect(result).toMatchObject({ ok: true, value: { duplicate: true, incident: { status: 'closed', version: 4 } } });
  expect(coordinator.attempts).toHaveLength(2);
  const server = await serverIncident();
  expect(server).toMatchObject({ version: 4, status: 'closed' });
  expect(server.payload.history.filter((event) => event.action === 'close')).toHaveLength(1);
});

test('the same key with different content is rejected, not applied twice', async () => {
  const technician = await as('technician-1');
  await technician.client.act('campus-inc-001', 'start', 1, {}, 'op-week09-start-003');
  await technician.client.act('campus-inc-001', 'resolve', 2, { diagnosis: 'Primera version' }, 'op-week09-resolve-003');
  await expect(
    technician.client.act('campus-inc-001', 'resolve', 2, { diagnosis: 'Otro contenido' }, 'op-week09-resolve-003'),
  ).resolves.toEqual({ ok: false, error: { kind: 'conflict', code: 'idempotency_key_reused' } });
  const server = await serverIncident();
  expect(server.payload.history.filter((event) => event.action === 'resolve')).toHaveLength(1);
});
