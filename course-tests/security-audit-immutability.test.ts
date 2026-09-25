import { redactForTelemetry } from '../src/security/redactForTelemetry';

test('redactForTelemetry does not mutate the original object', () => {
  const input = {
    authorization: 'Bearer course-token',
    incidentId: 'campus-inc-001',
    nested: { location: 'Zona ficticia' },
  };

  const result = redactForTelemetry(input) as Record<string, unknown>;

  expect(result.authorization).toBe('[REDACTED]');
  expect(input.authorization).toBe('Bearer course-token');
  expect(input.nested.location).toBe('Zona ficticia');
});
