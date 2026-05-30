/**
 * AML action dispatcher. Mirror of apps/soar/src/lib/actions/dispatcher.ts
 * with AML tables (aml_actions, aml_approval_queue) + aml_audit_log.
 */

import 'server-only';
import { randomUUID } from 'node:crypto';

import { getAdminClient } from '@synapcores/app-framework/db/server';
import type { ActionContext, ActionState } from './types';
import { getActionDef } from './registry';
import { writeAmlAudit } from '../aml-transactions';

const APPROVAL_TTL_MS = 24 * 60 * 60 * 1000;

export interface DispatchInput {
  actionId: string;
  args: unknown;
  ctx: ActionContext;
  preApproved?: boolean;
}

export interface DispatchResult {
  actionRowId: string;
  state: ActionState;
  approvalRowId?: string;
  responsePayload?: unknown;
  errorMessage?: string;
}

export async function dispatchAction(input: DispatchInput): Promise<DispatchResult> {
  const def = getActionDef(input.actionId);
  if (!def) {
    return failImmediately(input, `Unknown action '${input.actionId}'.`);
  }

  const parseResult = def.schema.safeParse(input.args);
  if (!parseResult.success) {
    return failImmediately(
      input,
      `Invalid args: ${parseResult.error.issues.map((i) => i.message).join('; ')}`,
    );
  }
  const validArgs = parseResult.data;

  const db = getAdminClient();
  const actionRowId = randomUUID();

  await db.sql(
    `INSERT INTO aml_actions
       (id, tenant_id, case_id, transaction_id, sar_id, action, target,
        request_payload, state, requested_by, requested_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'pending', $9, NOW())`,
    [
      actionRowId,
      input.ctx.tenantId,
      input.ctx.caseId ?? null,
      input.ctx.transactionId ?? null,
      input.ctx.sarId ?? null,
      input.actionId,
      extractTarget(validArgs),
      JSON.stringify(validArgs),
      `${input.ctx.invokedByType}:${input.ctx.invokedBy}`,
    ],
  );

  // HBR gate.
  if (def.hbr && !input.preApproved) {
    const approvalRowId = randomUUID();
    const expiresAt = new Date(Date.now() + APPROVAL_TTL_MS).toISOString();
    await db.sql(
      `INSERT INTO aml_approval_queue
         (id, tenant_id, action_id, requested_by, requested_at, state, expires_at)
       VALUES ($1, $2, $3, $4, NOW(), 'pending', $5)`,
      [
        approvalRowId,
        input.ctx.tenantId,
        actionRowId,
        `${input.ctx.invokedByType}:${input.ctx.invokedBy}`,
        expiresAt,
      ],
    );
    await db.sql(
      `UPDATE aml_actions SET state = 'awaiting_approval' WHERE id = $1`,
      [actionRowId],
    );
    await writeAmlAudit({
      tenantId: input.ctx.tenantId,
      actorId: input.ctx.invokedBy,
      actorType: input.ctx.invokedByType,
      action: 'action.awaiting_approval',
      transactionId: input.ctx.transactionId,
      caseId: input.ctx.caseId,
      sarId: input.ctx.sarId,
      payload: { action_id: input.actionId, action_row_id: actionRowId },
    });
    return { actionRowId, state: 'awaiting_approval', approvalRowId };
  }

  // Resolve adapter.
  let chosen = null;
  for (const adapter of def.adapters) {
    if (await adapter.isConfigured(input.ctx.tenantId)) {
      chosen = adapter;
      break;
    }
  }
  if (!chosen) {
    await db.sql(
      `UPDATE aml_actions
          SET state = 'failed', completed_at = NOW(), error_message = $2
        WHERE id = $1`,
      [
        actionRowId,
        `No adapter configured for action '${input.actionId}' in this tenant. Wire one at /settings/integrations.`,
      ],
    );
    await writeAmlAudit({
      tenantId: input.ctx.tenantId,
      actorId: input.ctx.invokedBy,
      actorType: input.ctx.invokedByType,
      action: 'action.failed',
      transactionId: input.ctx.transactionId,
      caseId: input.ctx.caseId,
      sarId: input.ctx.sarId,
      payload: { action_id: input.actionId, reason: 'no_adapter' },
    });
    return {
      actionRowId,
      state: 'failed',
      errorMessage: 'No adapter configured for this action in this tenant.',
    };
  }

  // Fire.
  await db.sql(`UPDATE aml_actions SET state = 'running' WHERE id = $1`, [actionRowId]);
  const result = await chosen.exec(
    validArgs as Parameters<typeof chosen.exec>[0],
    input.ctx,
  );
  await db.sql(
    `UPDATE aml_actions
        SET state = $2, response_payload = $3, completed_at = NOW(),
            error_message = $4
      WHERE id = $1`,
    [
      actionRowId,
      result.ok ? 'completed' : 'failed',
      JSON.stringify(result.responsePayload ?? {}),
      result.errorMessage ?? null,
    ],
  );
  await writeAmlAudit({
    tenantId: input.ctx.tenantId,
    actorId: input.ctx.invokedBy,
    actorType: input.ctx.invokedByType,
    action: result.ok ? 'action.completed' : 'action.failed',
    transactionId: input.ctx.transactionId,
    caseId: input.ctx.caseId,
    sarId: input.ctx.sarId,
    payload: {
      action_id: input.actionId,
      action_row_id: actionRowId,
      provider: chosen.provider,
      ok: result.ok,
      error: result.errorMessage,
    },
  });

  return {
    actionRowId,
    state: result.ok ? 'completed' : 'failed',
    responsePayload: result.responsePayload,
    errorMessage: result.errorMessage,
  };
}

function extractTarget(args: unknown): string | null {
  if (typeof args !== 'object' || args === null) return null;
  const obj = args as Record<string, unknown>;
  for (const key of ['account_number', 'customer_id', 'sar_id', 'case_id', 'search_term']) {
    if (typeof obj[key] === 'string') return obj[key] as string;
  }
  return null;
}

async function failImmediately(
  input: DispatchInput,
  message: string,
): Promise<DispatchResult> {
  const db = getAdminClient();
  const actionRowId = randomUUID();
  await db.sql(
    `INSERT INTO aml_actions
       (id, tenant_id, case_id, transaction_id, sar_id, action, target,
        request_payload, state, requested_by, requested_at,
        completed_at, error_message)
     VALUES ($1, $2, $3, $4, $5, $6, NULL, $7, 'failed', $8, NOW(), NOW(), $9)`,
    [
      actionRowId,
      input.ctx.tenantId,
      input.ctx.caseId ?? null,
      input.ctx.transactionId ?? null,
      input.ctx.sarId ?? null,
      input.actionId,
      JSON.stringify(input.args ?? {}),
      `${input.ctx.invokedByType}:${input.ctx.invokedBy}`,
      message,
    ],
  );
  await writeAmlAudit({
    tenantId: input.ctx.tenantId,
    actorId: input.ctx.invokedBy,
    actorType: input.ctx.invokedByType,
    action: 'action.failed',
    transactionId: input.ctx.transactionId,
    caseId: input.ctx.caseId,
    sarId: input.ctx.sarId,
    payload: { action_id: input.actionId, reason: message },
  });
  return { actionRowId, state: 'failed', errorMessage: message };
}
