/**
 * Approval queue primitives.
 *
 * Phase 6 dispatcher writes rows here when an HBR action lands. Phase
 * 7 (this) reads + resolves them: an admin clicks Approve, we flip
 * the queue row, then re-call dispatcher with `preApproved: true` so
 * the action actually fires.
 */

import 'server-only';
import { getAdminClient } from '@synapcores/app-framework/db/server';
import { writeSoarAudit } from '../soar-alerts';
import { dispatchAction } from './dispatcher';

export interface PendingApprovalRow {
  /** approval_queue row id. */
  id: string;
  /** soar_actions row id this approval blocks. */
  action_id: string;
  action: string;
  target: string | null;
  request_payload: unknown;
  requested_by: string;
  requested_at: string;
  expires_at: string;
  alert_id: string | null;
  incident_id: string | null;
}

export async function listPendingApprovals(
  tenantId: string,
): Promise<PendingApprovalRow[]> {
  const db = getAdminClient();
  // CE engine: no JOINs. Two-step: read approvals, then enrich from
  // soar_actions one row at a time.
  const queue = await db.sql<{
    id: string;
    action_id: string;
    requested_by: string;
    requested_at: string;
    expires_at: string;
  }>(
    `SELECT id, action_id, requested_by, requested_at, expires_at
       FROM soar_approval_queue
      WHERE tenant_id = $1 AND state = 'pending'
      ORDER BY requested_at`,
    [tenantId],
  );
  const rows: PendingApprovalRow[] = [];
  for (const q of queue.rows) {
    const action = await db.sql<{
      action: string;
      target: string | null;
      request_payload: string | null;
      alert_id: string | null;
      incident_id: string | null;
    }>(
      `SELECT action, target, request_payload, alert_id, incident_id
         FROM soar_actions
        WHERE id = $1 AND tenant_id = $2
        LIMIT 1`,
      [q.action_id, tenantId],
    );
    const a = action.rows[0];
    if (!a) continue;
    let payload: unknown = null;
    try {
      payload = a.request_payload ? JSON.parse(a.request_payload) : null;
    } catch {
      payload = a.request_payload;
    }
    rows.push({
      id: q.id,
      action_id: q.action_id,
      action: a.action,
      target: a.target,
      request_payload: payload,
      requested_by: q.requested_by,
      requested_at: q.requested_at,
      expires_at: q.expires_at,
      alert_id: a.alert_id,
      incident_id: a.incident_id,
    });
  }
  return rows;
}

export interface ResolveInput {
  approvalId: string;
  decision: 'approved' | 'rejected';
  decidedByUserId: string;
  decisionNote?: string;
}

export interface ResolveResult {
  ok: boolean;
  /** Set on approved+fired path. */
  newState?: string;
  /** Adapter error if approved+failed. */
  errorMessage?: string;
}

export async function resolveApproval(input: ResolveInput): Promise<ResolveResult> {
  const db = getAdminClient();

  // Look up the queue row + companion action row.
  const queueResult = await db.sql<{
    id: string;
    tenant_id: string;
    action_id: string;
    state: string;
    expires_at: string;
  }>(
    `SELECT id, tenant_id, action_id, state, expires_at
       FROM soar_approval_queue WHERE id = $1 LIMIT 1`,
    [input.approvalId],
  );
  const q = queueResult.rows[0];
  if (!q) return { ok: false, errorMessage: 'Approval not found.' };
  if (q.state !== 'pending') {
    return { ok: false, errorMessage: `Approval is already ${q.state}.` };
  }
  if (new Date(q.expires_at) < new Date()) {
    await db.sql(
      `UPDATE soar_approval_queue SET state = 'expired', decided_at = NOW() WHERE id = $1`,
      [input.approvalId],
    );
    return { ok: false, errorMessage: 'Approval has expired.' };
  }

  // Flip queue + action.
  await db.sql(
    `UPDATE soar_approval_queue
        SET state = $2, decided_by = $3, decided_at = NOW(),
            decision_note = $4
      WHERE id = $1`,
    [input.approvalId, input.decision, input.decidedByUserId, input.decisionNote ?? null],
  );

  if (input.decision === 'rejected') {
    await db.sql(
      `UPDATE soar_actions
          SET state = 'rejected',
              completed_at = NOW(),
              error_message = COALESCE($2, 'rejected by reviewer')
        WHERE id = $1`,
      [q.action_id, input.decisionNote ?? null],
    );
    await writeSoarAudit({
      tenantId: q.tenant_id,
      actorId: input.decidedByUserId,
      actorType: 'analyst',
      action: 'action.rejected',
      payload: {
        action_row_id: q.action_id,
        approval_id: input.approvalId,
        note: input.decisionNote ?? null,
      },
    });
    return { ok: true, newState: 'rejected' };
  }

  // Approved → re-fire through the dispatcher with preApproved=true.
  const action = await db.sql<{
    action: string;
    request_payload: string | null;
    alert_id: string | null;
    incident_id: string | null;
  }>(
    `SELECT action, request_payload, alert_id, incident_id
       FROM soar_actions WHERE id = $1 LIMIT 1`,
    [q.action_id],
  );
  const a = action.rows[0];
  if (!a) return { ok: false, errorMessage: 'Underlying action row missing.' };

  let args: unknown = {};
  try {
    args = a.request_payload ? JSON.parse(a.request_payload) : {};
  } catch {
    args = {};
  }

  await writeSoarAudit({
    tenantId: q.tenant_id,
    actorId: input.decidedByUserId,
    actorType: 'analyst',
    action: 'action.approved',
    alertId: a.alert_id ?? undefined,
    incidentId: a.incident_id ?? undefined,
    payload: {
      action_row_id: q.action_id,
      approval_id: input.approvalId,
      note: input.decisionNote ?? null,
    },
  });

  // The approved action gets re-dispatched fresh — the dispatcher
  // writes a NEW soar_actions row + ledger. The original
  // 'awaiting_approval' row is updated to 'approved' so the audit
  // trail shows both.
  await db.sql(
    `UPDATE soar_actions
        SET state = 'approved', completed_at = NOW()
      WHERE id = $1`,
    [q.action_id],
  );
  const dispatched = await dispatchAction({
    actionId: a.action,
    args,
    ctx: {
      tenantId: q.tenant_id,
      invokedBy: input.decidedByUserId,
      invokedByType: 'analyst',
      alertId: a.alert_id ?? undefined,
      incidentId: a.incident_id ?? undefined,
    },
    preApproved: true,
  });

  return {
    ok: true,
    newState: dispatched.state,
    errorMessage: dispatched.errorMessage,
  };
}
