import { Incident, IncidentListItem, IIncidentRepository, toIncidentListItem } from '../domain/incident';

export class GetIncidentsUseCase {
  constructor(private readonly repository: IIncidentRepository) {}

  async execute(): Promise<IncidentListItem[]> {
    const items = await this.repository.getAll();
    return items.map(toIncidentListItem);
  }
}

export class GetIncidentDetailUseCase {
  constructor(private readonly repository: IIncidentRepository) {}

  async execute(id: string): Promise<Incident | null> {
    return this.repository.getById(id);
  }
}