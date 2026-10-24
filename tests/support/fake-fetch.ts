import type { FetchLike } from '../../src/api/http';

export type FakeCall = Readonly<{ url: string; method: string; headers: Record<string, string>; body: unknown }>;

export type FakeHandler = (call: FakeCall) => Response | Promise<Response> | 'hang' | 'network-error';

export function jsonResponse(status: number, body: unknown, headers: Record<string, string> = {}): Response {
  return new Response(typeof body === 'string' ? body : JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json', ...headers },
  });
}

/** Repeatable fetch double: records every call and answers with the handler. 'hang' waits for the client's abort. */
export function createFakeFetch(handler: FakeHandler): FetchLike & { calls: FakeCall[] } {
  const calls: FakeCall[] = [];
  const fake = async (url: string, init: RequestInit): Promise<Response> => {
    const headers = { ...(init.headers as Record<string, string> | undefined) };
    const call: FakeCall = {
      url,
      method: init.method ?? 'GET',
      headers,
      body: typeof init.body === 'string' ? JSON.parse(init.body) : undefined,
    };
    calls.push(call);
    const answer = await handler(call);
    if (answer === 'network-error') throw new TypeError('Network request failed');
    if (answer === 'hang') {
      return new Promise<Response>((_, reject) => {
        init.signal?.addEventListener('abort', () => reject(new Error('aborted')));
      });
    }
    return answer;
  };
  return Object.assign(fake, { calls });
}

export const VALID_INCIDENT = {
  id: 'campus-inc-001',
  version: 1,
  status: 'assigned',
  payload: {
    category: 'connectivity',
    description: 'Sin conexión en laboratorio ficticio',
    location: 'Edificio de prueba A',
    reporterId: 'reporter-1',
    assignedTechnicianId: 'technician-1',
    priority: 'medium',
    notes: [],
    evidence: [],
    history: [],
  },
} as const;

export const LOGIN_RESPONSE = {
  actorId: 'technician-1',
  role: 'technician',
  accessToken: 'course-valid-token',
  refreshToken: 'course-refresh-0',
  expiresIn: 60,
} as const;
