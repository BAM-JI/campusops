/** @jest-environment node */
import { reduceRemoteResponses } from '../../src/application/remote-responses';
import { IDLE_TRACKER, toViewState, trackRequests, type RequestTracker, type TrackerEvent } from '../../src/application/view-state';

const run = (events: readonly TrackerEvent[]): RequestTracker => events.reduce(trackRequests, IDLE_TRACKER);
const identity = (value: unknown) => value;

test('a late answer of the previous selection never replaces the active one', () => {
  const tracker = run([
    { type: 'request', requestId: 'A' },
    { type: 'request', requestId: 'B' },
    { type: 'response', response: { requestId: 'B', value: { id: 'B' } } },
    { type: 'response', response: { requestId: 'A', value: { id: 'A' } } },
  ]);
  expect(toViewState(tracker, identity)).toEqual({ kind: 'success', value: { id: 'B' } });
});

test('the active answer wins in any arrival order', () => {
  const responses = [
    { requestId: 'A', value: { id: 'A' } },
    { requestId: 'C', error: 'server' },
    { requestId: 'B', value: { id: 'B' } },
  ];
  for (const order of [responses, [...responses].reverse(), [responses[1]!, responses[2]!, responses[0]!]]) {
    expect(reduceRemoteResponses({ activeRequestId: 'B', responses: order })).toEqual({ state: 'success', value: { id: 'B' } });
  }
});

test('the active error is reported; an older error is ignored', () => {
  expect(reduceRemoteResponses({ activeRequestId: 'B', responses: [{ requestId: 'B', error: 'server' }] })).toEqual({
    state: 'error',
    error: 'server',
  });
  expect(
    reduceRemoteResponses({ activeRequestId: 'B', responses: [{ requestId: 'A', error: 'timeout' }, { requestId: 'B', value: 1 }] }),
  ).toEqual({ state: 'success', value: 1 });
});

test('without the active answer the state is loading, never success with old data', () => {
  expect(reduceRemoteResponses({ activeRequestId: 'B', responses: [{ requestId: 'A', value: { id: 'A' } }] })).toEqual({
    state: 'loading',
  });
});

test('inputs are not mutated', () => {
  const input = { activeRequestId: 'B', responses: [{ requestId: 'A', value: { id: 'A' } }, { requestId: 'B', value: { id: 'B' } }] };
  const before = JSON.stringify(input);
  reduceRemoteResponses(input);
  expect(JSON.stringify(input)).toBe(before);
});

test('timeouts and dropped connections are shown as offline; other errors as error', () => {
  expect(toViewState(run([{ type: 'request', requestId: 'A' }, { type: 'response', response: { requestId: 'A', error: 'timeout' } }]), identity)).toEqual({
    kind: 'offline',
    error: 'timeout',
  });
  expect(toViewState(run([{ type: 'request', requestId: 'A' }, { type: 'response', response: { requestId: 'A', error: 'network' } }]), identity)).toEqual({
    kind: 'offline',
    error: 'network',
  });
  expect(toViewState(run([{ type: 'request', requestId: 'A' }, { type: 'response', response: { requestId: 'A', error: 'forbidden' } }]), identity)).toEqual({
    kind: 'error',
    error: 'forbidden',
  });
});

test('an empty success is the empty state', () => {
  const tracker = run([{ type: 'request', requestId: 'A' }, { type: 'response', response: { requestId: 'A', value: [] } }]);
  expect(toViewState(tracker, (value) => value as unknown[], (items) => items.length === 0)).toEqual({ kind: 'empty' });
});

test('cancel ends loading; the answer that arrives later is ignored; a new request starts clean', () => {
  const cancelled = run([
    { type: 'request', requestId: 'A' },
    { type: 'cancel' },
    { type: 'response', response: { requestId: 'A', value: { id: 'A' } } },
  ]);
  expect(toViewState(run([{ type: 'request', requestId: 'A' }, { type: 'cancel' }]), identity)).toEqual({ kind: 'cancelled' });
  // The answer arrived after cancelling: the user's decision wins and no data appears.
  expect(toViewState(cancelled, identity)).toEqual({ kind: 'cancelled' });
  expect(toViewState(trackRequests(cancelled, { type: 'request', requestId: 'B' }), identity)).toEqual({ kind: 'loading' });
  // Cancelling something that already finished does not change the view.
  const done = run([{ type: 'request', requestId: 'A' }, { type: 'response', response: { requestId: 'A', value: 1 } }]);
  expect(trackRequests(done, { type: 'cancel' })).toBe(done);
});

test('impossible states are not representable: one kind at a time', () => {
  const kinds = new Set<string>();
  const events: TrackerEvent[][] = [
    [],
    [{ type: 'request', requestId: 'A' }],
    [{ type: 'request', requestId: 'A' }, { type: 'cancel' }],
    [{ type: 'request', requestId: 'A' }, { type: 'response', response: { requestId: 'A', error: 'server' } }],
    [{ type: 'request', requestId: 'A' }, { type: 'response', response: { requestId: 'A', value: { id: 'A' } } }],
    [{ type: 'request', requestId: 'A' }, { type: 'response', response: { requestId: 'A', value: { id: 'A' } } }, { type: 'clear' }],
  ];
  for (const sequence of events) {
    const view = toViewState(run(sequence), identity);
    expect(Object.keys(view).every((key) => ['kind', 'value', 'error'].includes(key))).toBe(true);
    kinds.add(view.kind);
  }
  expect([...kinds].sort()).toEqual(['cancelled', 'error', 'idle', 'loading', 'success']);
});
