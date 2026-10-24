import type { CampusRole } from '../campusops/contracts';
import { canCreateIncident, canPerform } from '../auth/permissions';
import type { IIncidentRepository, Incident, IncidentAction, NewIncident, WriteResult } from '../domain/incident';
import { failure, type ApiResult } from '../domain/result';

/** Same format the backend accepts as Idempotency-Key (at least 8 characters). */
export function createIdempotencyKey(): string {
  return `op-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

export class GetIncidentsUseCase {
  constructor(private readonly repository: IIncidentRepository) {}

  execute(): Promise<ApiResult<readonly Incident[]>> {
    return this.repository.getAll();
  }
}

export class GetIncidentDetailUseCase {
  constructor(private readonly repository: IIncidentRepository) {}

  execute(id: string): Promise<ApiResult<Incident>> {
    return this.repository.getById(id);
  }
}

export class CreateIncidentUseCase {
  constructor(private readonly repository: IIncidentRepository) {}

  /**
   * Pass the same `idempotencyKey` when retrying the same draft after a timeout,
   * so the server does not create the incident twice.
   */
  execute(
    role: CampusRole,
    input: NewIncident,
    idempotencyKey: string = createIdempotencyKey(),
  ): Promise<ApiResult<WriteResult>> {
    if (!canCreateIncident(role)) return Promise.resolve(failure({ kind: 'forbidden' }));
    if (input.description.trim() === '' || input.location.trim() === '') {
      return Promise.resolve(failure({ kind: 'rejected', status: 422, code: 'invalid_incident' }));
    }
    return this.repository.create(input, idempotencyKey);
  }
}

export class PerformIncidentActionUseCase {
  constructor(private readonly repository: IIncidentRepository) {}

  /** The local check only avoids a pointless request; the server is still the authority (403). */
  execute(
    identity: Readonly<{ actorId: string; role: CampusRole }>,
    incident: Incident,
    action: IncidentAction,
    payload: Readonly<Record<string, unknown>>,
    idempotencyKey: string = createIdempotencyKey(),
  ): Promise<ApiResult<WriteResult>> {
    if (!canPerform(identity.role, identity.actorId, action, incident)) {
      return Promise.resolve(failure({ kind: 'forbidden' }));
    }
    return this.repository.act(incident.id, action, incident.version, payload, idempotencyKey);
  }
}
