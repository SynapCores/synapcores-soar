/**
 * Triage dispatcher.
 *
 * Primary path: SELECT AGENT_RUN('tier1-triage', alert_id::json) — the
 * engine's persona-bound ReAct loop with its tool registry. Requires
 * the operator to have configured an LLM (Ollama / OpenAI / native) in
 * ai_chat.toml.
 *
 * Fallback path: if AGENT_RUN times out, errors, or `SOAR_TRIAGE_MODE`
 * is set to `'fallback'`, we run a deterministic local triage that:
 *   - looks at the dedup verdict (alerts already deduped → false_positive)
 *   - looks at known-bad sources / severity for auto-incident escalation
 *   - else marks as needs_human
 *
 * The fallback is a development affordance so the loop is reviewable
 * without an LLM. Production sets `SOAR_TRIAGE_MODE='agent'` and the
 * engine handles the call.
 */

import 'server-only';
import { getAdminClient } from '@synapcores/app-framework/db/server';
import { getAlert, writeSoarAudit, type AlertRow } from './soar-alerts';

export interface TriageVerdict {
  /** Which path produced the verdict. */
  source: 'agent' | 'fallback';
  /** Classification. */
  verdict: 'false_positive' | 'true_positive' | 'needs_human';
  /** Short reason — what the analyst sees first. */
  rationale: string;
  /** Score 0-100. */
  severity_score: number;
  /** Similar prior alerts referenced. */
  similar_alerts: string[];
  /** Tool calls the agent made (empty for fallback path). */
  trace: Array<{ tool: string; args: unknown; result?: unknown }>;
  /** ms the dispatch took end-to-end. */
  duration_ms: number;
}

const MODE = process.env.SOAR_TRIAGE_MODE ?? 'auto';

export async function runTriage(
  tenantId: string,
  alertId: string,
): Promise<TriageVerdict> {
  const alert = await getAlert(tenantId, alertId);
  if (!alert) throw new Error(`Alert ${alertId} not found.`);

  // If the alert is already marked duplicate, short-circuit.
  if (alert.status === 'duplicate' && alert.dup_of) {
    return {
      source: 'fallback',
      verdict: 'false_positive',
      rationale: `Already auto-deduped to ${alert.dup_of}.`,
      severity_score: 0,
      similar_alerts: [alert.dup_of],
      trace: [],
      duration_ms: 0,
    };
  }

  const start = Date.now();

  // Mode 'fallback' or 'auto' (without a live LLM): skip the agent.
  if (MODE === 'fallback') {
    const v = deterministicTriage(alert);
    v.duration_ms = Date.now() - start;
    await persistVerdict(tenantId, alertId, v);
    return v;
  }

  // Mode 'agent' or 'auto': try the engine. On timeout / error, fall
  // back so the UI flow doesn't break for dev users without an LLM.
  try {
    const db = getAdminClient();
    const result = await db.sql<{ verdict: string }>(
      `SELECT AGENT_RUN('tier1-triage', $1) AS verdict`,
      [JSON.stringify({ alert_id: alertId, tenant_id: tenantId })],
    );
    const raw = result.rows[0]?.verdict;
    if (raw) {
      const parsed = parseAgentVerdict(raw);
      parsed.duration_ms = Date.now() - start;
      await persistVerdict(tenantId, alertId, parsed);
      return parsed;
    }
    throw new Error('AGENT_RUN returned no rows');
  } catch (err) {
    if (MODE === 'agent') throw err;
    // auto-mode: dev fallback
    const v = deterministicTriage(alert);
    v.rationale = `(LLM unavailable — fallback verdict) ${v.rationale}`;
    v.duration_ms = Date.now() - start;
    await persistVerdict(tenantId, alertId, v);
    return v;
  }
}

/**
 * Deterministic triage used as a dev fallback. Real signal:
 * - Severity → base score
 * - Known-noisy sources → cap score
 * - Critical / authentication signals → escalate
 */
function deterministicTriage(alert: AlertRow): TriageVerdict {
  const sevScore: Record<string, number> = {
    critical: 90,
    high: 70,
    medium: 40,
    low: 15,
    info: 5,
  };
  let score = sevScore[alert.severity] ?? 30;
  let verdict: TriageVerdict['verdict'] = 'needs_human';
  let rationale = `Severity ${alert.severity} from ${alert.source}.`;

  // Heuristic 1: known-low-confidence sources cap the score
  if (
    alert.source.toLowerCase() === 'vulnerability_scanner' ||
    alert.title.toLowerCase().includes('informational')
  ) {
    score = Math.min(score, 25);
    verdict = 'false_positive';
    rationale = 'Low-confidence source / informational signal.';
  } else if (alert.severity === 'critical' || alert.severity === 'high') {
    verdict = 'true_positive';
    rationale = `${alert.severity} severity from ${alert.source} — opening incident.`;
  }

  return {
    source: 'fallback',
    verdict,
    rationale,
    severity_score: score,
    similar_alerts: [],
    trace: [],
    duration_ms: 0,
  };
}

/** Parse whatever the agent returned into our typed verdict shape. */
function parseAgentVerdict(raw: string): TriageVerdict {
  try {
    const obj = JSON.parse(raw) as Partial<TriageVerdict>;
    return {
      source: 'agent',
      verdict: (obj.verdict as TriageVerdict['verdict']) ?? 'needs_human',
      rationale: obj.rationale ?? '(agent returned no rationale)',
      severity_score: Number(obj.severity_score ?? 50),
      similar_alerts: Array.isArray(obj.similar_alerts)
        ? (obj.similar_alerts as string[])
        : [],
      trace: Array.isArray(obj.trace)
        ? (obj.trace as TriageVerdict['trace'])
        : [],
      duration_ms: 0,
    };
  } catch {
    return {
      source: 'agent',
      verdict: 'needs_human',
      rationale: `(unparseable agent response: ${raw.slice(0, 120)})`,
      severity_score: 50,
      similar_alerts: [],
      trace: [],
      duration_ms: 0,
    };
  }
}

async function persistVerdict(
  tenantId: string,
  alertId: string,
  v: TriageVerdict,
): Promise<void> {
  const db = getAdminClient();
  const nextStatus =
    v.verdict === 'false_positive' ? 'closed'
    : v.verdict === 'true_positive' ? 'incident'
    : 'triaged';
  await db.sql(
    `UPDATE soar_alerts
        SET status = $1, status_reason = $2, triaged_at = NOW()
      WHERE id = $3`,
    [nextStatus, v.rationale.slice(0, 500), alertId],
  );
  await writeSoarAudit({
    tenantId,
    actorType: 'agent',
    actorId: 'tier1-triage',
    action: 'alert.triage',
    alertId,
    payload: {
      source: v.source,
      verdict: v.verdict,
      severity_score: v.severity_score,
      duration_ms: v.duration_ms,
    },
  });
}
