import type { AccessGrant, SessionManager } from '../auth/session-manager';
import type { IIncidentRepository, Incident, IncidentAction, NewIncident, WriteResult } from '../domain/incident';
import { failure, success, type ApiResult } from '../domain/result';
import { DEFAULT_TIMEOUT_MS, errorFromStatus, sendRequest, type FetchLike, type RawResponse } from './http';
import { parseIncident, parseIncidentList, parseWriteResult } from './incident-dto';
import { DEFAULT_RETRY_POLICY, planRetry, type RetryPolicyConfig } from './retry-policy';

export type IncidentClientOptions = Readonly<{
  baseUrl: string;
  session: SessionManager;
  fetch?: FetchLike;
  timeoutMs?: number;
  /** Test-only header to select a public backend variant (server_error, malformed, slow...). */
  scenario?: string;
  /** Enables bounded retries (week 9). Omitted: every request is sent exactly once. */
  retry?: RetryOptions;
}>;

/** Sanitized record of one attempt: no tokens, actor, body, location or incident id. */
export type AttemptRecord = Readonly<{
  method: 'GET' | 'POST';
  route: string;
  attempt: number;
  outcome: string;
  retry: boolean;
  delayMs: number;
  durationMs: number;
}>;

export type RetryOptions = Readonly<{
  policy?: RetryPolicyConfig;
  /** Injectable wait so tests check the delays without sleeping. */
  sleep?: (ms: number) => Promise<void>;
  now?: () => number;
  onAttempt?: (record: AttemptRecord) => void;
}>;

let requestSequence = 0;

/** Status passed to planRetry, or null when the result is final (success, business error, no session). */
function retryStatusOf(result: ApiResult<RawResponse>): number | 'timeout' | null {
  if (!result.ok) return result.error.kind === 'timeout' || result.error.kind === 'network' ? 'timeout' : null;
  return result.value.status >= 200 && result.value.status < 300 ? null : result.value.status;
}

function outcomeOf(result: ApiResult<RawResponse>): string {
  return result.ok ? `http_${result.value.status}` : result.error.kind;
}

/** `/v1/incidents/campus-inc-001/actions` -> `/v1/incidents/:id/actions`, so metrics carry no identifiers. */
export function routeTemplate(path: string): string {
  return path.replace(/^\/v1\/incidents\/[^/]+/, '/v1/incidents/:id');
}

/**
 * Only place where the app talks HTTP to CampusOps. Screens call use cases, use cases call this
 * client. Every response passes the DTO boundary before reaching the domain, and every failure is
 * returned as an `ApiError` (never thrown, never logged with tokens).
 */
export class IncidentClient implements IIncidentRepository {
  private readonly fetchFn: FetchLike;

  constructor(private readonly options: IncidentClientOptions) {
    this.fetchFn = options.fetch ?? ((url, init) => fetch(url, init));
  }

  getAll(): Promise<ApiResult<readonly Incident[]>> {
    return this.list();
  }

  getById(id: string): Promise<ApiResult<Incident>> {
    return this.detail(id);
  }

  async list(): Promise<ApiResult<readonly Incident[]>> {
    const response = await this.authorized('GET', '/v1/incidents');
    if (!response.ok) return response;
    if (response.value.status !== 200) return failure(errorFromStatus(response.value));
    const parsed = parseIncidentList(response.value.body);
    return parsed.ok ? success(parsed.value) : failure({ kind: 'contract' });
  }

  async detail(id: string): Promise<ApiResult<Incident>> {
    const response = await this.authorized('GET', `/v1/incidents/${encodeURIComponent(id)}`);
    if (!response.ok) return response;
    if (response.value.status !== 200) return failure(errorFromStatus(response.value));
    const parsed = parseIncident(response.value.body);
    return parsed.ok ? success(parsed.value) : failure({ kind: 'contract' });
  }

  /** `idempotencyKey` must be the same on every retry of the same creation. */
  create(input: NewIncident, idempotencyKey: string): Promise<ApiResult<WriteResult>> {
    return this.write('/v1/incidents', { ...input }, idempotencyKey);
  }

  act(
    incidentId: string,
    action: IncidentAction,
    baseVersion: number,
    payload: Readonly<Record<string, unknown>>,
    idempotencyKey: string,
  ): Promise<ApiResult<WriteResult>> {
    return this.write(
      `/v1/incidents/${encodeURIComponent(incidentId)}/actions`,
      { ...payload, action, baseVersion },
      idempotencyKey,
    );
  }

