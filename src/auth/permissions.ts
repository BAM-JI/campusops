import type { CampusRole } from '../campusops/contracts';
import type { Incident, IncidentAction } from '../domain/incident';

const COORDINATOR_ACTIONS: readonly IncidentAction[] = ['assign', 'prioritize', 'close', 'reopen'];
const TECHNICIAN_ACTIONS: readonly IncidentAction[] = ['start', 'resolve'];

export function canSee(role: CampusRole, actorId: string, incident: Incident): boolean {
  if (role === 'coordinator') return true;
  if (role === 'reporter') return incident.reporterId === actorId;
  return incident.assignedTechnicianId === actorId;
}

export function canCreateIncident(role: CampusRole): boolean {
  return role === 'reporter';
}

/**
 * Profile rules from docs/CAMPUSOPS.md, used only to decide which buttons the UI shows.
 * Hiding a button is not authorization: the server validates every action again (403),
 * and the client tests prove that 403 against the real backend.
 */
export function canPerform(role: CampusRole, actorId: string, action: IncidentAction, incident: Incident): boolean {
  if (COORDINATOR_ACTIONS.includes(action)) return role === 'coordinator';
  if (TECHNICIAN_ACTIONS.includes(action)) return role === 'technician' && incident.assignedTechnicianId === actorId;
  return canSee(role, actorId, incident);
}
