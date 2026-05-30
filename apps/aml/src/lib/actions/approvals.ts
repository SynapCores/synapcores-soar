/**
 * AML approval queue primitives. Mirror of SOAR's approvals.ts.
 * HBR actions land here; an admin clicks Approve, we flip the row +
 * re-call the dispatcher with preApproved:true.
 */

import 'server-only';
import { getAdminClient } from '@synapcores/app-framework/db/server';
import { writeAmlAudit } from '../aml-transactions';
import { dispatchAction } from './dispatcher';

export interface PendingApprovalRow {
  id: string;
  action_id: string;
  action: string;
  target: string | null;
  request_payload: unknown;
  requested_by: string;
  requested_at: string;
  expires_at: string;
  case_id: string | null;
  transaction_id: string | null;
  sar_id: string | null;
}

export async function listPendingApprovals(
  tenantId: string,
): Promise<PendingApprovalRow[]> {
  const db = getAdminClient();
  const queue = await db.sql<{
    id: string;
    action_id: string;
    requested_by: string;
    requested_at: string;
    expires_at: string;
  }>(
    `SELECT id, action_id, requested_by, requested_at, expires_at
       FROM aml_approval_queue
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
      case_id: string | null;
      transaction_id: string | null;
      sar_id: string | null;
    }>(
      `SELECT action, target, request_payload, case_id, transaction_id, sar_id
         FROM aml_actions
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
      case_id: a.case_id,
      transaction_id: a.transaction_id,
      sar_id: a.sar_id,
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
  newState?: string;
  errorMessage?: string;
}

export async function resolveApproval(input: ResolveInput): Promise<ResolveResult> {
  const db = getAdminClient();

  const queueResult = await db.sql<{
    id: string;
    tenant_id: string;
    action_id: string;
    state: string;
    expires_at: string;
  }>(
    `SELECT id, tenant_id, action_id, state, expires_at
       FROM aml_approval_queue WHERE id = $1 LIMIT 1`,
    [input.approvalId],
  );
  const q = queueResult.rows[0];
  if (!q) return { ok: false, errorMessage: 'Approval not found.' };
  if (q.state !== 'pending') {
    return { ok: false, errorMessage: `Approval is already ${q.state}.` };
  }
  if (new Date(q.expires_at) < new Date()) {
    await db.sql(
      `UPDATE aml_approval_queue SET state = 'expired', decided_at = NOW() WHERE id = $1`,
      [input.approvalId],
    );
    return { ok: false, errorMessage: 'Approval has expired.' };
  }

  await db.sql(
    `UPDATE aml_approval_queue
        SET state = $2, decided_by = $3, decided_at = NOW(),
            decision_note = $4
      WHERE id = $1`,
    [input.approvalId, input.decision, input.decidedByUserId, input.decisionNote ?? null],
  );

  if (input.decision === 'rejected') {
    await db.sql(
      `UPDATE aml_actions
          SET state = 'rejected', completed_at = NOW(),
              error_message = COALESCE($2, 'rejected by reviewer')
        WHERE id = $1`,
      [q.action_id, input.decisionNote ?? null],
    );
    await writeAmlAudit({
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

  // Approved → re-fire with preApproved.
  const action = await db.sql<{
    action: string;
    request_payload: string | null;
    case_id: string | null;
    transaction_id: string | null;
    sar_id: string | null;
  }>(
    `SELECT action, request_payload, case_id, transaction_id, sar_id
       FROM aml_actions WHERE id = $1 LIMIT 1`,
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

  await writeAmlAudit({
    tenantId: q.tenant_id,
    actorId: input.decidedByUserId,
    actorType: 'analyst',
    action: 'action.approved',
    caseId: a.case_id ?? undefined,
    transactionId: a.transaction_id ?? undefined,
    sarId: a.sar_id ?? undefined,
    payload: {
      action_row_id: q.action_id,
      approval_id: input.approvalId,
      note: input.decisionNote ?? null,
    },
  });

  await db.sql(
    `UPDATE aml_actions
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
      caseId: a.case_id ?? undefined,
      transactionId: a.transaction_id ?? undefined,
      sarId: a.sar_id ?? undefined,
    },
    preApproved: true,
  });

  return {
    ok: true,
    newState: dispatched.state,
    errorMessage: dispatched.errorMessage,
  };
}
