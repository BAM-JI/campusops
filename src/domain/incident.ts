import type { CampusRole, IncidentCategory, IncidentStatus } from '../campusops/contracts';
import type { ApiResult } from './result';

export type { IncidentStatus } from '../campusops/contracts';

export type UserRole = CampusRole;

export type IncidentPriority = 'low' | 'medium' | 'high';

export type IncidentAction =
  | 'assign'
  | 'prioritize'
  | 'start'
  | 'resolve'
  | 'close'
  | 'reopen'
  | 'comment'
  | 'add_evidence';

/** Domain incident, built only from a DTO that passed `parseIncident` (src/api/incident-dto.ts). */
export interface Incident {
  id: string;
  version: number;
  status: IncidentStatus;
  category: IncidentCategory;
  description: string;
  location: string;
  reporterId: string;
  assignedTechnicianId: string | null;
  priority: IncidentPriority;
}

export type NewIncident = Readonly<{
  category: IncidentCategory;
  description: string;
  location: string;
}>;

export type WriteResult = Readonly<{ incident: Incident; operationId: string; duplicate: boolean }>;

/**
 * Port (ADR-001). Implemented by the HTTP adapter `IncidentClient` and by the in-memory fake.
 * Failures are values (`ApiResult`), never exceptions, so the UI can show a typed state.
 */
export interface IIncidentRepository {
  getAll(): Promise<ApiResult<readonly Incident[]>>;
  getById(id: string): Promise<ApiResult<Incident>>;
  create(input: NewIncident, idempotencyKey: string): Promise<ApiResult<WriteResult>>;
  act(
    incidentId: string,
    action: IncidentAction,
    baseVersion: number,
    payload: Readonly<Record<string, unknown>>,
    idempotencyKey: string,
  ): Promise<ApiResult<WriteResult>>;
}
