/**
 * SynapCores SDK client.
 *
 * Wire protocol (SynapCores v1.7.0.1-ce):
 *
 *   - Auth: JWT obtained via POST /v1/auth/login (caller passes the
 *     access_token as the Bearer). For framework-internal calls we
 *     hold the token in the admin client and refresh on 401 (TODO
 *     phase 3).
 *
 *   - Non-parameterized statements (DDL, SELECT with literal values):
 *       POST /v1/query/execute { sql }
 *
 *   - Parameterized statements ($1, $2, …):
 *       POST /v1/query/prepare { sql }      → { statement_id }
 *       POST /v1/query/exec    { statement_id, params }
 *       (POST /v1/query/close  { statement_id } — fire-and-forget cleanup)
 *
 *   - Response envelope: { data: { columns, rows, ... }, meta }.
 *     `columns` is an array of `{ name, data_type, nullable }` objects;
 *     `rows` is an array of value-arrays (positional, NOT object-keyed).
 *     This client maps rows into `{ [columnName]: value }` for ergonomics.
 *
 * Errors: non-2xx → `SynapCoresError(status, message, upstream)`. The
 * upstream body keeps the original error shape so callers can branch on
 * `err.upstream.error.code` (`query_error`, `endpoint_not_found`, ...).
 */

export interface SynapCoresClientOptions {
  /** Base URL — e.g. http://127.0.0.1:28080 */
  baseUrl?: string;
  /** Bearer token (JWT). For admin clients, mint via /v1/auth/login. */
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

interface WireColumn {
  name: string;
  data_type: string;
  nullable: boolean;
}

interface WireQueryResult {
  columns: WireColumn[];
  rows: unknown[][];
  rows_affected?: number;
  execution_time_ms?: number;
  truncated?: boolean;
}

interface WirePrepareResult {
  statement_id: string;
  param_count: number;
  sql: string;
  database: string;
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
   * Execute a SQL statement with optional bound parameters.
   * If `params` is non-empty, routes through prepare → exec → close.
   * If empty, hits /v1/query/execute directly.
   */
  async sql<Row = Record<string, unknown>>(
    statement: string,
    params: ReadonlyArray<unknown> = [],
  ): Promise<QueryResult<Row>> {
    if (params.length === 0) {
      const wire = await this.request<WireQueryResult>('POST', '/v1/query/execute', {
        sql: statement,
      });
      return shapeResult<Row>(wire);
    }

    const prep = await this.request<WirePrepareResult>('POST', '/v1/query/prepare', {
      sql: statement,
    });
    try {
      const wire = await this.request<WireQueryResult>('POST', '/v1/query/exec', {
        statement_id: prep.statement_id,
        params: params as unknown[],
      });
      return shapeResult<Row>(wire);
    } finally {
      // Fire-and-forget close. We don't await it — gateway will GC.
      void this.request('POST', '/v1/query/close', {
        statement_id: prep.statement_id,
      }).catch(() => undefined);
    }
  }

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

  async health(): Promise<{ ok: boolean; version?: string }> {
    try {
      const res = await this.fetchImpl(`${this.baseUrl}/health`);
      if (!res.ok) return { ok: false };
      const body = (await res.json()) as { status?: string; version?: string };
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

    // Unwrap the {data, meta} envelope every gateway response uses.
    if (parsed && typeof parsed === 'object' && 'data' in parsed) {
      return (parsed as { data: T }).data;
    }
    return parsed as T;
  }
}

/** Convert the gateway's positional rows into ergonomic objects. */
function shapeResult<Row>(wire: WireQueryResult): QueryResult<Row> {
  const columnNames = wire.columns.map((c) => c.name);
  const rows = wire.rows.map((rowArr) => {
    const obj: Record<string, unknown> = {};
    for (let i = 0; i < columnNames.length; i++) {
      obj[columnNames[i]!] = rowArr[i];
    }
    return obj as unknown as Row;
  });
  return {
    columns: columnNames,
    rows,
    truncated: wire.truncated,
    rowCount: wire.rows_affected ?? rows.length,
  };
}
