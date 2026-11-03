import type { IncidentLocation } from '../campusops/contracts';
import type { GeocodingPort } from '../location/geocoding-adapter';
import { selectIncidentLocation } from '../location/select-incident-location';

/** What the form tells the user after looking up a location. */
export type LocationNotice = 'provider' | 'provider_unavailable' | 'provider_invalid';

export type ResolvedLocation = Readonly<{ location: IncidentLocation; notice: LocationNotice }>;

/**
 * Looks up what the user typed (building, zone or reference) and decides with
 * `selectIncidentLocation`. A provider that is down, slow, rate limited or returns invalid data
 * never blocks the report: the typed text is kept as a manual location, without coordinates.
 */
export class ResolveIncidentLocationUseCase {
  constructor(private readonly geocoder: GeocodingPort) {}

  async execute(typedLocation: string): Promise<ResolvedLocation> {
    const manualLabel = typedLocation.trim();
    let provider: unknown = null;
    let unavailable = false;
    try {
      const lookup = await this.geocoder.geocode(manualLabel);
      if (lookup.kind === 'result') provider = lookup.data;
      else {
        unavailable = true;
        // Error represented as data, as the contract describes ({ status: 429 }...).
        provider = { status: lookup.status ?? lookup.reason };
      }
    } catch {
      unavailable = true;
    }
    const location = selectIncidentLocation(provider, manualLabel);
    if (location.source === 'provider') return { location, notice: 'provider' };
    return { location, notice: unavailable ? 'provider_unavailable' : 'provider_invalid' };
  }
}
