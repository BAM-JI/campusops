/** @jest-environment node */
import { IncidentClient } from '../../src/api/incident-client';
import { SessionManager } from '../../src/auth/session-manager';
import { createMemorySessionStorage } from '../../src/auth/session-storage';
import { PersistentOperationQueue } from '../../src/persistence/operation-queue';
import { SyncEngine, toStoredIncident } from '../../src/sync/sync-engine';
import { nodeFetch, startCourseBackend, type RunningBackend } from '../support/course-backend';
import { createFileStorage, createTempDirectory } from '../support/file-storage';
import { FIXED_NOW } from './fixtures';

const INCIDENT = 'campus-inc-001';
const options = { now: () => FIXED_NOW };

let backend: RunningBackend;

// Each test gets a fresh backend process, so campus-inc-001 starts at version 1 assigned to technician-1.
beforeEach(async () => {
  backend = await startCourseBackend();
});

afterEach(async () => {
  await backend.stop();
});

async function as(actorId: string, clientOptions: Readonly<{ scenario?: string; timeoutMs?: number }> = {}) {
  const session = new SessionManager({ baseUrl: backend.baseUrl, storage: createMemorySessionStorage(), fetch: nodeFetch });
  const login = await session.login(actorId);
  if (!login.ok) throw new Error(`login failed for ${actorId}`);
  const client = new IncidentClient({ baseUrl: backend.baseUrl, session, fetch: nodeFetch, ...clientOptions });
  return { session, client };
}

/** Server history is not part of the domain Incident, so it is read from the raw payload as the coordinator. */
async function serverHistory(): Promise<readonly Readonly<{ operationId: string }>[]> {
  const { session } = await as('coordinator-1');
  const grant = await session.accessToken();
  if (!grant) throw new Error('coordinator session expected');
  const response = await nodeFetch(`${backend.baseUrl}/v1/incidents/${INCIDENT}`, {
    method: 'GET',
    headers: { Authorization: `Bearer ${grant.token}`, 'X-Course-Actor': grant.actorId },
  });
  const body = (await response.json()) as { payload: { history: { operationId: string }[] } };
  return body.payload.history;
}

/** The technician downloads the incident while online, then works offline from that copy. */
async function technicianQueue(directory: string) {
  const technician = await as('technician-1');
  const queue = await PersistentOperationQueue.open(createFileStorage(directory), options);
  const detail = await technician.client.detail(INCIDENT);
  if (!detail.ok) throw new Error('detail failed');
  await queue.upsertIncident(toStoredIncident(detail.value));
  return { queue, technician };
}

function offlineStart(operationId: string) {
  return { operationId, incidentId: INCIDENT, baseVersion: 1, actorId: 'technician-1', action: 'start', payload: {} };
}

