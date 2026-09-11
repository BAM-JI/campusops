import { Incident, IIncidentRepository } from '../domain/incident';

export class GetIncidentsUseCase {
  constructor(private readonly repository: IIncidentRepository) {}

  async execute(): Promise<Incident[]> {
    return this.repository.getAll();
  }
}

export class GetIncidentDetailUseCase {
  constructor(private readonly repository: IIncidentRepository) {}

  async execute(id: string): Promise<Incident | null> {
    return this.repository.getById(id);
  }
}