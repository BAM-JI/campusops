import type { RemoteResponse } from '../course-evaluation/contracts';

export type { RemoteResponse } from '../course-evaluation/contracts';

export type RemoteResolution =
  | Readonly<{ state: 'loading' }>
  | Readonly<{ state: 'success'; value: unknown }>
  | Readonly<{ state: 'error'; error: string }>;

/**
 * Only the response of the active request decides what the screen shows. Responses of older
 * requests (a previous selection, a reload that was replaced) are ignored whatever their order,
 * so a late answer can never overwrite the current intent. Inputs are never mutated.
 */
export function reduceRemoteResponses(
  input: Readonly<{ activeRequestId: string; responses: readonly RemoteResponse[] }>,
): RemoteResolution {
  const active = input.responses.find((response) => response.requestId === input.activeRequestId);
  if (!active) return { state: 'loading' };
  if (active.error !== undefined) return { state: 'error', error: active.error };
  return { state: 'success', value: active.value };
}
