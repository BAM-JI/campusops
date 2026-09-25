export type IncidentStatus = 'open' | 'assigned' | 'in_progress' | 'resolved' | 'closed';

export type UserRole = 'reporter' | 'technician' | 'coordinator';

export interface Incident {
  id: string;
  title: string;
  description: string;
  category: string;
  status: IncidentStatus;
  location: string;
  assignedTechnicianId?: string;
  reporterId: string;
  version: number;
}

export type IncidentListItem = Pick<Incident, 'id' | 'title' | 'status' | 'category'>;

export function toIncidentListItem(incident: Incident): IncidentListItem {
  return {
    id: incident.id,
    title: incident.title,
    status: incident.status,
    category: incident.category,
  };
}

export interface IIncidentRepository {
  getAll(): Promise<Incident[]>;
  getById(id: string): Promise<Incident | null>;
}