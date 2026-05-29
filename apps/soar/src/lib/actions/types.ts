/**
 * Action types — the contract every adapter implements.
 *
 * An "action" is a thing the SOAR system can DO to the outside world:
 * isolate an endpoint, disable a user, block an IP, post to Slack, file
 * a ticket. Each action has:
 *
 *   - a stable string id (e.g. 'isolate_endpoint')
 *   - input shape (zod schema)
 *   - HBR flag (high blast radius — needs human approval)
 *   - one or more provider adapters (CrowdStrike, SentinelOne, Defender
 *     for isolate_endpoint; Okta, Azure AD for disable_user; ...)
 *
 * Dispatch flow (Phase 6):
 *   call → resolve adapter for tenant → if HBR + no approval, write
 *   to approval_queue + return state='awaiting_approval' → else fire +
 *   record state='completed'/'failed'.
 *
 * Phase 7 wires the human approval UI on top of approval_queue.
 */

import type { z } from 'zod';

export interface ActionContext {
  tenantId: string;
  /** Who's invoking — analyst user id or agent persona name. */
  invokedBy: string;
  invokedByType: 'analyst' | 'agent';
  /** Optional incident / alert links for audit. */
  incidentId?: string;
  alertId?: string;
}

export interface AdapterExecResult {
  ok: boolean;
  /** Provider's response (for audit + reproducibility). */
  responsePayload: unknown;
  /** Human-readable error if !ok. */
  errorMessage?: string;
}

export interface ActionAdapter<Input> {
  /** Provider id, e.g. 'crowdstrike' | 'sentinelone' | 'okta'. */
  provider: string;
  /** True if this adapter is configured for the tenant. */
  isConfigured(tenantId: string): Promise<boolean>;
  /** Execute the action. Should not throw — return ok:false instead. */
  exec(input: Input, ctx: ActionContext): Promise<AdapterExecResult>;
}

export interface ActionDef<Input> {
  /** Stable identifier — referenced by personas in their tool registry. */
  id: string;
  description: string;
  schema: z.ZodType<Input>;
  /** True = blocks on human approval by default. */
  hbr: boolean;
  /**
   * Adapters that can fulfil this action. The dispatcher resolves the
   * tenant's configured adapter — if multiple, picks the first
   * configured. Operator can override per-action via integration
   * routing.
   */
  adapters: ActionAdapter<Input>[];
}

export type ActionState =
  | 'pending'
  | 'awaiting_approval'
  | 'running'
  | 'completed'
  | 'failed'
  | 'rejected';
