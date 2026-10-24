import type { ParseResult } from '../course-evaluation/contracts';
import type { CampusRole, IncidentCategory, IncidentStatus } from '../campusops/contracts';
import type { Incident, IncidentPriority } from '../domain/incident';

/**
 * Boundary between the remote DTO and the domain.
 * 1. `parseRemoteResource` validates only the published envelope `{ id, version, status, payload }`.
 * 2. `toIncident` validates the domain fields inside the payload before the app uses them.
 * Anything that fails either step becomes `{ ok: false, error: 'contract' }`; no data is invented.
 */

const STATUSES: readonly IncidentStatus[] = ['open', 'assigned', 'in_progress', 'resolved', 'closed'];
const CATEGORIES: readonly IncidentCategory[] = [
  'electrical',
  'laboratory',
  'water',
  'connectivity',
  'equipment',
  'safety',
  'maintenance',
];
const PRIORITIES: readonly IncidentPriority[] = ['low', 'medium', 'high'];
const ROLES: readonly CampusRole[] = ['reporter', 'technician', 'coordinator'];

type Envelope = Extract<ParseResult, { ok: true }>['value'];

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

const CONTRACT_ERROR = { ok: false, error: 'contract' } as const;

export function parseRemoteResource(input: unknown): ParseResult {
  if (!isRecord(input)) return CONTRACT_ERROR;
  const { id, version, status, payload } = input;
  if (!isNonEmptyString(id) || !isNonEmptyString(status)) return CONTRACT_ERROR;
  if (typeof version !== 'number' || !Number.isInteger(version) || version < 0) return CONTRACT_ERROR;
  if (payload !== null && !isRecord(payload)) return CONTRACT_ERROR;
  // Future envelope fields are ignored on purpose: only the published fields are copied.
  return { ok: true, value: { id, version, status, payload: payload === null ? null : { ...payload } } };
}

export type IncidentParseResult = Readonly<{ ok: true; value: Incident }> | Readonly<{ ok: false; error: 'contract' }>;

/** Domain validation. A valid `payload: null` (nullable scenario) is still not enough to build an incident. */
export function toIncident(envelope: Envelope): IncidentParseResult {
  if (!STATUSES.includes(envelope.status as IncidentStatus) || envelope.payload === null) return CONTRACT_ERROR;
  const payload = envelope.payload;
  const assigned = payload.assignedTechnicianId;
  if (
    !CATEGORIES.includes(payload.category as IncidentCategory) ||
    !isNonEmptyString(payload.description) ||
    !isNonEmptyString(payload.location) ||
    !isNonEmptyString(payload.reporterId) ||
    !(assigned === null || isNonEmptyString(assigned)) ||
    !PRIORITIES.includes(payload.priority as IncidentPriority)
  ) {
    return CONTRACT_ERROR;
  }
  return {
    ok: true,
    value: {
      id: envelope.id,
      version: envelope.version,
      status: envelope.status as IncidentStatus,
      category: payload.category as IncidentCategory,
      description: payload.description,
      location: payload.location,
      reporterId: payload.reporterId,
      assignedTechnicianId: assigned,
      priority: payload.priority as IncidentPriority,
    },
  };
}

export function parseIncident(input: unknown): IncidentParseResult {
  const envelope = parseRemoteResource(input);
  return envelope.ok ? toIncident(envelope.value) : CONTRACT_ERROR;
}

/**
 * `items` must be an array (otherwise the whole response is a contract error). As decided in
 * docs/api-contract.md, an invalid item is left out instead of breaking the whole list; `rejected`
 * counts them so the UI can say that some incidents could not be shown.
 */
export function parseIncidentList(
  input: unknown,
):
  | Readonly<{ ok: true; value: readonly Incident[]; rejected: number }>
  | Readonly<{ ok: false; error: 'contract' }> {
  if (!isRecord(input) || !Array.isArray(input.items)) return CONTRACT_ERROR;
  const incidents: Incident[] = [];
  let rejected = 0;
  for (const item of input.items) {
    const parsed = parseIncident(item);
    if (parsed.ok) incidents.push(parsed.value);
    else rejected += 1;
  }
  return { ok: true, value: incidents, rejected };
}

/** Result of a write: `{ incident, operationId, duplicate }`. */
export function parseWriteResult(
  input: unknown,
):
  | Readonly<{ ok: true; value: Readonly<{ incident: Incident; operationId: string; duplicate: boolean }> }>
  | Readonly<{ ok: false; error: 'contract' }> {
  if (!isRecord(input) || !isNonEmptyString(input.operationId) || typeof input.duplicate !== 'boolean') {
    return CONTRACT_ERROR;
  }
  const incident = parseIncident(input.incident);
  if (!incident.ok) return CONTRACT_ERROR;
  return { ok: true, value: { incident: incident.value, operationId: input.operationId, duplicate: input.duplicate } };
}

export type SessionDto = Readonly<{
  actorId: string;
  role: CampusRole;
  accessToken: string;
  refreshToken: string;
  expiresIn: number;
}>;

export function parseSession(input: unknown): Readonly<{ ok: true; value: SessionDto }> | Readonly<{ ok: false; error: 'contract' }> {
  if (
    !isRecord(input) ||
    !isNonEmptyString(input.actorId) ||
    !ROLES.includes(input.role as CampusRole) ||
    !isNonEmptyString(input.accessToken) ||
    !isNonEmptyString(input.refreshToken) ||
    typeof input.expiresIn !== 'number' ||
    !Number.isFinite(input.expiresIn) ||
    input.expiresIn <= 0
  ) {
    return CONTRACT_ERROR;
  }
  return {
    ok: true,
    value: {
      actorId: input.actorId,
      role: input.role as CampusRole,
      accessToken: input.accessToken,
      refreshToken: input.refreshToken,
      expiresIn: input.expiresIn,
    },
  };
}

export type RefreshDto = Readonly<{ accessToken: string; refreshToken: string; expiresIn: number }>;

export function parseRefresh(input: unknown): Readonly<{ ok: true; value: RefreshDto }> | Readonly<{ ok: false; error: 'contract' }> {
  if (
    !isRecord(input) ||
    !isNonEmptyString(input.accessToken) ||
    !isNonEmptyString(input.refreshToken) ||
    typeof input.expiresIn !== 'number' ||
    !Number.isFinite(input.expiresIn) ||
    input.expiresIn <= 0
  ) {
    return CONTRACT_ERROR;
  }
  return { ok: true, value: { accessToken: input.accessToken, refreshToken: input.refreshToken, expiresIn: input.expiresIn } };
}
