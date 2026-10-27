import { DATABASE_KEY } from '../../src/persistence/local-database';
import {
  IdempotencyKeyReusedError,
  PersistentOperationQueue,
} from '../../src/persistence/operation-queue';
import { deduplicateOperations } from '../../src/sync/deduplicate-operations';
import { createFileStorage, createTempDirectory } from '../support/file-storage';
import { FIXED_NOW } from './fixtures';

const options = { now: () => FIXED_NOW };

const offlineStart = {
  operationId: 'op-offline-start-001',
  incidentId: 'campus-inc-001',
  baseVersion: 1,
  actorId: 'technician-1',
  action: 'start',
  payload: {},
};

const pendingPhoto = {
  operationId: 'op-offline-photo-001',
  incidentId: 'campus-inc-001',
  baseVersion: 1,
  actorId: 'technician-1',
  action: 'add_evidence',
  payload: { evidenceId: 'photo-pending-001', uploaded: false },
};

describe('week 08 persistent queue', () => {
  test('restart keeps the same operation identity and content', async () => {
    const directory = createTempDirectory();
    const firstRun = await PersistentOperationQueue.open(createFileStorage(directory), options);
    await firstRun.enqueue(offlineStart);
    await firstRun.enqueue({
      operationId: 'op-offline-note-001',
      incidentId: 'campus-inc-001',
      baseVersion: 1,
      actorId: 'technician-1',
      action: 'comment',
      payload: { text: 'Nota ficticia: switch reiniciado' },
    });
    await firstRun.enqueue(pendingPhoto);
    const before = firstRun.list();

    const afterRestart = await PersistentOperationQueue.open(createFileStorage(directory), options);

    expect(afterRestart.list()).toEqual(before);
    expect(afterRestart.list().map((operation) => operation.operationId)).toEqual([
      'op-offline-start-001',
      'op-offline-note-001',
      'op-offline-photo-001',
    ]);
    expect(afterRestart.list()[2]?.payload).toEqual({ evidenceId: 'photo-pending-001', uploaded: false });
  });

  test('persisted queue never stores session tokens', async () => {
    const directory = createTempDirectory();
    const storage = createFileStorage(directory);
    const queue = await PersistentOperationQueue.open(storage, options);
    await queue.enqueue(offlineStart);

    const raw = (await storage.getItem(DATABASE_KEY)) ?? '';
    expect(raw).not.toMatch(/token|authorization/i);
  });

  test('generated operationId is stable after restart and long enough for Idempotency-Key', async () => {
    const directory = createTempDirectory();
    const queue = await PersistentOperationQueue.open(createFileStorage(directory), options);
    const created = await queue.enqueue({
      incidentId: 'campus-inc-001',
      baseVersion: 1,
      actorId: 'technician-1',
      action: 'start',
      payload: {},
    });

    const reopened = await PersistentOperationQueue.open(createFileStorage(directory), options);
    expect(created.operationId.length).toBeGreaterThanOrEqual(8);
    expect(reopened.list()[0]?.operationId).toBe(created.operationId);
  });

  test('re-enqueueing the same operationId keeps one entry; different content is rejected', async () => {
    const directory = createTempDirectory();
    const queue = await PersistentOperationQueue.open(createFileStorage(directory), options);
    await queue.enqueue(offlineStart);
    await queue.enqueue(offlineStart);

    await expect(queue.enqueue({ ...offlineStart, action: 'resolve' })).rejects.toBeInstanceOf(
      IdempotencyKeyReusedError,
    );
    const reopened = await PersistentOperationQueue.open(createFileStorage(directory), options);
    expect(reopened.list()).toHaveLength(1);
    expect(reopened.list()[0]?.action).toBe('start');
  });

  test('only confirmed operations leave the queue; failures and conflicts stay', async () => {
    const directory = createTempDirectory();
    const queue = await PersistentOperationQueue.open(createFileStorage(directory), options);
    await queue.enqueue(offlineStart);
    await queue.enqueue(pendingPhoto);
    await queue.enqueue({ ...pendingPhoto, operationId: 'op-offline-photo-002', payload: { evidenceId: 'photo-pending-002' } });

    await queue.confirm('op-offline-photo-001');
    await queue.recordFailedAttempt('op-offline-photo-002');
    await queue.markConflict('op-offline-start-001', ['work']);

    const reopened = await PersistentOperationQueue.open(createFileStorage(directory), options);
    expect(reopened.list().map((operation) => [operation.operationId, operation.state, operation.attempts])).toEqual([
      ['op-offline-start-001', 'conflict', 1],
      ['op-offline-photo-002', 'pending', 1],
    ]);
    expect(reopened.list()[0]?.conflictFields).toEqual(['work']);
    expect(reopened.pending().map((operation) => operation.operationId)).toEqual(['op-offline-photo-002']);
  });

  test('concurrent enqueues are serialized and none is lost', async () => {
    const directory = createTempDirectory();
    const queue = await PersistentOperationQueue.open(createFileStorage(directory), options);
    await Promise.all(
      ['a', 'b', 'c', 'd'].map((suffix) =>
        queue.enqueue({ ...offlineStart, operationId: `op-concurrent-${suffix}`, action: 'comment', payload: { text: suffix } }),
      ),
    );

    const reopened = await PersistentOperationQueue.open(createFileStorage(directory), options);
    expect(reopened.list()).toHaveLength(4);
  });

  test('deduplicateOperations keeps the first occurrence without mutating the input', () => {
    const operations = [
      { operationId: 'op-1', value: 'first' },
      { operationId: 'op-1', value: 'replayed' },
      { operationId: 'op-2', value: 'other' },
    ];
    const snapshot = JSON.stringify(operations);

    expect(deduplicateOperations(operations)).toEqual([operations[0], operations[2]]);
    expect(JSON.stringify(operations)).toBe(snapshot);
  });
});
