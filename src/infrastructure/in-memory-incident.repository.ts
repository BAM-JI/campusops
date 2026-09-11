import { Incident, IIncidentRepository } from '../domain/incident';

export class InMemoryIncidentRepository implements IIncidentRepository {
  private readonly items: Incident[] = [
    {
      id: 'campus-inc-001',
      title: 'Fuga de agua en Laboratorio L-203',
      description: 'Goteo continuo bajo el fregadero principal con riesgo de encharcamiento.',
      category: 'plumbing',
      status: 'assigned',
      location: 'Edificio L, Aula 203',
      assignedTechnicianId: 'technician-1',
      reporterId: 'reporter-1',
      version: 1,
    },
    {
      id: 'campus-inc-002',
      title: 'Falla eléctrica en luminarias exteriores',
      description: 'Lámparas intermitentes en el andador central hacia biblioteca.',
      category: 'electrical',
      status: 'open',
      location: 'Andador Central Norte',
      reporterId: 'reporter-2',
      version: 1,
    },
  ];

  async getAll(): Promise<Incident[]> {
    return this.items.map((item) => ({ ...item }));
  }

  async getById(id: string): Promise<Incident | null> {
    const item = this.items.find((incident) => incident.id === id);
    return item ? { ...item } : null;
  }
}
