/**
 * Closed-loop learning — Requirement 9 of the SOAR Demo Completion doc.
 *
 * When an incident closes, this module:
 *   1. Computes MTTD, MTTR, time-to-triage from the audit trail
 *   2. Generates a reusable embedding from (alerts + root cause +
 *      resolution + analyst notes)
 *   3. Computes a graph-pattern signature (which entity types touched,
 *      which relationship types fired)
 *   4. Persists everything as the incident's "memory" record so the
 *      next replay can retrieve it via findSimilarIncidents()
 *
 * Per the doc: "This is the most important part of the demo."
 */
import { getClientForSession } from '@synapcores/app-framework/db/server';
import type { Session } from '@synapcores/app-framework';

export interface CloseIncidentInput {
  incidentId: string;
  finalRootCause: string;
  finalResolution: string;
  analystNotes?: string;
  status: 'true_positive' | 'false_positive' | 'inconclusive';
  remediationOutcome: 'fully_remediated' | 'partial' | 'failed';
}

export interface CloseIncidentResult {
  incident_id: string;
  closed_at: string;
  mttd_seconds: number; // mean time to detect (first alert -> incident open)
  mttt_seconds: number; // mean time to triage (incident open -> human triaged)
  mttr_seconds: number; // mean time to resolve (incident open -> closed)
  embedding_dim: number;
  graph_pattern_signature: string;
  audit_event_id: string;
}

/**
 * Close an incident and persist its learning artefacts.
 *
 * Engine notes:
 *  - We use EMBED() to produce the incident memory vector.
 *  - We use IMMUTABLE TABLE writes for the audit event.
 *  - We avoid JOIN ON TEXT-keyed columns (engine bug #207); the
 *    affected_entities and event_type_sequence columns are JSON arrays
 *    we'll Jaccard-overlap on the read side (see ./similar.ts).
 */
