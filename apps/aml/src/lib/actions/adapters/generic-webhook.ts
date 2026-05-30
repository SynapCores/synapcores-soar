/**
 * Generic webhook adapter — fires structured JSON to a customer's own
 * endpoint. Use case: bridging into in-house ticket systems, ChatOps,
 * or custom workflow engines that don't have a first-class adapter.
 *
 * Integration shape (provider='webhook'):
 *   {
 *     "url":           "https://example.com/aml",
 *     "secret_header": "X-AML-Auth",
 *     "secret_value":  "..."
 *   }
 *
 * Not HBR.
 */

import 'server-only';
import type {
  ActionAdapter,
  ActionContext,
  AdapterExecResult,
} from '../types';
import { findIntegration, stampIntegrationUsed } from '../integrations';

export interface NotifyGenericInput {
  message: string;
  data?: Record<string, unknown>;
}

export const genericWebhookAdapter: ActionAdapter<NotifyGenericInput> = {
  provider: 'webhook',

  async isConfigured(tenantId: string): Promise<boolean> {
    return (await findIntegration(tenantId, 'webhook')) !== null;
  },

  async exec(input, ctx: ActionContext): Promise<AdapterExecResult> {
    const integration = await findIntegration(ctx.tenantId, 'webhook');
    if (!integration?.secret_payload) {
      return {
        ok: false,
        responsePayload: null,
        errorMessage: 'Generic webhook integration not configured.',
      };
    }
    const cfg = integration.secret_payload as {
      url?: string;
      secret_header?: string;
      secret_value?: string;
    };
    if (!cfg.url) {
      return {
        ok: false,
        responsePayload: null,
        errorMessage: 'Generic webhook integration missing url.',
      };
    }
    const headers: Record<string, string> = { 'content-type': 'application/json' };
    if (cfg.secret_header && cfg.secret_value) {
      headers[cfg.secret_header] = cfg.secret_value;
    }
    try {
      const res = await fetch(cfg.url, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          message: input.message,
          source: 'synapcores-aml',
          tenant_id: ctx.tenantId,
          invoked_by: ctx.invokedBy,
          invoked_by_type: ctx.invokedByType,
          case_id: ctx.caseId,
          transaction_id: ctx.transactionId,
          sar_id: ctx.sarId,
          data: input.data ?? null,
        }),
      });
      const body = await res.text();
      await stampIntegrationUsed(integration.id);
      return {
        ok: res.ok,
        responsePayload: { status: res.status, body: body.slice(0, 1024) },
        errorMessage: res.ok ? undefined : `Webhook returned HTTP ${res.status}`,
      };
    } catch (err) {
      return {
        ok: false,
        responsePayload: null,
        errorMessage: err instanceof Error ? err.message : String(err),
      };
    }
  },
};
