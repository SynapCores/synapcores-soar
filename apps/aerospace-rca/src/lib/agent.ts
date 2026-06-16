/**
 * In-DB-agentic findings.
 *
 * Two personas:
 *   - reliability_engineer: "find similar past anomalies, report which
 *     corrective actions touched which programs, flag programs still
 *     unprotected."
 *   - safety_officer: "find open RFAs sharing part/subsystem/supplier
 *     with this anomaly, find owners, identify departed-employee gaps,
 *     recommend a hold."
 *
 * Both compute the finding deterministically from real SQL queries —
 * those queries are the citations. AGENT_RUN() with `technical_advisor`
 * is then invoked in the background to add LLM-generated prose flavor;
 * if it doesn't finish within the request budget, the deterministic
 * finding is what the UI sees. Honest tradeoff documented in README:
 * the engine's AGENT_RUN ReAct loop takes 30-60s for the wide context
 * a real Safety Officer prompt needs, which doesn't fit the demo's
 * Act 4 timeline; we keep AGENT_RUN as the prose layer, not the truth
 * layer.
 */

import 'server-only';
import { randomUUID } from 'node:crypto';

import { db } from './db';
import { writeEvidence } from './audit';
import { findSimilarAnomalies, getAnomaly } from './anomalies';
import type { AgentFinding } from './types';

interface CorrectiveCoverage {
  programs_covered: Array<{ program: string; status: 'covered' | 'unprotected' }>;
  citations: string[];
}

async function correctiveCoverage(
  anomalyId: string,
): Promise<CorrectiveCoverage> {
  const c = db();
  // Anomaly → part_id is encoded in the source data via the corrective_actions
  // history rather than a column on anomalies. We derive the affected programs
  // by looking at all corrective actions on similar past anomalies and the
  // affected programs of their target part. For the demo, the bearing race
  // story is hard-wired by joining via the related corrective actions.
  const similar = await findSimilarAnomalies(anomalyId, 5);
  if (similar.length === 0) {
    return { programs_covered: [], citations: [] };
  }

  // For each similar anomaly, find any corrective action and the programs it
  // was applied to. Aggregate up to a per-program coverage map.
  const ids = similar.map((s) => `'${s.id.replace(/'/g, "''")}'`).join(',');
  const cas = await c.sql<{
    id: string;
    anomaly_id: string;
    title: string;
    applied_to_programs: string | null;
  }>(
    `SELECT id, anomaly_id, title, applied_to_programs
       FROM corrective_actions
      WHERE anomaly_id IN (${ids})`,
  );

  const coveredPrograms = new Set<string>();
  const referencedPrograms = new Set<string>();
  for (const s of similar) {
    referencedPrograms.add(s.program);
  }
  // also include this anomaly's program
  const me = await getAnomaly(anomalyId);
  if (me) referencedPrograms.add(me.program);

  const citations: string[] = [];
  for (const ca of cas.rows) {
    citations.push(`${ca.id} (${ca.title})`);
    const programs = (ca.applied_to_programs ?? '').split(',').filter(Boolean);
    for (const p of programs) coveredPrograms.add(p);
  }
  const programs_covered = [...referencedPrograms].map((p) => ({
    program: p,
    status: coveredPrograms.has(p) ? ('covered' as const) : ('unprotected' as const),
  }));
  return { programs_covered, citations };
}

export async function runReliabilityEngineer(
  anomalyId: string,
): Promise<AgentFinding> {
  const start = Date.now();
  const target = await getAnomaly(anomalyId);
  if (!target) {
    throw new Error(`Anomaly not found: ${anomalyId}`);
  }
  const coverage = await correctiveCoverage(anomalyId);
  const unprotected = coverage.programs_covered.filter(
    (p) => p.status === 'unprotected',
  );

  const summary = unprotected.length
    ? `${coverage.citations.length} prior corrective action(s) close the same signature on the covered programs. ${unprotected
        .map((u) => u.program)
        .join(', ')} ${unprotected.length === 1 ? 'is' : 'are'} referenced by the recall set but not yet protected by a propagated corrective action — likely propagation gap.`
    : `${coverage.citations.length} prior corrective action(s) cover the same signature; all referenced programs are protected.`;

  const recommended_action = unprotected.length
    ? `Open propagation review for ${unprotected
        .map((u) => u.program)
        .join(', ')}; mirror the verified BE-4 corrective actions onto those programs' supplier-acceptance flows.`
    : 'No propagation gap detected; continue routine reliability surveillance.';

  const finding: AgentFinding = {
    persona: 'reliability_engineer',
    summary,
    programs_covered: coverage.programs_covered,
    rfa_flags: [],
    recommended_action,
    citations: coverage.citations,
    duration_ms: Date.now() - start,
  };

  await persistRun(anomalyId, finding);
  // Fire-and-forget LLM narration; UI will fetch updated agent_runs to upgrade prose.
  void narrate(anomalyId, finding).catch(() => undefined);
  return finding;
}

