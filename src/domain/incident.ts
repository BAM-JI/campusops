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

export interface IIncidentRepository {
  getAll(): Promise<Incident[]>;
  getById(id: string): Promise<Incident | null>;
}