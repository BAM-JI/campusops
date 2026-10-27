import type { AuthEvent } from '../course-evaluation/contracts';

export type RefreshSummary = Readonly<{
  status: 'anonymous' | 'authenticated';
  activeGeneration: number | null;
  refreshCalls: number;
  retriedRequestIds: readonly string[];
  persistedToken: string | null;
}>;

/**
 * Renewal policy shared by `SessionManager`, written as a reducer over auth events:
 * - every 401 of the same token generation joins the refresh already in flight (one refresh per generation);
 * - a successful refresh retries each waiting request exactly once;
 * - a failed refresh or a logout drops the waiting requests and clears the persisted session.
 */
export function summarizeAuthEvents(events: readonly AuthEvent[]): RefreshSummary {
  let status: 'anonymous' | 'authenticated' = 'anonymous';
  let activeGeneration: number | null = null;
  let refreshCalls = 0;
  const waiting: string[] = [];
  const retriedRequestIds: string[] = [];
  let persistedToken: string | null = null;
  let refreshInFlightFor: number | null = null;

  const reset = () => {
    status = 'anonymous';
    activeGeneration = null;
    persistedToken = null;
    waiting.length = 0;
    refreshInFlightFor = null;
  };

  for (const event of events) {
    switch (event.type) {
      case 'logout':
      case 'refreshFailed':
        reset();
        break;
      case 'request401': {
        const generation = event.generation ?? 0;
        if (event.requestId !== undefined && event.requestId.trim() !== '' && !waiting.includes(event.requestId)) {
          waiting.push(event.requestId);
        }
        if (refreshInFlightFor !== generation) {
          refreshInFlightFor = generation;
          refreshCalls += 1;
        }
        break;
      }
      case 'refreshSucceeded':
        status = 'authenticated';
        activeGeneration = event.generation ?? null;
        persistedToken = event.token ?? null;
        refreshInFlightFor = null;
        retriedRequestIds.push(...waiting.splice(0));
        break;
    }
  }

  return { status, activeGeneration, refreshCalls, retriedRequestIds, persistedToken };
}
