/** @jest-environment node */
import { IncidentClient } from '../../src/api/incident-client';
import { SessionManager } from '../../src/auth/session-manager';
import { createMemorySessionStorage } from '../../src/auth/session-storage';
import { DATABASE_KEY } from '../../src/persistence/local-database';
import { PersistentOperationQueue } from '../../src/persistence/operation-queue';
import { SyncEngine } from '../../src/sync/sync-engine';
import { nodeFetch, startCourseBackend } from '../support/course-backend';
import { createFileStorage, createTempDirectory } from '../support/file-storage';
import { legacyDatabase } from './fixtures';

async function clientAs(baseUrl: string, actorId: string): Promise<IncidentClient> {
  const session = new SessionManager({
    baseUrl,
    storage: createMemorySessionStorage(),
    fetch: nodeFetch,
  });
  const login = await session.login(actorId);
  if (!login.ok) throw new Error(`login failed for ${actorId}`);

  return new IncidentClient({ baseUrl, session, fetch: nodeFetch });
}

describe('Prueba Integral - Semana 08', () => {
  it('end-to-end: migrate, restart and sync without losing or duplicating work', async () => {
    // 1. Sembrar una base con esquema 1 en un directorio temporal.
    const directory = createTempDirectory();
    const storage = createFileStorage(directory);
    await storage.setItem(DATABASE_KEY, JSON.stringify(legacyDatabase));

    // 2. Abrir la cola y comprobar que la migración conservó las operaciones.
    let queue = await PersistentOperationQueue.open(storage);
    let allOps = queue.list();
    expect(allOps.map((operation) => operation.operationId)).toEqual(['legacy-1', 'legacy-2']);

    // 3. Simular el reinicio reabriendo la cola sobre el mismo almacenamiento.
    queue = await PersistentOperationQueue.open(storage);
    allOps = queue.list();
    expect(allOps.map((operation) => operation.operationId)).toEqual(['legacy-1', 'legacy-2']);

    // 4. Reasignar la incidencia en el backend y sincronizar la cola local.
    const backend = await startCourseBackend();
    try {
      const coordinatorClient = await clientAs(backend.baseUrl, 'coordinator-1');
      const reassignment = await coordinatorClient.act(
        'campus-inc-001',
        'assign',
        1,
        { technicianId: 'technician-2' },
        'op-e2e-reassign-001',
      );
      expect(reassignment.ok).toBe(true);

      const technicianClient = await clientAs(backend.baseUrl, 'technician-1');
      const outcomes = await new SyncEngine({
        queue,
        repository: technicianClient,
        actorId: 'technician-1',
      }).sync();

      expect(outcomes).toContainEqual({
        operationId: 'legacy-1',
        result: 'conflict',
        fields: ['work'],
      });

      // 5. La operación local conserva el conflicto y la asignación remota prevalece.
      allOps = queue.list();
      const conflictOp = allOps.find((operation) => operation.operationId === 'legacy-1');
      expect(conflictOp?.state).toBe('conflict');
      expect(conflictOp?.conflictFields).toEqual(['work']);

      const remoteIncident = await coordinatorClient.detail('campus-inc-001');
      expect(remoteIncident).toMatchObject({
        ok: true,
        value: { assignedTechnicianId: 'technician-2', status: 'assigned', version: 2 },
      });

      // No hay operationId duplicados entre las operaciones que siguen en cola.
      const uniqueIds = new Set(allOps.map((operation) => operation.operationId));
      expect(uniqueIds.size).toBe(allOps.length);
    } finally {
      await backend.stop();
    }
  });
});