/**
 * SOAR alert primitives — ingest, dedup, list, fetch.
 *
 * Dedup model: compute EMBED(title + description), search the rolling
 * 30-day window for nearest neighbor; if cosine ≥ DEDUP_THRESHOLD,
 * mark as `duplicate` and link to the source. Otherwise leave as
 * `new` for the triage agent to pick up.
 *
 * The triage agent dispatch lives in Phase 6 — this phase just lands
 * the row + decides dup-or-not + writes to soar_audit_log.
 */

import 'server-only';
import { randomUUID } from 'node:crypto';

import { getAdminClient } from '@synapcores/app-framework/db/server';

/** Cosine similarity cutoff for "this is a duplicate of an existing alert". */
const DEDUP_THRESHOLD = 0.85;
/** Time window the dedup search scans. */
const DEDUP_WINDOW_DAYS = 30;

export type AlertSeverity = 'critical' | 'high' | 'medium' | 'low' | 'info';
export type AlertStatus = 'new' | 'triaged' | 'duplicate' | 'incident' | 'closed';

export interface IngestAlertInput {
  tenantId: string;
  source: string;
  sourceAlertId?: string;
  severity: AlertSeverity;
  title: string;
  description?: string;
  rawPayload?: unknown;
}

export interface AlertRow {
  id: string;
  tenant_id: string;
  source: string;
  source_alert_id: string | null;
  severity: AlertSeverity;
  title: string;
  description: string | null;
  status: AlertStatus;
  status_reason: string | null;
  dup_of: string | null;
  raw_payload: unknown;
  created_at: string;
  triaged_at: string | null;
  closed_at: string | null;
}

export interface IngestResult {
  alertId: string;
  status: AlertStatus;
  dupOf: string | null;
  cosineToNearest: number | null;
}

/**
 * Insert an alert. Computes embedding inline via EMBED() to avoid a
 * second network hop; the engine handles vector indexing. Runs the
 * dedup search; if a near-duplicate exists, marks as such.
 */
export async function ingestAlert(input: IngestAlertInput): Promise<IngestResult> {
  const db = getAdminClient();
  const id = randomUUID();
  const text = `${input.title}\n${input.description ?? ''}`.trim();
  const rawJson = JSON.stringify(input.rawPayload ?? {});

  // Insert + compute vec in one statement. The CE engine doesn't
  // auto-populate DEFAULT NOW() reliably on tables with VECTOR
  // columns, so we pass created_at explicitly.
  await db.sql(
    `INSERT INTO soar_alerts
       (id, tenant_id, source, source_alert_id, severity, title, description,
        status, raw_payload, semantic_vec, created_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, 'new', $8, EMBED($9), NOW())`,
    [
      id,
      input.tenantId,
      input.source,
      input.sourceAlertId ?? null,
      input.severity,
      input.title,
      input.description ?? null,
      rawJson,
      text,
    ],
  );

  // Dedup search. We pull the nearest neighbor (excluding the alert
  // we just inserted) within the rolling window.
  let cosine: number | null = null;
  let dupOf: string | null = null;
  let status: AlertStatus = 'new';
  try {
    const nearest = await db.sql<{
      id: string;
      cosine: number;
    }>(
      `SELECT id,
              COSINE_SIMILARITY(semantic_vec, (SELECT semantic_vec FROM soar_alerts WHERE id = $1)) AS cosine
         FROM soar_alerts
        WHERE tenant_id = $2
          AND id <> $1
          AND created_at > NOW() - INTERVAL '${DEDUP_WINDOW_DAYS} day'
        ORDER BY cosine DESC
        LIMIT 1`,
      [id, input.tenantId],
    );
    if (nearest.rows[0]) {
      cosine = Number(nearest.rows[0].cosine);
      if (cosine >= DEDUP_THRESHOLD) {
        dupOf = nearest.rows[0].id;
        status = 'duplicate';
      }
    }
  } catch {
    // Engine may not support the COSINE_SIMILARITY function or the
    // subquery shape; degrade gracefully — the triage agent (Phase 6)
    // will still pick up the un-flagged alert.
  }

  if (status === 'duplicate' && dupOf) {
    await db.sql(
      `UPDATE soar_alerts
          SET status = 'duplicate', dup_of = $1,
              status_reason = $2, triaged_at = NOW()
        WHERE id = $3`,
      [dupOf, `near-duplicate of ${dupOf} (cosine=${cosine?.toFixed(3)})`, id],
    );
  }

  await writeSoarAudit({
    tenantId: input.tenantId,
    actorType: 'system',
    action: status === 'duplicate' ? 'alert.dedup' : 'alert.ingest',
    alertId: id,
    payload: {
      source: input.source,
      severity: input.severity,
      dup_of: dupOf,
      cosine,
    },
  });

  return { alertId: id, status, dupOf, cosineToNearest: cosine };
}

