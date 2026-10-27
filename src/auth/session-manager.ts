import type { CampusRole } from '../campusops/contracts';
import type { AuthEvent } from '../course-evaluation/contracts';
import { failure, success, type ApiResult } from '../domain/result';
import { DEFAULT_TIMEOUT_MS, errorFromStatus, sendRequest, type FetchLike } from '../api/http';
import { parseRefresh, parseSession } from '../api/incident-dto';
import { SESSION_KEY, type SecureSessionStorage } from './session-storage';

type StoredSession = Readonly<{
  actorId: string;
  role: CampusRole;
  accessToken: string;
  refreshToken: string;
  /** Epoch milliseconds measured with the injected clock. */
  expiresAt: number;
}>;

export type SessionIdentity = Readonly<{ actorId: string; role: CampusRole }>;

export type AccessGrant = Readonly<{ token: string; actorId: string; generation: number }>;

export type SessionManagerOptions = Readonly<{
  baseUrl: string;
  storage: SecureSessionStorage;
  fetch?: FetchLike;
  /** Controllable clock so tests verify expiration without real waits. */
  now?: () => number;
  timeoutMs?: number;
  /** Renew this many ms before the server expiry to avoid sending an almost-expired token. */
  expirySkewMs?: number;
}>;

function isStoredSession(value: unknown): value is StoredSession {
  if (typeof value !== 'object' || value === null) return false;
  const v = value as Record<string, unknown>;
  return (
    typeof v.actorId === 'string' &&
    (v.role === 'reporter' || v.role === 'technician' || v.role === 'coordinator') &&
    typeof v.accessToken === 'string' &&
    typeof v.refreshToken === 'string' &&
    typeof v.expiresAt === 'number'
  );
}

/**
 * Session lifecycle: login -> valid -> expired -> refreshing -> valid | anonymous.
 * See docs/session-state-machine.mmd. The policy for concurrent 401s is the one in
 * `summarizeAuthEvents` (refresh-coordinator.ts): one shared refresh per token generation,
 * each request retried at most once, and any refresh failure returns to anonymous and
 * deletes the persisted session. Tokens are never logged.
 */
export class SessionManager {
  private session: StoredSession | null = null;
  private generation = 0;
  private refreshing: Promise<AccessGrant | null> | null = null;
  private readonly authEvents: AuthEvent[] = [];
  private readonly fetchFn: FetchLike;
  private readonly now: () => number;

  constructor(private readonly options: SessionManagerOptions) {
    this.fetchFn = options.fetch ?? ((url, init) => fetch(url, init));
    this.now = options.now ?? (() => Date.now());
  }

  identity(): SessionIdentity | null {
    return this.session ? { actorId: this.session.actorId, role: this.session.role } : null;
  }

  status(): 'anonymous' | 'authenticated' {
    return this.session ? 'authenticated' : 'anonymous';
  }

  /** Auth events without token values, so the policy can be checked with `summarizeAuthEvents`. */
  events(): readonly AuthEvent[] {
    return [...this.authEvents];
  }

  /** Restores a persisted session after the app restarts; a corrupt value is discarded. */
  async restore(): Promise<SessionIdentity | null> {
    const raw = await this.options.storage.getItem(SESSION_KEY);
    if (raw === null) return null;
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      parsed = null;
    }
    if (!isStoredSession(parsed)) {
      await this.options.storage.deleteItem(SESSION_KEY);
      return null;
    }
    this.session = parsed;
    return this.identity();
  }

  async login(actorId: string): Promise<ApiResult<SessionIdentity>> {
    const response = await sendRequest(
      this.fetchFn,
      `${this.options.baseUrl}/v1/session/login`,
      { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ actorId }) },
      this.options.timeoutMs ?? DEFAULT_TIMEOUT_MS,
    );
    if (!response.ok) return failure(response.error);
    if (response.value.status !== 200) return failure(errorFromStatus(response.value));
    const parsed = parseSession(response.value.body);
    if (!parsed.ok) return failure({ kind: 'contract' });
    const { accessToken, refreshToken, expiresIn, role } = parsed.value;
    await this.persist({ actorId: parsed.value.actorId, role, accessToken, refreshToken, expiresAt: this.now() + expiresIn * 1000 });
    this.generation += 1;
    return success({ actorId: parsed.value.actorId, role });
  }

  async logout(): Promise<void> {
    this.session = null;
    this.refreshing = null;
    this.generation += 1;
    this.authEvents.push({ type: 'logout' });
    await this.options.storage.deleteItem(SESSION_KEY);
  }

  /** Returns a valid access token, refreshing first when the current one expired. */
  async accessToken(): Promise<AccessGrant | null> {
    if (!this.session) return null;
    if (this.now() >= this.session.expiresAt - (this.options.expirySkewMs ?? 5000)) {
      return this.refreshShared(this.generation, 'expired');
    }
    return { token: this.session.accessToken, actorId: this.session.actorId, generation: this.generation };
  }

  /**
   * Called by a request that received 401 with the token of `generation`. If that generation was
   * already replaced, the request reuses the new token; otherwise it joins the single refresh.
   */
  async refreshAfter401(generation: number, requestId: string): Promise<AccessGrant | null> {
    this.authEvents.push({ type: 'request401', requestId, generation });
    if (!this.session) return null;
    if (generation !== this.generation) {
      return { token: this.session.accessToken, actorId: this.session.actorId, generation: this.generation };
    }
    return this.refreshShared(generation, requestId);
  }

  private refreshShared(generation: number, reason: string): Promise<AccessGrant | null> {
    if (this.refreshing) return this.refreshing;
    if (reason === 'expired') this.authEvents.push({ type: 'request401', requestId: 'expired', generation });
    this.refreshing = this.refresh().finally(() => {
      this.refreshing = null;
    });
    return this.refreshing;
  }

  private async refresh(): Promise<AccessGrant | null> {
    const current = this.session;
    if (!current) return null;
    const response = await sendRequest(
      this.fetchFn,
      `${this.options.baseUrl}/v1/session/refresh`,
      { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ refreshToken: current.refreshToken }) },
      this.options.timeoutMs ?? DEFAULT_TIMEOUT_MS,
    );
    const parsed = response.ok && response.value.status === 200 ? parseRefresh(response.value.body) : null;
    if (!parsed || !parsed.ok || this.session !== current) {
      // Failed or stale refresh: return to anonymous and remove the persisted session (no retry loop).
      this.authEvents.push({ type: 'refreshFailed' });
      this.session = null;
      this.generation += 1;
      await this.options.storage.deleteItem(SESSION_KEY);
      return null;
    }
    await this.persist({
      ...current,
      accessToken: parsed.value.accessToken,
      refreshToken: parsed.value.refreshToken,
      expiresAt: this.now() + parsed.value.expiresIn * 1000,
    });
    this.generation += 1;
    this.authEvents.push({ type: 'refreshSucceeded', generation: this.generation });
    return { token: parsed.value.accessToken, actorId: current.actorId, generation: this.generation };
  }

  private async persist(session: StoredSession): Promise<void> {
    await this.options.storage.setItem(SESSION_KEY, JSON.stringify(session));
    this.session = session;
  }
}
