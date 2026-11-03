// Week 09 evidence: ONE real request to the public provider (OpenStreetMap Nominatim) with a
// generic, fictitious query. Never use a person's address. Automated tests do not call this.
// Requires Node >= 22.18 (runs the TypeScript adapter with type stripping).
//
//   node scripts/geocode-real-once.mjs "Biblioteca Central Universidad"
//
// Prints a sanitized record: date, provider, query, outcome and the decision of
// selectIncidentLocation, with coordinates rounded to 2 decimals.
import { NominatimGeocodingAdapter } from '../src/location/nominatim-adapter.ts';
import { selectIncidentLocation } from '../src/location/select-incident-location.ts';

const query = process.argv[2] ?? 'Biblioteca Central Universidad';
const adapter = new NominatimGeocodingAdapter({
  userAgent: 'CampusOps-DMI-course/1.0 (proyecto escolar, datos ficticios)',
  timeoutMs: 8000,
});
const startedAt = Date.now();
const lookup = await adapter.geocode(query);
const location = selectIncidentLocation(lookup.kind === 'result' ? lookup.data : { status: lookup.status ?? lookup.reason }, query);
const round = (value) => (typeof value === 'number' ? Math.round(value * 100) / 100 : undefined);
process.stdout.write(
  `${JSON.stringify(
    {
      executedAt: new Date(startedAt).toISOString(),
      provider: 'OpenStreetMap Nominatim',
      endpoint: 'GET https://nominatim.openstreetmap.org/search?format=json&limit=1&q=<query>',
      query,
      outcome: lookup.kind === 'result' ? 'result' : `unavailable:${lookup.reason}`,
      durationMs: Date.now() - startedAt,
      decision: { source: location.source, label: location.label, latitude: round(location.latitude), longitude: round(location.longitude) },
    },
    null,
    2,
  )}\n`,
);