export interface ListAlertsOpts {
  tenantId: string;
  status?: AlertStatus | 'all';
  severity?: AlertSeverity | 'all';
  limit?: number;
  offset?: number;
}

export async function listAlerts(opts: ListAlertsOpts): Promise<AlertRow[]> {
  const db = getAdminClient();
  const limit = Math.min(Math.max(opts.limit ?? 100, 1), 500);
  const offset = Math.max(opts.offset ?? 0, 0);

  // CE engine: dynamic WHERE clauses with multiple optional filters
  // get unreliable. Resolve the filter case at compile-time.
  const status = opts.status ?? 'all';
  const severity = opts.severity ?? 'all';

  let result;
  if (status === 'all' && severity === 'all') {
    result = await db.sql<AlertRow>(
      `SELECT id, tenant_id, source, source_alert_id, severity, title, description,
              status, status_reason, dup_of, raw_payload, created_at, triaged_at, closed_at
         FROM soar_alerts
        WHERE tenant_id = $1
        ORDER BY created_at DESC
        LIMIT $2 OFFSET $3`,
      [opts.tenantId, limit, offset],
    );
  } else if (status !== 'all' && severity === 'all') {
    result = await db.sql<AlertRow>(
      `SELECT id, tenant_id, source, source_alert_id, severity, title, description,
              status, status_reason, dup_of, raw_payload, created_at, triaged_at, closed_at
         FROM soar_alerts
        WHERE tenant_id = $1 AND status = $2
        ORDER BY created_at DESC
        LIMIT $3 OFFSET $4`,
      [opts.tenantId, status, limit, offset],
    );
  } else if (status === 'all' && severity !== 'all') {
    result = await db.sql<AlertRow>(
      `SELECT id, tenant_id, source, source_alert_id, severity, title, description,
              status, status_reason, dup_of, raw_payload, created_at, triaged_at, closed_at
         FROM soar_alerts
        WHERE tenant_id = $1 AND severity = $2
        ORDER BY created_at DESC
        LIMIT $3 OFFSET $4`,
      [opts.tenantId, severity, limit, offset],
    );
  } else {
    result = await db.sql<AlertRow>(
      `SELECT id, tenant_id, source, source_alert_id, severity, title, description,
              status, status_reason, dup_of, raw_payload, created_at, triaged_at, closed_at
         FROM soar_alerts
        WHERE tenant_id = $1 AND status = $2 AND severity = $3
        ORDER BY created_at DESC
        LIMIT $4 OFFSET $5`,
      [opts.tenantId, status, severity, limit, offset],
    );
  }
  return result.rows;
}

export async function getAlert(tenantId: string, id: string): Promise<AlertRow | null> {
  const db = getAdminClient();
  const result = await db.sql<AlertRow>(
    `SELECT id, tenant_id, source, source_alert_id, severity, title, description,
            status, status_reason, dup_of, raw_payload, created_at, triaged_at, closed_at
       FROM soar_alerts
      WHERE tenant_id = $1 AND id = $2 LIMIT 1`,
    [tenantId, id],
  );
  return result.rows[0] ?? null;
}

/** Counts by status — used by the dashboard stat cards. */
export async function alertCounts(tenantId: string): Promise<{
  new: number;
  triaged: number;
  duplicate: number;
  incident: number;
  closed: number;
  total: number;
}> {
  const db = getAdminClient();
  const out = { new: 0, triaged: 0, duplicate: 0, incident: 0, closed: 0, total: 0 };
  const statuses: AlertStatus[] = ['new', 'triaged', 'duplicate', 'incident', 'closed'];
  for (const s of statuses) {
    const n = await db.sqlScalar<number>(
      `SELECT COUNT(*) FROM soar_alerts WHERE tenant_id = $1 AND status = $2`,
      [tenantId, s],
    );
    out[s] = Number(n ?? 0);
    out.total += out[s];
  }
  return out;
}

// ─── SOAR-domain audit helper ────────────────────────────────────────────

interface SoarAuditEvent {
  tenantId: string;
  actorId?: string | null;
  actorType: 'analyst' | 'agent' | 'system' | 'mcp_token';
  action: string;
  alertId?: string | null;
  incidentId?: string | null;
  payload?: Record<string, unknown>;
  requestId?: string;
}

export async function writeSoarAudit(evt: SoarAuditEvent): Promise<void> {
  const db = getAdminClient();
  await db.sql(
    `INSERT INTO soar_audit_log
       (ts, tenant_id, actor_id, actor_type, action, alert_id, incident_id, payload, request_id)
     VALUES (NOW(), $1, $2, $3, $4, $5, $6, $7, $8)`,
    [
      evt.tenantId,
      evt.actorId ?? null,
      evt.actorType,
      evt.action,
      evt.alertId ?? null,
      evt.incidentId ?? null,
      JSON.stringify(evt.payload ?? {}),
      evt.requestId ?? null,
    ],
  );
}