  private async write(path: string, body: Readonly<Record<string, unknown>>, idempotencyKey: string): Promise<ApiResult<WriteResult>> {
    const response = await this.authorized('POST', path, body, idempotencyKey);
    if (!response.ok) return response;
    const { status } = response.value;
    if (status !== 201 && status !== 200) return failure(errorFromStatus(response.value));
    const parsed = parseWriteResult(response.value.body);
    return parsed.ok ? success(parsed.value) : failure({ kind: 'contract' });
  }

  /**
   * Without `retry` options a request is sent once (behavior of weeks 5 to 8). With them, each
   * transient failure asks `planRetry` whether to repeat: same body and same Idempotency-Key,
   * bounded attempts, Retry-After honored, and one sanitized record per attempt.
   */
  private async authorized(
    method: 'GET' | 'POST',
    path: string,
    body?: Readonly<Record<string, unknown>>,
    idempotencyKey?: string,
  ): Promise<ApiResult<RawResponse>> {
    const retry = this.options.retry;
    if (!retry) return this.attemptOnce(method, path, body, idempotencyKey);
    const now = retry.now ?? (() => Date.now());
    const sleep = retry.sleep ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
    for (let attempt = 1; ; attempt += 1) {
      const startedAt = now();
      const result = await this.attemptOnce(method, path, body, idempotencyKey);
      const status = retryStatusOf(result);
      const decision =
        status === null
          ? { retry: false, delayMs: 0, requiresStableIdempotencyKey: false }
          : planRetry(
              {
                method,
                status,
                attempt,
                ...(result.ok && result.value.retryAfterMs !== null ? { retryAfterMs: result.value.retryAfterMs } : {}),
                ...(idempotencyKey !== undefined ? { idempotencyKey } : {}),
              },
              retry.policy ?? DEFAULT_RETRY_POLICY,
            );
      retry.onAttempt?.({
        method,
        route: routeTemplate(path),
        attempt,
        outcome: outcomeOf(result),
        retry: decision.retry,
        delayMs: decision.retry ? decision.delayMs : 0,
        durationMs: Math.max(0, now() - startedAt),
      });
      if (!decision.retry) return result;
      await sleep(decision.delayMs);
    }
  }

  /** Sends with the current token; a 401 joins the shared refresh and retries once at most. */
  private async attemptOnce(
    method: 'GET' | 'POST',
    path: string,
    body?: Readonly<Record<string, unknown>>,
    idempotencyKey?: string,
  ): Promise<ApiResult<RawResponse>> {
    const grant = await this.options.session.accessToken();
    if (!grant) return failure({ kind: 'unauthorized' });
    const first = await this.send(grant, method, path, body, idempotencyKey);
    if (!first.ok || first.value.status !== 401) return this.checkBody(first);

    const requestId = `req-${++requestSequence}`;
    const renewed = await this.options.session.refreshAfter401(grant.generation, requestId);
    if (!renewed) return failure({ kind: 'unauthorized' });
    const retried = await this.send(renewed, method, path, body, idempotencyKey);
    if (retried.ok && retried.value.status === 401) {
      await this.options.session.logout();
      return failure({ kind: 'unauthorized' });
    }
    return this.checkBody(retried);
  }

  /** A 2xx whose body is not JSON (malformed scenario) is a contract error, not a crash. */
  private checkBody(result: ApiResult<RawResponse>): ApiResult<RawResponse> {
    if (result.ok && result.value.status < 300 && result.value.body === undefined) return failure({ kind: 'contract' });
    return result;
  }

  private send(
    grant: AccessGrant,
    method: 'GET' | 'POST',
    path: string,
    body?: Readonly<Record<string, unknown>>,
    idempotencyKey?: string,
  ): Promise<ApiResult<RawResponse>> {
    const headers: Record<string, string> = {
      Authorization: `Bearer ${grant.token}`,
      'X-Course-Actor': grant.actorId,
    };
    if (body !== undefined) headers['Content-Type'] = 'application/json';
    if (idempotencyKey !== undefined) headers['Idempotency-Key'] = idempotencyKey;
    if (this.options.scenario !== undefined) headers['X-Course-Scenario'] = this.options.scenario;
    const init: RequestInit = { method, headers };
    if (body !== undefined) init.body = JSON.stringify(body);
    return sendRequest(this.fetchFn, `${this.options.baseUrl}${path}`, init, this.options.timeoutMs ?? DEFAULT_TIMEOUT_MS);
  }
}