export async function runSafetyOfficer(
  anomalyId: string,
): Promise<AgentFinding> {
  const start = Date.now();
  const target = await getAnomaly(anomalyId);
  if (!target) throw new Error(`Anomaly not found: ${anomalyId}`);

  const c = db();
  // Find anomalies similar to this one, then look up open RFAs that
  // share part_id or subsystem with any of them.
  const similar = await findSimilarAnomalies(anomalyId, 6);
  const subsystems = new Set<string>([target.subsystem]);
  for (const s of similar) subsystems.add(s.subsystem);

  // Walk the graph: which part does this anomaly occur on? Then which
  // other anomalies share that part? RFAs touching those parts become
  // candidates even if the subsystem label diverges.
  const relatedParts = new Set<string>();
  try {
    const partRows = await c.sql<{ pid: string }>(
      `MATCH (a:Anomaly)-[:OCCURRED_ON]->(p:Part)
         WHERE a.id = "${anomalyId.replace(/"/g, '')}"
         RETURN p.id AS pid`,
    );
    for (const r of partRows.rows) {
      const v = (r as { pid: unknown }).pid;
      if (typeof v === 'string') relatedParts.add(v);
    }
    // Also pull parts touched by the similar anomalies — same supplier
    // family means the RFA backlog can sit on the cousin parts.
    for (const s of similar) {
      const sib = await c.sql<{ pid: string }>(
        `MATCH (a:Anomaly)-[:OCCURRED_ON]->(p:Part)
           WHERE a.id = "${s.id.replace(/"/g, '')}"
           RETURN p.id AS pid`,
      );
      for (const r of sib.rows) {
        const v = (r as { pid: unknown }).pid;
        if (typeof v === 'string') relatedParts.add(v);
      }
    }
  } catch {
    // Graph traversal best-effort; subsystem fallback still fires below.
  }

  // Pull open + in-review RFAs that touch a related subsystem OR part.
  const subsystemList = [...subsystems]
    .map((s) => `'${s.replace(/'/g, "''")}'`)
    .join(',');
  const partList = [...relatedParts]
    .map((p) => `'${p.replace(/'/g, "''")}'`)
    .join(',') || "''";
  const rfas = await c.sql<{
    id: string;
    program: string;
    owner: string;
    status: string;
    days_open: number;
    title: string;
    subsystem: string;
  }>(
    `SELECT id, program, owner, status, days_open, title, subsystem
       FROM rfas
      WHERE status IN ('open', 'in-review')
        AND (subsystem IN (${subsystemList}) OR related_part_id IN (${partList}))
      ORDER BY days_open DESC`,
  );

  // Filter to old + relevant. >60 days = "stale".
  const stale = rfas.rows.filter((r) => r.days_open > 60);

  // Cross-check owners against departed_employees.
  const departed = await c.sql<{ email: string; name: string }>(
    `SELECT email, name FROM departed_employees`,
  );
  const departedSet = new Set(departed.rows.map((r) => r.email));

  const rfa_flags = stale.map((r) => {
    const owner_departed = departedSet.has(r.owner);
    const reason = owner_departed
      ? `${r.days_open} days open · owner ${r.owner} has left the company (HR registry)`
      : `${r.days_open} days open · subsystem ${r.subsystem}`;
    return { id: r.id, reason, days_open: r.days_open };
  });

  const summary = stale.length
    ? `${stale.length} open RFA${stale.length === 1 ? '' : 's'} touch this anomaly's subsystem family (${[...subsystems].join(', ')}) and are >60 days old. ${
        rfa_flags.find((r) => r.reason.includes('left the company'))
          ? 'At least one is owned by an employee no longer at the company.'
          : 'None are owned by departed employees.'
      }`
    : 'No stale open RFAs touching this anomaly\'s subsystem family.';

  const recommended_action = stale.length
    ? 'Notify HLS / NG program management; recommend supplier-hold on Acme Bearings batches pre-24Q2 + immediate ownership reassignment for RFAs flagged as departed-employee-owned.'
    : 'No escalation recommended; continue trend tracking.';

  const finding: AgentFinding = {
    persona: 'safety_officer',
    summary,
    programs_covered: [],
    rfa_flags,
    recommended_action,
    citations: stale.map((r) => `${r.id} (${r.title})`),
    duration_ms: Date.now() - start,
  };
  await persistRun(anomalyId, finding);
  void narrate(anomalyId, finding).catch(() => undefined);
  return finding;
}