describe('week 08 sync engine against the course backend', () => {
  test('reassignment conflict keeps both facts', async () => {
    const directory = createTempDirectory();
    const { queue, technician } = await technicianQueue(directory);
    await queue.enqueue(offlineStart('op-sync-conflict-001'));

    const coordinator = await as('coordinator-1');
    const reassigned = await coordinator.client.act(INCIDENT, 'assign', 1, { technicianId: 'technician-2' }, 'op-coord-assign-001');
    expect(reassigned.ok).toBe(true);

    const outcomes = await new SyncEngine({ queue, repository: technician.client, actorId: 'technician-1' }).sync();
    expect(outcomes).toEqual([{ operationId: 'op-sync-conflict-001', result: 'conflict', fields: ['work'] }]);

    // Local intention survives a restart.
    const reopened = await PersistentOperationQueue.open(createFileStorage(directory), options);
    expect(reopened.list()).toEqual([
      expect.objectContaining({ operationId: 'op-sync-conflict-001', action: 'start', state: 'conflict', conflictFields: ['work'] }),
    ]);
    expect(reopened.pending()).toEqual([]);

    // Remote assignment is not overwritten.
    const remote = await coordinator.client.detail(INCIDENT);
    expect(remote).toMatchObject({ ok: true, value: { assignedTechnicianId: 'technician-2', status: 'assigned', version: 2 } });
    expect((await serverHistory()).map((event) => event.operationId)).toEqual(['op-coord-assign-001']);
  });

  test('replayed operation applies once', async () => {
    const { queue, technician } = await technicianQueue(createTempDirectory());
    const engine = new SyncEngine({ queue, repository: technician.client, actorId: 'technician-1' });

    await queue.enqueue(offlineStart('op-sync-replay-001'));
    expect(await engine.sync()).toEqual([{ operationId: 'op-sync-replay-001', result: 'confirmed', duplicate: false }]);
    expect(queue.list()).toEqual([]);

    // Same identity sent again (for example, restored from an older copy of the queue).
    await queue.enqueue(offlineStart('op-sync-replay-001'));
    expect(await engine.sync()).toEqual([{ operationId: 'op-sync-replay-001', result: 'confirmed', duplicate: true }]);
    expect(queue.list()).toEqual([]);

    const history = await serverHistory();
    expect(history.filter((event) => event.operationId === 'op-sync-replay-001')).toHaveLength(1);
    expect(queue.incidents()).toEqual([expect.objectContaining({ id: INCIDENT, version: 2, status: 'in_progress' })]);
  });

  test('unconfirmed operation stays pending', async () => {
    const directory = createTempDirectory();
    const { queue } = await technicianQueue(directory);
    await queue.enqueue(offlineStart('op-sync-lost-001'));

    // The server commits but answers after 1500 ms; the client gives up at 300 ms.
    const slow = await as('technician-1', { scenario: 'timeout_after_commit', timeoutMs: 300 });
    const first = await new SyncEngine({ queue, repository: slow.client, actorId: 'technician-1' }).sync();
    expect(first).toEqual([{ operationId: 'op-sync-lost-001', result: 'pending', error: 'timeout' }]);

    const reopened = await PersistentOperationQueue.open(createFileStorage(directory), options);
    expect(reopened.pending()).toEqual([
      expect.objectContaining({ operationId: 'op-sync-lost-001', state: 'pending', attempts: 1 }),
    ]);

    const online = await as('technician-1');
    const retry = await new SyncEngine({ queue: reopened, repository: online.client, actorId: 'technician-1' }).sync();
    expect(retry).toEqual([{ operationId: 'op-sync-lost-001', result: 'confirmed', duplicate: true }]);
    expect(reopened.list()).toEqual([]);
    expect((await serverHistory()).filter((event) => event.operationId === 'op-sync-lost-001')).toHaveLength(1);
  });

  test('server error keeps the operation', async () => {
    const { queue } = await technicianQueue(createTempDirectory());
    await queue.enqueue(offlineStart('op-sync-500-001'));

    const failing = await as('technician-1', { scenario: 'server_error' });
    const outcomes = await new SyncEngine({ queue, repository: failing.client, actorId: 'technician-1' }).sync();
    expect(outcomes).toEqual([{ operationId: 'op-sync-500-001', result: 'pending', error: 'server' }]);
    expect(queue.pending()).toEqual([expect.objectContaining({ operationId: 'op-sync-500-001', attempts: 1 })]);
    expect(await serverHistory()).toEqual([]);
  });

  test('independent remote change is merged and the operation keeps its identity', async () => {
    const { queue, technician } = await technicianQueue(createTempDirectory());
    await queue.enqueue(offlineStart('op-sync-merge-001'));

    const coordinator = await as('coordinator-1');
    expect((await coordinator.client.act(INCIDENT, 'prioritize', 1, { priority: 'high' }, 'op-coord-priority-001')).ok).toBe(true);

    const outcomes = await new SyncEngine({ queue, repository: technician.client, actorId: 'technician-1' }).sync();
    expect(outcomes).toEqual([{ operationId: 'op-sync-merge-001', result: 'confirmed', duplicate: false }]);
    expect(queue.list()).toEqual([]);
    const remote = await coordinator.client.detail(INCIDENT);
    expect(remote).toMatchObject({ ok: true, value: { status: 'in_progress', priority: 'high', version: 3 } });
  });

  test('operations of another actor are not sent with the current session', async () => {
    const { queue } = await technicianQueue(createTempDirectory());
    await queue.enqueue(offlineStart('op-sync-actor-001'));
    const coordinator = await as('coordinator-1');
    const outcomes = await new SyncEngine({ queue, repository: coordinator.client, actorId: 'coordinator-1' }).sync();
    expect(outcomes).toEqual([{ operationId: 'op-sync-actor-001', result: 'skipped', reason: 'other_actor' }]);
    expect(queue.pending()).toEqual([expect.objectContaining({ operationId: 'op-sync-actor-001', attempts: 0 })]);
  });

  test('a conflict leaves the queue only by an explicit dismissal', async () => {
    const { queue, technician } = await technicianQueue(createTempDirectory());
    await queue.enqueue(offlineStart('op-sync-dismiss-001'));
    const coordinator = await as('coordinator-1');
    await coordinator.client.act(INCIDENT, 'assign', 1, { technicianId: 'technician-2' }, 'op-coord-assign-002');
    await new SyncEngine({ queue, repository: technician.client, actorId: 'technician-1' }).sync();

    // A second sync does not resend or drop the conflict.
    expect(await new SyncEngine({ queue, repository: technician.client, actorId: 'technician-1' }).sync()).toEqual([]);
    expect(queue.list()).toHaveLength(1);

    await queue.dismissConflict('op-sync-dismiss-001');
    expect(queue.list()).toEqual([]);
  });
});
