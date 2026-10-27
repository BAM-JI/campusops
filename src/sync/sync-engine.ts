import type { Incident, IIncidentRepository, IncidentAction } from '../domain/incident';
import type { ApiError } from '../domain/result';
import type { QueuedOperation, StoredIncident } from '../persistence/local-database';
import type { PersistentOperationQueue } from '../persistence/operation-queue';
import type { SyncRecord } from '../course-evaluation/contracts';
import { resolveSync } from './resolve-sync';

export type SyncOutcome =
  | Readonly<{ operationId: string; result: 'confirmed'; duplicate: boolean }>
  | Readonly<{ operationId: string; result: 'conflict'; fields: readonly string[] }>
  | Readonly<{ operationId: string; result: 'pending'; error: ApiError['kind'] }>
  | Readonly<{ operationId: string; result: 'skipped'; reason: 'other_actor' | 'session_expired' }>;

export type SyncEngineOptions = Readonly<{
  queue: PersistentOperationQueue;
  /** `IncidentClient` in the app: it sends Idempotency-Key, X-Course-Actor and handles timeout and 401. */
  repository: IIncidentRepository;
  /** Actor of the current session. Operations of another actor are never sent with this session. */
  actorId: string;
}>;

const ACTIONS: readonly IncidentAction[] = ['assign', 'prioritize', 'start', 'resolve', 'close', 'reopen', 'comment', 'add_evidence'];

/** Errors after which the server may not have received the operation: retry later with the same identity. */
const RETRYABLE: readonly ApiError['kind'][] = ['timeout', 'network', 'server', 'rate_limited', 'contract'];

export function toStoredIncident(incident: Incident): StoredIncident {
  return {
    id: incident.id,
    version: incident.version,
    status: incident.status,
    payload: {
      category: incident.category,
      description: incident.description,
      location: incident.location,
      reporterId: incident.reporterId,
      assignedTechnicianId: incident.assignedTechnicianId,
      priority: incident.priority,
    },
  };
}

/** Fields compared by resolveSync. `work` groups status and assignee, as in the public contract. */
export function toSyncRecord(incident: StoredIncident): SyncRecord {
  const payload = incident.payload ?? {};
  return {
    id: incident.id,
    version: incident.version,
    fields: {
      work: { assignedTechnicianId: payload.assignedTechnicianId ?? null, status: incident.status },
      priority: payload.priority ?? null,
    },
  };
}

/** Fields an operation intends to change; used when the remote version cannot be read. */
export function intentFields(action: string): readonly string[] {
  if (action === 'prioritize') return ['priority'];
  if (action === 'comment') return ['notes'];
  if (action === 'add_evidence') return ['evidence'];
  return ['work'];
}

/** The local record after applying the queued intention on top of its base version. */
export function applyIntent(base: SyncRecord, operation: QueuedOperation): SyncRecord {
  const work = { ...(base.fields.work as Record<string, unknown>) };
  const fields: Record<string, unknown> = { ...base.fields };
  switch (operation.action) {
    case 'start':
      work.status = 'in_progress';
      break;
    case 'resolve':
      work.status = 'resolved';
      break;
    case 'close':
      work.status = 'closed';
      break;
    case 'reopen':
      work.status = work.assignedTechnicianId ? 'assigned' : 'open';
      break;
    case 'assign':
      work.assignedTechnicianId = operation.payload.technicianId ?? null;
      work.status = 'assigned';
      break;
    case 'prioritize':
      fields.priority = operation.payload.priority ?? null;
      break;
  }
  return { ...base, fields: { ...fields, work } };
}

/**
 * Sends the persisted queue to the server (docs/sync-policy.md). Only a 201 or a duplicate
 * confirmation removes an operation; errors keep it pending with the same operationId and
 * incompatible changes keep it as a conflict until someone resolves it explicitly.
 */
export class SyncEngine {
  constructor(private readonly options: SyncEngineOptions) {}

