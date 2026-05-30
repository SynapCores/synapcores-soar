/**
 * AML action types — the contract every adapter implements.
 * Mirror of SOAR's action types (see apps/soar/src/lib/actions/types.ts);
 * if a third app needs the same shape we lift this into the framework.
 */

import type { z } from 'zod';

export interface ActionContext {
  tenantId: string;
  invokedBy: string;
  invokedByType: 'analyst' | 'agent';
  caseId?: string;
  transactionId?: string;
  sarId?: string;
}

export interface AdapterExecResult {
  ok: boolean;
  responsePayload: unknown;
  errorMessage?: string;
}

export interface ActionAdapter<Input> {
  provider: string;
  isConfigured(tenantId: string): Promise<boolean>;
  exec(input: Input, ctx: ActionContext): Promise<AdapterExecResult>;
}

export interface ActionDef<Input> {
  id: string;
  description: string;
  schema: z.ZodType<Input>;
  /** True = blocks on human approval. file_sar / freeze_account / block_funds. */
  hbr: boolean;
  adapters: ActionAdapter<Input>[];
}

export type ActionState =
  | 'pending'
  | 'awaiting_approval'
  | 'running'
  | 'completed'
  | 'failed'
  | 'rejected'
  | 'approved';
