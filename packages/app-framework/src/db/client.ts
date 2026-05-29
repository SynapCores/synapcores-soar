/**
 * SynapCores SDK client.
 *
 * Thin wrapper around the SynapCores HTTP API. We unwrap the
 * `{data, meta}` response envelope here so the rest of the framework
 * + apps see ergonomic shapes (`{rows, columns, truncated}` for
 * queries, raw objects for everything else). See memory note
 * "Gateway response envelope" for why this matters.
 *
 * Auth: caller provides an API key (per-tenant) when constructing the
 * client. For multi-tenant apps the framework spins up one client per
 * request via `getClientForSession()` in ./server.ts.
 *
 * Errors: every non-2xx is thrown as a `SynapCoresError` carrying the
 * upstream `body.error` so app code gets a clean catch-and-log path.
 */

export interface SynapCoresClientOptions {
  /** Base URL — e.g. http://127.0.0.1:28080 */
  baseUrl?: string;
  /** API key for the tenant whose data we're operating on. */
  apiKey: string;
  /** Per-request timeout in ms. Default: 60_000. */
  timeoutMs?: number;
  /** Optional fetch implementation (for tests / Edge runtime). */
  fetchImpl?: typeof fetch;
}

export interface QueryResult<Row = Record<string, unknown>> {
  columns: string[];
  rows: Row[];
  truncated?: boolean;
  rowCount: number;
  /** Raw upstream meta for callers that need it (cache info, plan, ...). */
  meta?: Record<string, unknown>;
}

export class SynapCoresError extends Error {
  readonly status: number;
  readonly upstream: unknown;

  constructor(status: number, message: string, upstream?: unknown) {
    super(message);
    this.name = 'SynapCoresError';
    this.status = status;
    this.upstream = upstream;
  }
}

export class SynapCoresClient {
  private readonly baseUrl: string;
  private readonly apiKey: string;
  private readonly timeoutMs: number;
  private readonly fetchImpl: typeof fetch;

  constructor(opts: SynapCoresClientOptions) {
    this.baseUrl = (opts.baseUrl ?? 'http://127.0.0.1:28080').replace(/\/+$/, '');
    this.apiKey = opts.apiKey;
    this.timeoutMs = opts.timeoutMs ?? 60_000;
    this.fetchImpl = opts.fetchImpl ?? fetch;
  }

  /**
   * Execute a SQL statement with bound parameters.
   *
   * The SynapCores gateway only accepts a single statement per call;
   * batch the framework manages by issuing multiple `sql()` calls in
   * sequence (we deliberately do not run them concurrently against the
   * same connection — interleaved transactions are not a thing the
   * engine supports yet).
   */
  async sql<Row = Record<string, unknown>>(
    statement: string,
    params: ReadonlyArray<unknown> = [],
  ): Promise<QueryResult<Row>> {
    const body = await this.request<QueryEnvelope<Row>>('POST', '/query', {
      sql: statement,
      params,
    });

    return {
      columns: body.columns ?? [],
      rows: body.rows ?? [],
      truncated: body.truncated,
      rowCount: body.row_count ?? body.rows?.length ?? 0,
      meta: body.meta as Record<string, unknown> | undefined,
    };
  }

  /**
   * Convenience: returns the single column of the first row of the
   * query result, or null if there were no rows. Common pattern for
   * `SELECT COUNT(*)`, `SELECT VERIFY_CHAIN(...)`, etc.
   */
  async sqlScalar<T = unknown>(
    statement: string,
    params: ReadonlyArray<unknown> = [],
  ): Promise<T | null> {
    const result = await this.sql<Record<string, T>>(statement, params);
    const firstRow = result.rows[0];
    if (!firstRow) return null;
    const firstColumn = result.columns[0];
    if (!firstColumn) return null;
    return firstRow[firstColumn] ?? null;
  }

  /** Health probe — used by the framework's bootstrap to wait for the engine. */
  async health(): Promise<{ ok: boolean; version?: string }> {
    try {
      const body = await this.request<{ status?: string; version?: string }>(
        'GET',
        '/health',
      );
      return { ok: body.status === 'ok', version: body.version };
    } catch {
      return { ok: false };
    }
  }

  private async request<T>(
    method: 'GET' | 'POST',
    path: string,
    body?: unknown,
  ): Promise<T> {
    const url = `${this.baseUrl}${path}`;
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), this.timeoutMs);

    let res: Response;
    try {
      res = await this.fetchImpl(url, {
        method,
        headers: {
          'content-type': 'application/json',
          // Bearer auth — the v1.5.0-ce gateway convention.
          authorization: `Bearer ${this.apiKey}`,
        },
        body: body !== undefined ? JSON.stringify(body) : undefined,
        signal: ctl.signal,
      });
    } finally {
      clearTimeout(timer);
    }

    const text = await res.text();
    let parsed: unknown = undefined;
    if (text) {
      try {
        parsed = JSON.parse(text);
      } catch {
        parsed = text;
      }
    }

    if (!res.ok) {
      const message =
        (parsed as { error?: { message?: string } } | undefined)?.error?.message ??
        `SynapCores ${method} ${path} → ${res.status}`;
      throw new SynapCoresError(res.status, message, parsed);
    }

    // Unwrap the {data, meta} envelope. v1.5.0-ce wraps every success
    // payload — clients see the inner data shape.
    if (parsed && typeof parsed === 'object' && 'data' in parsed) {
      return (parsed as { data: T }).data;
    }
    return parsed as T;
  }
}

/** Internal — the wire shape after envelope unwrap. */
interface QueryEnvelope<Row> {
  columns?: string[];
  rows?: Row[];
  row_count?: number;
  truncated?: boolean;
  meta?: unknown;
}