  async sync(): Promise<readonly SyncOutcome[]> {
    const outcomes: SyncOutcome[] = [];
    let sessionExpired = false;
    for (const operation of this.options.queue.pending()) {
      if (operation.actorId !== this.options.actorId) {
        outcomes.push({ operationId: operation.operationId, result: 'skipped', reason: 'other_actor' });
        continue;
      }
      if (sessionExpired) {
        outcomes.push({ operationId: operation.operationId, result: 'skipped', reason: 'session_expired' });
        continue;
      }
      const outcome = await this.send(operation, true);
      if (outcome.result === 'skipped' && outcome.reason === 'session_expired') sessionExpired = true;
      outcomes.push(outcome);
    }
    return outcomes;
  }

  private async send(operation: QueuedOperation, mayRebase: boolean): Promise<SyncOutcome> {
    const { queue, repository } = this.options;
    const { operationId } = operation;
    if (!ACTIONS.includes(operation.action as IncidentAction)) {
      const updated = await queue.markConflict(operationId, ['action']);
      return { operationId, result: 'conflict', fields: updated.conflictFields };
    }
    const response = await repository.act(
      operation.incidentId,
      operation.action as IncidentAction,
      operation.baseVersion,
      operation.payload,
      operationId,
    );
    if (response.ok) {
      await queue.upsertIncident(toStoredIncident(response.value.incident));
      await queue.confirm(operationId);
      return { operationId, result: 'confirmed', duplicate: response.value.duplicate };
    }

    const { error } = response;
    if (error.kind === 'unauthorized') return { operationId, result: 'skipped', reason: 'session_expired' };
    if (RETRYABLE.includes(error.kind)) {
      await queue.recordFailedAttempt(operationId);
      return { operationId, result: 'pending', error: error.kind };
    }
    if (error.kind === 'conflict' && error.code === 'idempotency_key_reused') {
      return this.conflict(operationId, ['operationId']);
    }
    if (error.kind === 'forbidden' || error.kind === 'not_found' || (error.kind === 'conflict' && error.code === 'version_conflict')) {
      return this.compareWithRemote(operation, mayRebase && error.kind === 'conflict');
    }
    // Invalid transition or rejected input: keep the local intention for the user to review.
    return this.conflict(operationId, intentFields(operation.action));
  }

  /** Three-way comparison between the stored base, the local intention and the server version. */
  private async compareWithRemote(operation: QueuedOperation, mayRebase: boolean): Promise<SyncOutcome> {
    const { queue, repository } = this.options;
    const remote = await repository.getById(operation.incidentId);
    if (!remote.ok) {
      // The technician can no longer read the incident: the assignment changed on the server.
      return this.conflict(operation.operationId, remote.error.kind === 'forbidden' || remote.error.kind === 'not_found' ? ['work'] : intentFields(operation.action));
    }
    const remoteStored = toStoredIncident(remote.value);
    // The local copy at baseVersion is kept as the base while the conflict is open.
    const base = queue
      .incidents()
      .find((incident) => incident.id === operation.incidentId && incident.version === operation.baseVersion);
    if (!base) return this.conflict(operation.operationId, intentFields(operation.action));

    const baseRecord = toSyncRecord(base);
    const resolution = resolveSync(baseRecord, applyIntent(baseRecord, operation), toSyncRecord(remoteStored));
    if (resolution.kind === 'conflict') return this.conflict(operation.operationId, resolution.fields);
    if (!mayRebase) return this.conflict(operation.operationId, intentFields(operation.action));

    // Independent changes: same operationId, new base version, one more attempt.
    await queue.upsertIncident(remoteStored);
    const rebased = await queue.rebase(operation.operationId, remoteStored.version);
    return this.send(rebased, false);
  }

  private async conflict(operationId: string, fields: readonly string[]): Promise<SyncOutcome> {
    const updated = await this.options.queue.markConflict(operationId, fields);
    return { operationId, result: 'conflict', fields: updated.conflictFields };
  }
}
