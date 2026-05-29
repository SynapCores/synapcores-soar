/**
 * Action dispatcher — the single entry point for "do this thing in
 * the real world".
 *
 * Flow:
 *   1. Look up the ActionDef by id.
 *   2. Validate the input against the action's zod schema.
 *   3. Insert a soar_actions row in 'pending'.
 *   4. If HBR and not pre-approved → insert into soar_approval_queue,
 *      flip the action to 'awaiting_approval', audit-log, return.
 *   5. Else (HBR pre-approved or non-HBR) → resolve the configured
 *      adapter for the tenant, fire it, audit-log the result.
 *
 * Phase 7 wires the /approvals UI to flip approval_queue rows from
 * pending → approved + re-call this dispatcher with `preApproved=true`.
 */

import 'server-only';
import { randomUUID } from 'node:crypto';

import { getAdminClient } from '@synapcores/app-framework/db/server';
import type { ActionContext, ActionState } from './types';
import { getActionDef } from './registry';
import { writeSoarAudit } from '../soar-alerts';

const APPROVAL_TTL_MS = 24 * 60 * 60 * 1000; // 24h

export interface DispatchInput {
  /** Action id from the registry. */
  actionId: string;
  /** Action-specific arguments — validated against the action's schema. */
  args: unknown;
  ctx: ActionContext;
  /**
   * Pass true to skip HBR gating because a human already approved.
   * The /approvals page sets this when an approval is resolved.
   */
  preApproved?: boolean;
}

export interface DispatchResult {
  actionRowId: string;
  state: ActionState;
  /** Set on state='awaiting_approval'. */
  approvalRowId?: string;
  /** Set on state='completed' or 'failed'. */
  responsePayload?: unknown;
  errorMessage?: string;
}

export async function dispatchAction(input: DispatchInput): Promise<DispatchResult> {
  const def = getActionDef(input.actionId);
  if (!def) {
    return failImmediately(input, `Unknown action '${input.actionId}'.`);
  }

  // Validate args.
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

  // Insert pending row first so we always have a ledger entry even if
  // adapter resolution fails.
  await db.sql(
    `INSERT INTO soar_actions
       (id, tenant_id, incident_id, alert_id, action, target,
        request_payload, state, requested_by, requested_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, 'pending', $8, NOW())`,
    [
      actionRowId,
      input.ctx.tenantId,
      input.ctx.incidentId ?? null,
      input.ctx.alertId ?? null,
      input.actionId,
      extractTarget(validArgs),
      JSON.stringify(validArgs),
      `${input.ctx.invokedByType}:${input.ctx.invokedBy}`,
    ],
  );

  // HBR gating.
  if (def.hbr && !input.preApproved) {
    const approvalRowId = randomUUID();
    const expiresAt = new Date(Date.now() + APPROVAL_TTL_MS).toISOString();
    await db.sql(
      `INSERT INTO soar_approval_queue
         (id, tenant_id, action_id, requested_by, requested_at,
          state, expires_at)
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
      `UPDATE soar_actions SET state = 'awaiting_approval' WHERE id = $1`,
      [actionRowId],
    );
    await writeSoarAudit({
      tenantId: input.ctx.tenantId,
      actorId: input.ctx.invokedBy,
      actorType: input.ctx.invokedByType,
      action: 'action.awaiting_approval',
      alertId: input.ctx.alertId,
      incidentId: input.ctx.incidentId,
      payload: { action_id: input.actionId, action_row_id: actionRowId },
    });
    return {
      actionRowId,
      state: 'awaiting_approval',
      approvalRowId,
    };
  }

  // Resolve the first configured adapter for the tenant.
  let chosen = null;
  for (const adapter of def.adapters) {
    if (await adapter.isConfigured(input.ctx.tenantId)) {
      chosen = adapter;
      break;
    }
  }
  if (!chosen) {
    await db.sql(
      `UPDATE soar_actions
          SET state = 'failed', completed_at = NOW(), error_message = $2
        WHERE id = $1`,
      [
        actionRowId,
        `No adapter configured for action '${input.actionId}' in this tenant. Wire one at /settings/integrations.`,
      ],
    );
    await writeSoarAudit({
      tenantId: input.ctx.tenantId,
      actorId: input.ctx.invokedBy,
      actorType: input.ctx.invokedByType,
      action: 'action.failed',
      alertId: input.ctx.alertId,
      incidentId: input.ctx.incidentId,
      payload: { action_id: input.actionId, reason: 'no_adapter' },
    });
    return {
      actionRowId,
      state: 'failed',
      errorMessage: 'No adapter configured for this action in this tenant.',
    };
  }

  // Fire.
  await db.sql(
    `UPDATE soar_actions SET state = 'running' WHERE id = $1`,
    [actionRowId],
  );
  const result = await chosen.exec(
    validArgs as Parameters<typeof chosen.exec>[0],
    input.ctx,
  );
  await db.sql(
    `UPDATE soar_actions
        SET state = $2,
            response_payload = $3,
            completed_at = NOW(),
            error_message = $4
      WHERE id = $1`,
    [
      actionRowId,
      result.ok ? 'completed' : 'failed',
      JSON.stringify(result.responsePayload ?? {}),
      result.errorMessage ?? null,
    ],
  );
  await writeSoarAudit({
    tenantId: input.ctx.tenantId,
    actorId: input.ctx.invokedBy,
    actorType: input.ctx.invokedByType,
    action: result.ok ? 'action.completed' : 'action.failed',
    alertId: input.ctx.alertId,
    incidentId: input.ctx.incidentId,
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
  for (const key of [
    'device_id',
    'user_id',
    'ip',
    'channel',
    'target',
    'asset_id',
  ]) {
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
    `INSERT INTO soar_actions
       (id, tenant_id, incident_id, alert_id, action, target,
        request_payload, state, requested_by, requested_at,
        completed_at, error_message)
     VALUES ($1, $2, $3, $4, $5, NULL, $6, 'failed', $7, NOW(), NOW(), $8)`,
    [
      actionRowId,
      input.ctx.tenantId,
      input.ctx.incidentId ?? null,
      input.ctx.alertId ?? null,
      input.actionId,
      JSON.stringify(input.args ?? {}),
      `${input.ctx.invokedByType}:${input.ctx.invokedBy}`,
      message,
    ],
  );
  await writeSoarAudit({
    tenantId: input.ctx.tenantId,
    actorId: input.ctx.invokedBy,
    actorType: input.ctx.invokedByType,
    action: 'action.failed',
    alertId: input.ctx.alertId,
    incidentId: input.ctx.incidentId,
    payload: { action_id: input.actionId, reason: message },
  });
  return { actionRowId, state: 'failed', errorMessage: message };
}