export async function closeIncident(
  session: Session,
  input: CloseIncidentInput,
): Promise<CloseIncidentResult> {
  if (!session.tenant) {
    throw new Error('closeIncident requires an authenticated tenant session');
  }
  const db = await getClientForSession(session);
  const now = new Date().toISOString();
  const tenantId = session.tenant.id;

  // 1. Load the incident's alerts to compute timing + assemble the
  //    semantic blob for embedding.
  const alerts = await db.sql<{
    id: string;
    ts: string;
    severity: string;
    summary: string;
    entity_type: string;
    entity_id: string;
    event_type: string;
  }>(
    `SELECT a.id, a.ts, a.severity, a.summary,
            a.entity_type, a.entity_id, a.event_type
       FROM soar_alerts a, soar_incident_alerts ia
      WHERE ia.incident_id = $1
        AND ia.alert_id = a.id
        AND a.tenant_id = $2
      ORDER BY a.ts ASC`,
    [input.incidentId, tenantId],
  );
  if (alerts.rows.length === 0) {
    throw new Error(`No alerts found for incident ${input.incidentId}`);
  }

  // 2. Compute timing metrics from the audit trail + alerts.
  const incRow = await db.sql<{
    opened_at: string;
    triaged_at: string | null;
  }>(
    `SELECT opened_at, triaged_at
       FROM soar_incidents
      WHERE id = $1 AND tenant_id = $2
      LIMIT 1`,
    [input.incidentId, tenantId],
  );
  if (!incRow.rows[0]) {
    throw new Error(`Incident ${input.incidentId} not found`);
  }
  const firstAlertTs = new Date(alerts.rows[0]!.ts).getTime();
  const openedAt = new Date(incRow.rows[0].opened_at).getTime();
  const triagedAt = incRow.rows[0].triaged_at
    ? new Date(incRow.rows[0].triaged_at).getTime()
    : openedAt;
  const closedAt = new Date(now).getTime();
  const mttdSeconds = Math.max(0, Math.round((openedAt - firstAlertTs) / 1000));
  const motSeconds = Math.max(0, Math.round((triagedAt - openedAt) / 1000));
  const mttrSeconds = Math.max(0, Math.round((closedAt - openedAt) / 1000));

  // 3. Assemble the semantic blob for embedding.
  const blobParts = [
    `Incident: ${input.incidentId}`,
    `Root cause: ${input.finalRootCause}`,
    `Resolution: ${input.finalResolution}`,
    input.analystNotes ? `Analyst notes: ${input.analystNotes}` : '',
    `Status: ${input.status}`,
    `Remediation outcome: ${input.remediationOutcome}`,
    `Alert sequence: ${alerts.rows.map((a) => `${a.event_type}:${a.summary}`).join(' | ')}`,
  ].filter(Boolean);
  const semanticBlob = blobParts.join('\n');

  // 4. Generate the embedding via EMBED() on the engine side.
  const embedRow = await db.sql<{ embedding: number[] }>(
    `SELECT EMBED($1) AS embedding`,
    [semanticBlob],
  );
  const embedding = embedRow.rows[0]?.embedding ?? null;

  // 5. Build the affected_entities + event_type_sequence JSON arrays.
  //    These power the graph-overlap and sequence-overlap parts of
  //    similar-incident retrieval (./similar.ts).
  const affectedEntities = Array.from(
    new Set(alerts.rows.map((a) => `${a.entity_type}:${a.entity_id}`)),
  );
  const eventTypeSequence = alerts.rows.map((a) => a.event_type);

  // 6. Compute a stable pattern signature (entity-type-set + event-type-set,
  //    sorted alphabetically + hashed). This is the discriminator for
  //    "same graph pattern" queries.
  const entityTypes = Array.from(
    new Set(alerts.rows.map((a) => a.entity_type)),
  ).sort();
  const eventTypes = Array.from(
    new Set(alerts.rows.map((a) => a.event_type)),
  ).sort();
  const graphPatternSignature = stableHash(
    `entities:${entityTypes.join(',')}|events:${eventTypes.join(',')}`,
  );

  // 7. Persist the closure on the incident row.
  await db.sql(
    `UPDATE soar_incidents
        SET status = 'closed',
            closed_at = NOW(),
            final_root_cause = $1,
            final_resolution = $2,
            analyst_notes = $3,
            outcome_status = $4,
            remediation_outcome = $5,
            mttd_seconds = $6,
            mttt_seconds = $7,
            mttr_seconds = $8,
            embedding = $9,
            affected_entities = $10,
            event_type_sequence = $11,
            graph_pattern_signature = $12
      WHERE id = $13 AND tenant_id = $14`,
    [
      input.finalRootCause,
      input.finalResolution,
      input.analystNotes ?? null,
      input.status,
      input.remediationOutcome,
      mttdSeconds,
      motSeconds,
      mttrSeconds,
      embedding,
      JSON.stringify(affectedEntities),
      JSON.stringify(eventTypeSequence),
      graphPatternSignature,
      input.incidentId,
      tenantId,
    ],
  );

  // 8. Audit the closure — IMMUTABLE table, chain-of-hashes.
  const auditId = await writeClosureAudit(db, session, {
    incidentId: input.incidentId,
    finalRootCause: input.finalRootCause,
    finalResolution: input.finalResolution,
    embeddingDim: Array.isArray(embedding) ? embedding.length : 0,
    graphPatternSignature,
    mttdSeconds,
    mttrSeconds,
  });

  return {
    incident_id: input.incidentId,
    closed_at: now,
    mttd_seconds: mttdSeconds,
    mttt_seconds: motSeconds,
    mttr_seconds: mttrSeconds,
    embedding_dim: Array.isArray(embedding) ? embedding.length : 0,
    graph_pattern_signature: graphPatternSignature,
    audit_event_id: auditId,
  };
}

// ─── helpers ─────────────────────────────────────────────────────────

function stableHash(s: string): string {
  // FNV-1a 32-bit, then to hex. Deterministic + dependency-free.
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0).toString(16).padStart(8, '0');
}

async function writeClosureAudit(
  db: Awaited<ReturnType<typeof getClientForSession>>,
  session: Session,
  payload: {
    incidentId: string;
    finalRootCause: string;
    finalResolution: string;
    embeddingDim: number;
    graphPatternSignature: string;
    mttdSeconds: number;
    mttrSeconds: number;
  },
): Promise<string> {
  if (!session.tenant) throw new Error('tenant required');
  const auditId = crypto.randomUUID();
  await db.sql(
    `INSERT INTO soar_audit_log
       (id, tenant_id, ts, actor_type, actor_id, action, target_type, target_id, payload)
     VALUES ($1, $2, NOW(), 'system', $3, 'incident_closed', 'incident', $4, $5)`,
    [
      auditId,
      session.tenant.id,
      session.user.id,
      payload.incidentId,
      JSON.stringify(payload),
    ],
  );
  return auditId;
}
