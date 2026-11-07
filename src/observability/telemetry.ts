
import { redactForTelemetry } from './redact';

export type TelemetryEvent = Readonly<{
  event: string;
  correlationId: string;
  route: string;
  attempt: number;
  outcome: string;
  durationMs: number;
}>;

export type TelemetrySink = (
  record: Readonly<Record<string, unknown>>
) => void;

export function createCorrelationId(): string {
  const random = Math.random().toString(36).slice(2);
  return `corr-${Date.now().toString(36)}-${random}`;
}

export function createTelemetry(
  sink: TelemetrySink
) {
  return {
    logEvent(event: TelemetryEvent): void {
      const sanitized = redactForTelemetry(event);

      if (
        sanitized !== null &&
        typeof sanitized === 'object' &&
        !Array.isArray(sanitized)
      ) {
        sink(sanitized as Readonly<Record<string, unknown>>);
      }
    },
  };
}
