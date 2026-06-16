/**
 * Minimal AIDB REST client for the bridge.
 *
 * We keep this dependency-free (just `fetch`) rather than depending on
 * @synapcores/app-framework/db so the bridge can be deployed as a
 * standalone container next to the engine if we ever spin it out.
 *
 * Three call shapes:
 *   - execSql(stmt)        — non-parameterized; for batched VALUES.
 *   - prepareExecSql(...)  — parameterized; for per-row inserts.
 *   - health()             — engine ping.
 */

export interface AidbClientOptions {
  baseUrl?: string;
  apiKey: string;
  timeoutMs?: number;
}

export interface SqlResult {
  rows: unknown[][];
  rows_affected?: number;
  execution_time_ms?: number;
}

export class AidbClient {
  private readonly baseUrl: string;
  private readonly apiKey: string;
  private readonly timeoutMs: number;

  constructor(opts: AidbClientOptions) {
    this.baseUrl = (opts.baseUrl ?? 'http://127.0.0.1:8081').replace(/\/+$/, '');
    this.apiKey = opts.apiKey;
    this.timeoutMs = opts.timeoutMs ?? 30_000;
  }

  async health(): Promise<boolean> {
    try {
      const ctl = new AbortController();
      const t = setTimeout(() => ctl.abort(), 5_000);
      const res = await fetch(`${this.baseUrl}/health`, { signal: ctl.signal });
      clearTimeout(t);
      if (!res.ok) return false;
      const body = (await res.json()) as { status?: string };
      return body.status === 'ok';
    } catch {
      return false;
    }
  }

  async execSql(sql: string): Promise<SqlResult> {
    const res = await this.post('/v1/query/execute', { sql });
    return {
      rows: (res.rows as unknown[][]) ?? [],
      rows_affected: res.rows_affected as number | undefined,
      execution_time_ms: res.execution_time_ms as number | undefined,
    };
  }

  async prepareExecSql(
    sql: string,
    params: ReadonlyArray<unknown>,
  ): Promise<SqlResult> {
    const prep = (await this.post('/v1/query/prepare', { sql })) as {
      statement_id: string;
    };
    try {
      const wire = await this.post('/v1/query/exec', {
        statement_id: prep.statement_id,
        params,
      });
      return {
        rows: (wire.rows as unknown[][]) ?? [],
        rows_affected: wire.rows_affected as number | undefined,
        execution_time_ms: wire.execution_time_ms as number | undefined,
      };
    } finally {
      void this.post('/v1/query/close', {
        statement_id: prep.statement_id,
      }).catch(() => undefined);
    }
  }

  private async post(path: string, body: unknown): Promise<Record<string, unknown>> {
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), this.timeoutMs);
    let res: Response;
    try {
      res = await fetch(`${this.baseUrl}${path}`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          authorization: `Bearer ${this.apiKey}`,
        },
        body: JSON.stringify(body),
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
      const msg =
        (parsed as { error?: { message?: string } } | undefined)?.error?.message ??
        `AIDB ${path} → ${res.status}`;
      throw new Error(`${msg} :: ${JSON.stringify(parsed).slice(0, 400)}`);
    }
    if (parsed && typeof parsed === 'object' && 'data' in parsed) {
      return (parsed as { data: Record<string, unknown> }).data;
    }
    return parsed as Record<string, unknown>;
  }

  /** Helper: quote a SQL string literal safely (single-quote escape). */
  static q(v: string): string {
    return `'${v.replace(/'/g, "''")}'`;
  }
}