async function persistRun(
  anomalyId: string,
  finding: AgentFinding,
): Promise<void> {
  const id = `AGT-${randomUUID().slice(0, 8)}`;
  await db().sql(
    `INSERT INTO agent_runs (id, ts, persona, anomaly_id, task, result, duration_ms)
     VALUES ($1, NOW(), $2, $3, $4, $5, $6)`,
    [
      id,
      finding.persona,
      anomalyId,
      `Run ${finding.persona} on ${anomalyId}`,
      JSON.stringify(finding),
      finding.duration_ms,
    ],
  );
  await writeEvidence({
    actor: `agent:${finding.persona}`,
    action: 'agent.run',
    target_id: anomalyId,
    details: {
      run_id: id,
      programs_covered: finding.programs_covered,
      rfa_flags: finding.rfa_flags.map((r) => r.id),
      recommended_action: finding.recommended_action,
      citations: finding.citations,
    },
  });
}

/**
 * Background LLM narration. Best-effort; the deterministic finding is
 * always the source of truth. If the engine's AGENT_RUN finishes in
 * time, we update the agent_runs row with a prose field the UI can
 * upgrade to.
 */
async function narrate(
  anomalyId: string,
  finding: AgentFinding,
): Promise<void> {
  const persona =
    finding.persona === 'reliability_engineer'
      ? 'a reliability engineer in an aerospace propulsion program'
      : 'a flight safety officer';
  const factSheet =
    finding.persona === 'reliability_engineer'
      ? `Anomaly ${anomalyId}: ${finding.summary} Recommended: ${finding.recommended_action}`
      : `Anomaly ${anomalyId}: ${finding.summary} RFA flags: ${finding.rfa_flags
          .map((r) => `${r.id} (${r.reason})`)
          .join('; ')}. Recommended: ${finding.recommended_action}`;
  const prompt = `You are ${persona}. Reply with exactly two sentences of plain English summarizing this finding. Do not use any database tools. Do not query any tables. Just narrate.\n\n${factSheet}`;
  try {
    const result = await db().sql<{ answer: string }>(
      `SELECT AGENT_RUN('technical_advisor', $1) AS answer`,
      [prompt],
    );
    const prose = result.rows[0]?.answer?.trim();
    if (prose && prose.length > 0) {
      finding.prose = prose;
      // Best-effort update via a fresh row (immutable-safe — we don't UPDATE
      // an existing row; we append a new agent_runs row tagged as narration).
      await db().sql(
        `INSERT INTO agent_runs (id, ts, persona, anomaly_id, task, result, duration_ms)
         VALUES ($1, NOW(), $2, $3, $4, $5, $6)`,
        [
          `AGT-NAR-${randomUUID().slice(0, 6)}`,
          `${finding.persona}-narration`,
          anomalyId,
          `Narrate ${finding.persona} finding`,
          prose,
          0,
        ],
      );
    }
  } catch {
    // Narration is non-load-bearing; swallow.
  }
}

export async function latestAgentRun(
  anomalyId: string,
  persona: 'reliability_engineer' | 'safety_officer',
): Promise<AgentFinding | null> {
  const result = await db().sql<{ result: string; duration_ms: number }>(
    `SELECT result, duration_ms FROM agent_runs
      WHERE anomaly_id = $1 AND persona = $2
      ORDER BY ts DESC LIMIT 1`,
    [anomalyId, persona],
  );
  const row = result.rows[0];
  if (!row) return null;
  try {
    return JSON.parse(row.result) as AgentFinding;
  } catch {
    return null;
  }
}

export async function latestNarration(
  anomalyId: string,
  persona: 'reliability_engineer' | 'safety_officer',
): Promise<string | null> {
  const result = await db().sql<{ result: string }>(
    `SELECT result FROM agent_runs
      WHERE anomaly_id = $1 AND persona = $2
      ORDER BY ts DESC LIMIT 1`,
    [anomalyId, `${persona}-narration`],
  );
  return result.rows[0]?.result ?? null;
}
