import {
  BACKUP_KEY,
  CorruptDatabaseError,
  DATABASE_KEY,
  MIGRATION_MARKER_KEY,
  migrateDatabase,
  openLocalDatabase,
  parseStoredDatabase,
} from '../../src/persistence/local-database';
import type { KeyValueStorage } from '../../src/persistence/key-value-storage';
import { createFileStorage, createTempDirectory, withFault } from '../support/file-storage';
import { FIXED_NOW, legacyDatabase } from './fixtures';

const options = { now: () => FIXED_NOW };
const legacyRaw = JSON.stringify(legacyDatabase);

async function seedLegacy(): Promise<string> {
  const directory = createTempDirectory();
  await createFileStorage(directory).setItem(DATABASE_KEY, legacyRaw);
  return directory;
}

async function snapshot(storage: KeyValueStorage) {
  return {
    database: await storage.getItem(DATABASE_KEY),
    backup: await storage.getItem(BACKUP_KEY),
    marker: await storage.getItem(MIGRATION_MARKER_KEY),
  };
}

describe('week 08 migration schema 1 -> 2', () => {
  test('valid migration keeps incidents and pending operations with stable identity', async () => {
    const directory = await seedLegacy();
    const storage = createFileStorage(directory);

    const result = await migrateDatabase(storage, options);
    const migrated = parseStoredDatabase((await storage.getItem(DATABASE_KEY)) ?? '');

    expect(result).toEqual({ status: 'migrated', from: 1, to: 2, incidents: 1, operations: 2 });
    expect(migrated.schemaVersion).toBe(2);
    expect(migrated).toMatchObject({
      incidents: legacyDatabase.incidents,
      operations: [
        { operationId: 'legacy-1', incidentId: 'campus-inc-001', actorId: 'technician-1', action: 'start', baseVersion: 1, state: 'pending' },
        { operationId: 'legacy-2', action: 'comment', payload: { text: 'Nota ficticia: router sin energía' }, baseVersion: 1 },
      ],
    });
    expect(await snapshot(storage)).toMatchObject({ backup: null, marker: null });
    expect(await migrateDatabase(storage, options)).toEqual({ status: 'up-to-date', schemaVersion: 2 });
  });

  test.each(['backup-written', 'transformed', 'database-written'] as const)(
    'failure injected at %s rolls back to the intact schema 1 and can be retried',
    async (step) => {
      const directory = await seedLegacy();
      const storage = createFileStorage(directory);
      const before = await snapshot(storage);

      const failed = await migrateDatabase(storage, {
        ...options,
        onStep: (current) => {
          if (current === step) throw new Error(`injected failure at ${step}`);
        },
      });
      const afterFailure = await snapshot(storage);
      const recovered = await migrateDatabase(storage, options);

      expect(before).toEqual({ database: legacyRaw, backup: null, marker: null });
      expect(failed).toEqual({ status: 'rolled-back', schemaVersion: 1, reason: `injected failure at ${step}` });
      expect(afterFailure).toEqual(before);
      expect(recovered).toMatchObject({ status: 'migrated', incidents: 1, operations: 2 });
    },
  );

  test('I/O failure while writing the new schema leaves the old one untouched', async () => {
    const directory = await seedLegacy();
    const storage = withFault(createFileStorage(directory), { method: 'setItem', key: DATABASE_KEY, mode: 'throw' });

    const failed = await migrateDatabase(storage, options);

    expect(failed).toMatchObject({ status: 'rolled-back', reason: `injected setItem failure on ${DATABASE_KEY}` });
    expect(await snapshot(createFileStorage(directory))).toEqual({ database: legacyRaw, backup: null, marker: null });
  });

  test.each([
    ['before the new schema is written', 'setItem', DATABASE_KEY],
    ['after the new schema is written but before cleanup', 'removeItem', MIGRATION_MARKER_KEY],
  ] as const)('app killed %s is recovered on the next start', async (_label, method, key) => {
    const directory = await seedLegacy();
    void migrateDatabase(withFault(createFileStorage(directory), { method, key, mode: 'hang' }), options);
    await new Promise((resolve) => setTimeout(resolve, 50));
    const afterCrash = await snapshot(createFileStorage(directory));

    const reopened = await openLocalDatabase(createFileStorage(directory), options);

    expect(afterCrash.marker).not.toBeNull();
    expect(afterCrash.backup).toBe(legacyRaw);
    expect(reopened.recovered).toBe(true);
    expect(reopened.migration).toMatchObject({ status: 'migrated', incidents: 1, operations: 2 });
    expect(reopened.database.operations.map((operation) => operation.operationId)).toEqual(['legacy-1', 'legacy-2']);
    expect(await snapshot(createFileStorage(directory))).toMatchObject({ backup: null, marker: null });
  });

  test('corrupt local data is reported and never overwritten', async () => {
    const directory = createTempDirectory();
    const storage = createFileStorage(directory);
    await storage.setItem(DATABASE_KEY, '{"schemaVersion": 1, "incidents": [');

    await expect(migrateDatabase(storage, options)).rejects.toBeInstanceOf(CorruptDatabaseError);
    expect(await storage.getItem(DATABASE_KEY)).toBe('{"schemaVersion": 1, "incidents": [');
  });
});
