import { deduplicateOperations } from '../sync/deduplicate-operations';
import type { KeyValueStorage } from './key-value-storage';
import {
  DATABASE_KEY,
  openLocalDatabase,
  type DatabaseV2,
  type MigrationOptions,
  type QueuedOperation,
  type StoredIncident,
} from './local-database';

export type NewOperation = Readonly<{
  operationId?: string;
  incidentId: string;
  baseVersion: number;
  actorId: string;
  action: string;
  payload: Readonly<Record<string, unknown>>;
}>;

export type QueueOptions = MigrationOptions &
  Readonly<{
    createOperationId?: () => string;
  }>;

export class IdempotencyKeyReusedError extends Error {
  constructor(operationId: string) {
    super(`operationId ${operationId} was already used with different content`);
    this.name = 'IdempotencyKeyReusedError';
  }
}

export class UnknownOperationError extends Error {
  constructor(operationId: string) {
    super(`operationId ${operationId} is not in the queue`);
    this.name = 'UnknownOperationError';
  }
}

/** The backend requires Idempotency-Key with at least 8 characters. */
export function createOperationId(): string {
  return `op-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

function sameContent(a: NewOperation, b: QueuedOperation): boolean {
  return (
    a.incidentId === b.incidentId &&
    a.baseVersion === b.baseVersion &&
    a.actorId === b.actorId &&
    a.action === b.action &&
    JSON.stringify(a.payload) === JSON.stringify(b.payload)
  );
}

/**
 * Offline queue persisted in the local database. Every mutation rewrites the whole
 * document with a single atomic `setItem`, and mutations are serialized so two
 * concurrent writes cannot overwrite each other.
 */
export class PersistentOperationQueue {
  private writes: Promise<void> = Promise.resolve();

  private constructor(
    private readonly storage: KeyValueStorage,
    private database: DatabaseV2,
    private readonly options: QueueOptions,
  ) {}

  static async open(storage: KeyValueStorage, options: QueueOptions = {}): Promise<PersistentOperationQueue> {
    const { database } = await openLocalDatabase(storage, options);
    const unique = { ...database, operations: deduplicateOperations(database.operations) };
    return new PersistentOperationQueue(storage, unique, options);
  }

  list(): readonly QueuedOperation[] {
    return this.database.operations;
  }

  pending(): readonly QueuedOperation[] {
    return this.database.operations.filter((operation) => operation.state === 'pending');
  }

  incidents(): readonly StoredIncident[] {
    return this.database.incidents;
  }

  enqueue(input: NewOperation): Promise<QueuedOperation> {
    return this.mutate((database) => {
      const operationId = input.operationId ?? (this.options.createOperationId ?? createOperationId)();
      const existing = database.operations.find((operation) => operation.operationId === operationId);
      if (existing) {
        if (!sameContent(input, existing)) throw new IdempotencyKeyReusedError(operationId);
        return { database, result: existing };
      }
      const operation: QueuedOperation = {
        operationId,
        incidentId: input.incidentId,
        baseVersion: input.baseVersion,
        actorId: input.actorId,
        action: input.action,
        payload: { ...input.payload },
        createdAt: (this.options.now ?? (() => new Date().toISOString()))(),
        state: 'pending',
        attempts: 0,
        conflictFields: [],
      };
      return { database: { ...database, operations: [...database.operations, operation] }, result: operation };
    });
  }

  /** Only a confirmed operation leaves the queue. */
  confirm(operationId: string): Promise<void> {
    return this.mutate((database) => {
      this.require(database, operationId);
      const operations = database.operations.filter((operation) => operation.operationId !== operationId);
      return { database: { ...database, operations }, result: undefined };
    });
  }

  /** A conflict keeps the local intention in the queue until someone resolves it. */
  markConflict(operationId: string, fields: readonly string[]): Promise<QueuedOperation> {
    return this.update(operationId, (operation) => ({
      ...operation,
      state: 'conflict',
      attempts: operation.attempts + 1,
      conflictFields: [...fields].sort(),
    }));
  }

  /** Network errors, timeouts and 5xx keep the operation pending with the same identity. */
  recordFailedAttempt(operationId: string): Promise<QueuedOperation> {
    return this.update(operationId, (operation) => ({ ...operation, attempts: operation.attempts + 1 }));
  }

  /**
   * Moves a pending operation onto a newer server version after resolveSync merged it without
   * conflicts. The operationId stays the same, so the server still applies it at most once.
   */
  rebase(operationId: string, baseVersion: number): Promise<QueuedOperation> {
    return this.update(operationId, (operation) => {
      if (operation.state !== 'pending') throw new Error(`operationId ${operationId} is not pending`);
      return { ...operation, baseVersion };
    });
  }

  /** Explicit user decision to drop a conflicting local intention. Never called automatically. */
  dismissConflict(operationId: string): Promise<void> {
    return this.mutate((database) => {
      const operation = this.require(database, operationId);
      if (operation.state !== 'conflict') throw new Error(`operationId ${operationId} is not in conflict`);
      const operations = database.operations.filter((item) => item.operationId !== operationId);
      return { database: { ...database, operations }, result: undefined };
    });
  }

  upsertIncident(incident: StoredIncident): Promise<void> {
    return this.mutate((database) => {
      const incidents = database.incidents.filter((item) => item.id !== incident.id);
      return { database: { ...database, incidents: [...incidents, { ...incident }] }, result: undefined };
    });
  }

  private update(
    operationId: string,
    change: (operation: QueuedOperation) => QueuedOperation,
  ): Promise<QueuedOperation> {
    return this.mutate((database) => {
      const current = this.require(database, operationId);
      const next = change(current);
      const operations = database.operations.map((operation) =>
        operation.operationId === operationId ? next : operation,
      );
      return { database: { ...database, operations }, result: next };
    });
  }

  private require(database: DatabaseV2, operationId: string): QueuedOperation {
    const operation = database.operations.find((item) => item.operationId === operationId);
    if (!operation) throw new UnknownOperationError(operationId);
    return operation;
  }

  private mutate<T>(change: (database: DatabaseV2) => { database: DatabaseV2; result: T }): Promise<T> {
    const run = this.writes.then(async () => {
      const { database, result } = change(this.database);
      if (database !== this.database) {
        await this.storage.setItem(DATABASE_KEY, JSON.stringify(database));
        this.database = database;
      }
      return result;
    });
    this.writes = run.then(
      () => undefined,
      () => undefined,
    );
    return run;
  }
}
