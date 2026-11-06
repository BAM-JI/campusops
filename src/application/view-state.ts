import type { ApiError } from '../domain/result';
import { reduceRemoteResponses, type RemoteResponse } from './remote-responses';

/**
 * What a screen can show for one remote query. A single union, so impossible combinations
 * (for example "loading" and "error" at the same time) cannot be represented.
 * See docs/ui-state-machine.mmd for the transitions and the action available in each state.
 */
export type ViewState<T> =
  | Readonly<{ kind: 'idle' }>
  | Readonly<{ kind: 'loading' }>
  | Readonly<{ kind: 'success'; value: T }>
  | Readonly<{ kind: 'empty' }>
  | Readonly<{ kind: 'error'; error: ApiError['kind'] }>
  | Readonly<{ kind: 'offline'; error: 'timeout' | 'network' }>
  | Readonly<{ kind: 'cancelled' }>;

/** Requests of one query: only `activeRequestId` matters; older responses stay but never win. */
export type RequestTracker = Readonly<{
  activeRequestId: string | null;
  responses: readonly RemoteResponse[];
  cancelled: boolean;
}>;

export type TrackerEvent =
  | Readonly<{ type: 'request'; requestId: string }>
  | Readonly<{ type: 'response'; response: RemoteResponse }>
  | Readonly<{ type: 'cancel' }>
  | Readonly<{ type: 'clear' }>;

export const IDLE_TRACKER: RequestTracker = { activeRequestId: null, responses: [], cancelled: false };

/** Keeps the evidence of a few recent responses without growing forever. */
const MAX_RESPONSES = 20;

export function trackRequests(state: RequestTracker, event: TrackerEvent): RequestTracker {
  switch (event.type) {
    case 'request':
      return { activeRequestId: event.requestId, responses: state.responses, cancelled: false };
    case 'response':
      return { ...state, responses: [...state.responses, event.response].slice(-MAX_RESPONSES) };
    case 'cancel':
      // Cancelling only makes sense while the active request has no answer yet.
      return toViewState(state, (value) => value).kind === 'loading' ? { ...state, cancelled: true } : state;
    case 'clear':
      return IDLE_TRACKER;
  }
}

const OFFLINE_KINDS: readonly string[] = ['timeout', 'network'];

/** Derives the view from the active request with `reduceRemoteResponses`; `isEmpty` marks an empty success. */
export function toViewState<T>(
  tracker: RequestTracker,
  map: (value: unknown) => T,
  isEmpty: (value: T) => boolean = () => false,
): ViewState<T> {
  if (tracker.activeRequestId === null) return { kind: 'idle' };
  // The user's decision wins: an answer that arrives after cancelling is not shown.
  if (tracker.cancelled) return { kind: 'cancelled' };
  const resolution = reduceRemoteResponses({ activeRequestId: tracker.activeRequestId, responses: tracker.responses });
  if (resolution.state === 'loading') return { kind: 'loading' };
  if (resolution.state === 'error') {
    if (OFFLINE_KINDS.includes(resolution.error)) return { kind: 'offline', error: resolution.error as 'timeout' | 'network' };
    return { kind: 'error', error: resolution.error as ApiError['kind'] };
  }
  const value = map(resolution.value);
  return isEmpty(value) ? { kind: 'empty' } : { kind: 'success', value };
}
