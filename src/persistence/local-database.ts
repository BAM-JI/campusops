import type { IncidentStatus, PendingIncidentOperation } from '../campusops/contracts';
import type { KeyValueStorage } from './key-value-storage';

export const DATABASE_KEY = 'campusops.db';
export const BACKUP_KEY = 'campusops.db.backup';
export const MIGRATION_MARKER_KEY = 'campusops.db.migration';
export const CURRENT_SCHEMA_VERSION = 2;

export type StoredIncident = Readonly<{
  id: string;
  version: number;
  status: IncidentStatus;
  payload: Readonly<Record<string, unknown>> | null;
}>;

/** Schema 1: pending changes had only a local counter, not a stable operation identity. */
export type LegacyPendingChangeV1 = Readonly<{
  localId: string;
  incidentId: string;
  actorId: string;
  action: string;
  data: Readonly<Record<string, unknown>>;
  incidentVersion: number;
}>;

export type DatabaseV1 = Readonly<{
  schemaVersion: 1;
  incidents: readonly StoredIncident[];
  pendingChanges: readonly LegacyPendingChangeV1[];
}>;

export type QueuedOperation = PendingIncidentOperation &
  Readonly<{
    createdAt: string;
    state: 'pending' | 'conflict';
    attempts: number;
    conflictFields: readonly string[];
  }>;

export type DatabaseV2 = Readonly<{
  schemaVersion: 2;
  incidents: readonly StoredIncident[];
  operations: readonly QueuedOperation[];
}>;

export type MigrationStep = 'backup-written' | 'transformed' | 'database-written';

export type MigrationOptions = Readonly<{
  now?: () => string;
  /** Fault-injection point used by tests to interrupt the migration at a given step. */
  onStep?: (step: MigrationStep) => void | Promise<void>;
}>;

export type MigrationResult =
  | Readonly<{ status: 'created' | 'up-to-date'; schemaVersion: 2 }>
  | Readonly<{ status: 'migrated'; from: 1; to: 2; incidents: number; operations: number }>
  | Readonly<{ status: 'rolled-back'; schemaVersion: 1; reason: string }>;

export class CorruptDatabaseError extends Error {
  constructor(reason: string) {
    super(`Local database is corrupt: ${reason}`);
    this.name = 'CorruptDatabaseError';
  }
}

const STATUSES: readonly IncidentStatus[] = ['open', 'assigned', 'in_progress', 'resolved', 'closed'];

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

function isVersion(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0;
}

function isStoredIncident(value: unknown): value is StoredIncident {
  return (
    isRecord(value) &&
    isNonEmptyString(value.id) &&
    isVersion(value.version) &&
    STATUSES.includes(value.status as IncidentStatus) &&
    (value.payload === null || isRecord(value.payload))
  );
}

function isLegacyChange(value: unknown): value is LegacyPendingChangeV1 {
  return (
    isRecord(value) &&
    isNonEmptyString(value.localId) &&
    isNonEmptyString(value.incidentId) &&
    isNonEmptyString(value.actorId) &&
    isNonEmptyString(value.action) &&
    isRecord(value.data) &&
    isVersion(value.incidentVersion)
  );
}

function isQueuedOperation(value: unknown): value is QueuedOperation {
  return (
    isRecord(value) &&
    isNonEmptyString(value.operationId) &&
    isNonEmptyString(value.incidentId) &&
    isVersion(value.baseVersion) &&
    isNonEmptyString(value.actorId) &&
    isNonEmptyString(value.action) &&
    isRecord(value.payload) &&
    isNonEmptyString(value.createdAt) &&
    (value.state === 'pending' || value.state === 'conflict') &&
    isVersion(value.attempts) &&
    Array.isArray(value.conflictFields) &&
    value.conflictFields.every((field) => typeof field === 'string')
  );
}

export function parseStoredDatabase(raw: string): DatabaseV1 | DatabaseV2 {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new CorruptDatabaseError('invalid JSON');
  }
  if (!isRecord(parsed) || !Array.isArray(parsed.incidents) || !parsed.incidents.every(isStoredIncident)) {
    throw new CorruptDatabaseError('invalid incidents');
  }
  if (parsed.schemaVersion === 1) {
    if (!Array.isArray(parsed.pendingChanges) || !parsed.pendingChanges.every(isLegacyChange)) {
      throw new CorruptDatabaseError('invalid schema 1 pending changes');
    }
    return parsed as DatabaseV1;
  }
  if (parsed.schemaVersion === 2) {
    if (!Array.isArray(parsed.operations) || !parsed.operations.every(isQueuedOperation)) {
      throw new CorruptDatabaseError('invalid schema 2 operations');
    }
    return parsed as DatabaseV2;
  }
  throw new CorruptDatabaseError(`unsupported schemaVersion ${String(parsed.schemaVersion)}`);
}

