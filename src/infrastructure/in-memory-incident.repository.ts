import type { IIncidentRepository, Incident, IncidentAction, NewIncident, WriteResult } from '../domain/incident';
import { failure, success, type ApiResult } from '../domain/result';

/** Fake adapter for UI and use-case tests without network (ADR-001). Fictitious data only. */
export class InMemoryIncidentRepository implements IIncidentRepository {
  private items: Incident[] = [
    {
      id: 'campus-inc-001',
      version: 1,
      status: 'assigned',
      category: 'connectivity',
      description: 'Sin conexión en laboratorio ficticio',
      location: 'Edificio de prueba A',
      reporterId: 'reporter-1',
      assignedTechnicianId: 'technician-1',
      priority: 'medium',
    },
  ];
  private readonly results = new Map<string, WriteResult>();
  private sequence = 100;

  async getAll(): Promise<ApiResult<readonly Incident[]>> {
    return success(this.items.map((item) => ({ ...item })));
  }

  async getById(id: string): Promise<ApiResult<Incident>> {
    const item = this.items.find((incident) => incident.id === id);
    return item ? success({ ...item }) : failure({ kind: 'not_found' });
  }

  async create(input: NewIncident, idempotencyKey: string): Promise<ApiResult<WriteResult>> {
    const previous = this.results.get(idempotencyKey);
    if (previous) return success({ ...previous, duplicate: true });
    const incident: Incident = {
      id: `campus-inc-${++this.sequence}`,
      version: 1,
      status: 'open',
      ...input,
      reporterId: 'reporter-1',
      assignedTechnicianId: null,
      priority: 'medium',
    };
    this.items = [...this.items, incident];
    const result = { incident: { ...incident }, operationId: idempotencyKey, duplicate: false };
    this.results.set(idempotencyKey, result);
    return success(result);
  }

  async act(
    incidentId: string,
    _action: IncidentAction,
    baseVersion: number,
    _payload: Readonly<Record<string, unknown>>,
    idempotencyKey: string,
  ): Promise<ApiResult<WriteResult>> {
    const previous = this.results.get(idempotencyKey);
    if (previous) return success({ ...previous, duplicate: true });
    const current = this.items.find((item) => item.id === incidentId);
    if (!current) return failure({ kind: 'not_found' });
    if (current.version !== baseVersion) return failure({ kind: 'conflict', code: 'version_conflict' });
    const next = { ...current, version: current.version + 1 };
    this.items = this.items.map((item) => (item.id === incidentId ? next : item));
    const result = { incident: { ...next }, operationId: idempotencyKey, duplicate: false };
    this.results.set(idempotencyKey, result);
    return success(result);
  }
}
