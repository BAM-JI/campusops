import type { IncidentLocation } from '../campusops/contracts';

function isFiniteInRange(value: unknown, min: number, max: number): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= min && value <= max;
}

/**
 * Week 09 contract (docs/CAMPUSOPS_API.md). Accepts the provider result only when it is an object
 * with a non-empty textual `label` and finite coordinates inside latitude [-90, 90] and longitude
 * [-180, 180]. Anything else (null, an error represented as data such as `{ status: 429 }`, an
 * incomplete object, invalid coordinates or wrong types) keeps the label the user typed, with no
 * coordinates: CampusOps never invents a position.
 */
export function selectIncidentLocation(provider: unknown, manualLabel: string): IncidentLocation {
  if (typeof provider === 'object' && provider !== null && !Array.isArray(provider)) {
    const { label, latitude, longitude } = provider as Record<string, unknown>;
    if (
      typeof label === 'string' &&
      label.trim().length > 0 &&
      isFiniteInRange(latitude, -90, 90) &&
      isFiniteInRange(longitude, -180, 180)
    ) {
      return { source: 'provider', label, latitude, longitude };
    }
  }
  return { source: 'manual', label: manualLabel };
}
