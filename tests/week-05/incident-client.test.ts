/** @jest-environment node */
import { IncidentClient } from '../../src/api/incident-client';
import { parseIncident, parseIncidentList, parseRemoteResource } from '../../src/api/incident-dto';
import { SessionManager } from '../../src/auth/session-manager';
import { createMemorySessionStorage } from '../../src/auth/session-storage';
import { GetIncidentsUseCase } from '../../src/application/incident-usecases';
import { createFakeFetch, jsonResponse, LOGIN_RESPONSE, VALID_INCIDENT, type FakeHandler } from '../support/fake-fetch';

const BASE = 'http://backend.test';

/** Client wired to a fetch double: no real service involved. */
async function clientWith(handler: FakeHandler, timeoutMs = 200) {
  const fetch = createFakeFetch((call) =>
    call.url.endsWith('/v1/session/login') ? jsonResponse(200, LOGIN_RESPONSE) : handler(call),
  );
  const session = new SessionManager({ baseUrl: BASE, storage: createMemorySessionStorage(), fetch, now: () => 0 });
  await session.login('technician-1');
  return { client: new IncidentClient({ baseUrl: BASE, session, fetch, timeoutMs }), fetch };
}

describe('DTO boundary', () => {
  test('envelope returns { ok: true, value } and ignores future fields', () => {
    expect(parseRemoteResource({ id: 'r-2', version: 3, status: 'closed', payload: null, ignored: 'x' })).toEqual({
      ok: true,
      value: { id: 'r-2', version: 3, status: 'closed', payload: null },
    });
  });

  test.each([null, [], { id: '', version: 1, status: 'open', payload: null }, { id: 'a', version: -1, status: 'open', payload: null }, { id: 'a', version: 1, status: 'open', payload: [] }])(
    'corrupt envelope %# is a contract error',
    (input) => {
      expect(parseRemoteResource(input)).toEqual({ ok: false, error: 'contract' });
    },
  );

  test('valid envelope with payload null is not turned into an invented incident', () => {
    expect(parseIncident({ ...VALID_INCIDENT, payload: null })).toEqual({ ok: false, error: 'contract' });
  });

  test('domain rules reject unknown status, category or empty description', () => {
    expect(parseIncident({ ...VALID_INCIDENT, status: 'archived' }).ok).toBe(false);
    expect(parseIncident({ ...VALID_INCIDENT, payload: { ...VALID_INCIDENT.payload, category: 'magic' } }).ok).toBe(false);
    expect(parseIncident({ ...VALID_INCIDENT, payload: { ...VALID_INCIDENT.payload, description: ' ' } }).ok).toBe(false);
  });

  test('a list keeps valid items, counts rejected ones and refuses a missing items array', () => {
    expect(parseIncidentList({ items: [VALID_INCIDENT, { ...VALID_INCIDENT, version: '2' }] })).toMatchObject({
      ok: true,
      rejected: 1,
      value: [{ id: 'campus-inc-001', category: 'connectivity', assignedTechnicianId: 'technician-1' }],
    });
    expect(parseIncidentList({ items: null })).toEqual({ ok: false, error: 'contract' });
  });
});

describe('IncidentClient with a fetch double', () => {
  test('list sends the session headers and maps the DTO to the domain', async () => {
    const { client, fetch } = await clientWith(() => jsonResponse(200, { items: [VALID_INCIDENT] }));
    const result = await client.list();
    expect(result).toMatchObject({ ok: true, value: [{ id: 'campus-inc-001', status: 'assigned' }] });
    const call = fetch.calls.at(-1);
    expect(call?.headers).toMatchObject({ Authorization: 'Bearer course-valid-token', 'X-Course-Actor': 'technician-1' });
  });

  test('a 200 with a broken JSON body is a typed contract error, not an exception', async () => {
    const { client } = await clientWith(() => jsonResponse(200, '{"items": [}'));
    await expect(client.list()).resolves.toEqual({ ok: false, error: { kind: 'contract' } });
  });

  test('500 is a typed server error', async () => {
    const { client } = await clientWith(() => jsonResponse(500, { code: 'controlled_failure' }));
    await expect(client.detail('campus-inc-001')).resolves.toEqual({ ok: false, error: { kind: 'server', status: 500 } });
  });

  test('the client aborts with its own timeout', async () => {
    const { client } = await clientWith(() => 'hang', 50);
    await expect(client.list()).resolves.toEqual({ ok: false, error: { kind: 'timeout' } });
  });

  test('a dropped connection is a network error', async () => {
    const { client } = await clientWith(() => 'network-error');
    await expect(client.list()).resolves.toEqual({ ok: false, error: { kind: 'network' } });
  });

  test('403 and 409 keep their meaning', async () => {
    const forbidden = await clientWith(() => jsonResponse(403, { code: 'forbidden' }));
    await expect(forbidden.client.detail('campus-inc-001')).resolves.toEqual({ ok: false, error: { kind: 'forbidden' } });
    const conflict = await clientWith(() => jsonResponse(409, { code: 'version_conflict', currentVersion: 2 }));
    await expect(conflict.client.act('campus-inc-001', 'start', 1, {}, 'op-test-0001')).resolves.toEqual({
      ok: false,
      error: { kind: 'conflict', code: 'version_conflict' },
    });
  });

  test('writes send the same Idempotency-Key and baseVersion in the body', async () => {
    const { client, fetch } = await clientWith(() =>
      jsonResponse(201, { incident: { ...VALID_INCIDENT, version: 2, status: 'in_progress' }, operationId: 'op-test-0002', duplicate: false }),
    );
    const result = await client.act('campus-inc-001', 'start', 1, {}, 'op-test-0002');
    expect(result).toMatchObject({ ok: true, value: { duplicate: false, incident: { version: 2, status: 'in_progress' } } });
    expect(fetch.calls.at(-1)).toMatchObject({
      method: 'POST',
      headers: { 'Idempotency-Key': 'op-test-0002' },
      body: { action: 'start', baseVersion: 1 },
    });
  });

  test('the use case returns the typed failure to the screen', async () => {
    const { client } = await clientWith(() => jsonResponse(500, { code: 'controlled_failure' }));
    await expect(new GetIncidentsUseCase(client).execute()).resolves.toMatchObject({ ok: false, error: { kind: 'server' } });
  });

  test('nothing is logged, so no token can leak to logs', async () => {
    const spies = (['log', 'info', 'warn', 'error', 'debug'] as const).map((method) =>
      jest.spyOn(console, method).mockImplementation(() => undefined),
    );
    const { client } = await clientWith(() => jsonResponse(500, { code: 'controlled_failure' }));
    await client.list();
    for (const spy of spies) {
      expect(spy).not.toHaveBeenCalled();
      spy.mockRestore();
    }
  });
});
