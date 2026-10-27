import type { DatabaseV1 } from '../../src/persistence/local-database';

export const FIXED_NOW = '2026-10-23T18:00:00.000Z';

/** Schema 1 snapshot with synthetic data from the public contract. */
export const legacyDatabase: DatabaseV1 = {
  schemaVersion: 1,
  incidents: [
    {
      id: 'campus-inc-001',
      version: 1,
      status: 'assigned',
      payload: {
        category: 'connectivity',
        description: 'Sin conexión en laboratorio ficticio',
        location: 'Edificio de prueba A',
        reporterId: 'reporter-1',
        assignedTechnicianId: 'technician-1',
      },
    },
  ],
  pendingChanges: [
    {
      localId: '1',
      incidentId: 'campus-inc-001',
      actorId: 'technician-1',
      action: 'start',
      data: {},
      incidentVersion: 1,
    },
    {
      localId: '2',
      incidentId: 'campus-inc-001',
      actorId: 'technician-1',
      action: 'comment',
      data: { text: 'Nota ficticia: router sin energía' },
      incidentVersion: 1,
    },
  ],
};
