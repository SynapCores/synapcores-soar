/**
 * Agent client — runs SynapCores AGENT_RUN() with a persona + input,
 * returns the structured verdict.
 *
 * This is the SQL function the engine exposes (v1.6.6.9+). The
 * framework wraps it so apps don't have to know the SQL.
 *
 * Persona = a recipe name registered in the SynapCores recipe library
 * for the tenant (e.g. 'tier1-triage', 'sar-drafter', 'soc2-evidence').
 *
 * Input = a JSON blob the persona understands. Common shape:
 *   { entity_id: string, context?: Record<string, unknown> }
 *
 * Verdict = whatever the persona returns. Strongly typed at the call
 * site via generics — the framework keeps no opinion about shape.
 */

import type { SynapCoresClient } from '../db/client';

export interface AgentRunOptions {
  /** Per-call timeout override (ms). Default: 120_000. */
  timeoutMs?: number;
  /** Override the model (otherwise persona's recipe-default is used). */
  model?: string;
}

export interface AgentRunResult<Verdict = unknown> {
  /** The persona's verdict — the JSON the agent returned. */
  verdict: Verdict;
  /** Trace ID — links into the audit log. */
  runId: string;
  /** ms the agent spent end-to-end. */
  durationMs: number;
}

export class AgentClient {
  constructor(private readonly db: SynapCoresClient) {}

  /**
   * Run the named persona against the given input.
   * Returns the parsed verdict + run id.
   *
   * Example:
   *   const result = await agent.run<TriageVerdict>('tier1-triage', {
   *     entity_id: 'ALR-9001',
   *   });
   */
  async run<Verdict = unknown>(
    persona: string,
    input: unknown,
    _opts: AgentRunOptions = {},
  ): Promise<AgentRunResult<Verdict>> {
    const start = Date.now();
    // The engine exposes AGENT_RUN as a SQL function; we wrap it in a
    // CTE so we get the run_id back in the same round-trip.
    const sql = `
      WITH r AS (
        SELECT AGENT_RUN($1, $2::json) AS verdict, GEN_UUID() AS run_id
      )
      SELECT verdict::text AS verdict, run_id::text AS run_id FROM r
    `;
    const inputJson = typeof input === 'string' ? input : JSON.stringify(input);
    const result = await this.db.sql<{ verdict: string; run_id: string }>(
      sql,
      [persona, inputJson],
    );

    const firstRow = result.rows[0];
    if (!firstRow) {
      throw new Error(
        `[agent] AGENT_RUN('${persona}', ...) returned no rows. The persona is probably not registered in the tenant.`,
      );
    }

    let verdict: Verdict;
    try {
      verdict = JSON.parse(firstRow.verdict) as Verdict;
    } catch {
      // Some personas return a bare string; keep it.
      verdict = firstRow.verdict as unknown as Verdict;
    }

    return {
      verdict,
      runId: firstRow.run_id,
      durationMs: Date.now() - start,
    };
  }

  /** Convenience: list the personas registered for the tenant. */
  async listPersonas(): Promise<
    Array<{ name: string; description: string; updated_at: string }>
  > {
    const result = await this.db.sql<{
      name: string;
      description: string;
      updated_at: string;
    }>(
      `SELECT name, description, updated_at
         FROM ai_personas
         ORDER BY name`,
    );
    return result.rows;
  }
}