export function emptyDatabase(): DatabaseV2 {
  return { schemaVersion: 2, incidents: [], operations: [] };
}

/** The legacy local counter becomes a deterministic operationId, so re-running the migration keeps the same identity. */
export function migrateV1ToV2(database: DatabaseV1, now: string): DatabaseV2 {
  return {
    schemaVersion: 2,
    incidents: database.incidents.map((incident) => ({ ...incident })),
    operations: database.pendingChanges.map((change) => ({
      operationId: `legacy-${change.localId}`,
      incidentId: change.incidentId,
      baseVersion: change.incidentVersion,
      actorId: change.actorId,
      action: change.action,
      payload: { ...change.data },
      createdAt: now,
      state: 'pending',
      attempts: 0,
      conflictFields: [],
    })),
  };
}

async function restoreFromBackup(storage: KeyValueStorage): Promise<void> {
  const backup = await storage.getItem(BACKUP_KEY);
  if (backup !== null) await storage.setItem(DATABASE_KEY, backup);
  await storage.removeItem(MIGRATION_MARKER_KEY);
  await storage.removeItem(BACKUP_KEY);
}

/**
 * Restores the pre-migration copy when a previous run died after writing the marker
 * (for example, the app was closed mid-migration). Returns true when it recovered.
 */
export async function recoverInterruptedMigration(storage: KeyValueStorage): Promise<boolean> {
  if ((await storage.getItem(MIGRATION_MARKER_KEY)) === null) return false;
  await restoreFromBackup(storage);
  return true;
}

export async function migrateDatabase(
  storage: KeyValueStorage,
  options: MigrationOptions = {},
): Promise<MigrationResult> {
  const now = options.now ?? (() => new Date().toISOString());
  const raw = await storage.getItem(DATABASE_KEY);
  if (raw === null) {
    await storage.setItem(DATABASE_KEY, JSON.stringify(emptyDatabase()));
    return { status: 'created', schemaVersion: 2 };
  }
  const current = parseStoredDatabase(raw);
  if (current.schemaVersion === CURRENT_SCHEMA_VERSION) return { status: 'up-to-date', schemaVersion: 2 };

  await storage.setItem(BACKUP_KEY, raw);
  await storage.setItem(MIGRATION_MARKER_KEY, JSON.stringify({ from: 1, to: 2, startedAt: now() }));
  try {
    await options.onStep?.('backup-written');
    const next = migrateV1ToV2(current, now());
    if (next.incidents.length !== current.incidents.length || next.operations.length !== current.pendingChanges.length) {
      throw new CorruptDatabaseError('migration lost records');
    }
    await options.onStep?.('transformed');
    await storage.setItem(DATABASE_KEY, JSON.stringify(next));
    await options.onStep?.('database-written');
    await storage.removeItem(MIGRATION_MARKER_KEY);
    await storage.removeItem(BACKUP_KEY);
    return { status: 'migrated', from: 1, to: 2, incidents: next.incidents.length, operations: next.operations.length };
  } catch (error) {
    await restoreFromBackup(storage);
    return { status: 'rolled-back', schemaVersion: 1, reason: error instanceof Error ? error.message : 'unknown' };
  }
}

/** Opens the database for the app: recovers an interrupted migration, migrates and loads schema 2. */
export async function openLocalDatabase(
  storage: KeyValueStorage,
  options: MigrationOptions = {},
): Promise<Readonly<{ database: DatabaseV2; recovered: boolean; migration: MigrationResult }>> {
  const recovered = await recoverInterruptedMigration(storage);
  const migration = await migrateDatabase(storage, options);
  if (migration.status === 'rolled-back') {
    throw new Error(`Local database migration rolled back: ${migration.reason}`);
  }
  const raw = await storage.getItem(DATABASE_KEY);
  const database = raw === null ? emptyDatabase() : parseStoredDatabase(raw);
  if (database.schemaVersion !== 2) throw new CorruptDatabaseError('schema 2 expected after migration');
  return { database, recovered, migration };
}
